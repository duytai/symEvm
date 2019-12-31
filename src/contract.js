const BN = require('bn.js')
const assert = require('assert')
const chalk = require('chalk')
const { pickBy } = require('lodash')
const { opcodes } = require('./evm')
const { prettify, prettifyPath, logger } = require('./shared')
const { analyze } = require('./analyzer')
const Trace = require('./trace')

const TWO_POW256 = new BN('10000000000000000000000000000000000000000000000000000000000000000', 16)
const MAX_INTEGER = new BN('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 16)
/*
 * MSTORE: loc, value, len
 * MLOAD: loc, len, postion of MSTORE(40)
 * TODO: stop condition and JUMP address
 * */
class Contract {
  constructor(bin) {
    this.MAX_VISITED_BLOCK = 30;
    this.bin = bin
  }

  findForbiddenJumpdests(path, jumpdest) {
    const forbiddenJumpdests = new Set() 
    const pcs = [
      ...path.filter(({ opcode: { name } }) => name == 'JUMPDEST').map(({ pc }) => pc),
      jumpdest,
    ]
    const indexes = Object.keys(pickBy(pcs, pc => pc == jumpdest)).map(i => parseInt(i))
    if (indexes.length > 2) {
      const subPaths = []
      for (let i = 0; i < indexes.length - 1; i ++) {
        subPaths.push(pcs.slice(indexes[i], indexes[i + 1]))
      }
      for (let i = 0; i < subPaths.length - 1; i ++) {
        for (let j = i + 1; j < subPaths.length; j ++) {
          if (subPaths[i].join('') == subPaths[j].join('')) {
            forbiddenJumpdests.add(subPaths[i][0])
          }
        }
      }
    }
    // Return all jumpdests to stop the execution
    if (pcs.length >= this.MAX_VISITED_BLOCK)
      return pcs
    return [...forbiddenJumpdests]
  }

  execute(pc = 0, stack = [], path = [], trace = new Trace()) {
    while (true) {
      const opcode = opcodes[this.bin[pc]]
      if (!opcode) return
      const { name, ins, outs } = opcode
      path.push({ stack: [...stack], opcode, pc })
      switch (name) {
        case 'PUSH': {
          const dataLen = this.bin[pc] - 0x5f
          const data = this.bin.slice(pc + 1, pc + 1 + dataLen).toString('hex')
          stack.push(['const', new BN(data, 16)])
          pc += dataLen
          break
        }
        case 'POP': {
          stack.pop()
          break
        }
        case 'LOG': {
          stack.splice(-ins)
          break
        }
        case 'JUMPI': {
          const [cond, label] = stack.splice(-ins) 
          assert(label[0] == 'const')
          const jumpdest = label[1].toNumber()
          if (cond[0] == 'const') {
            if (!cond[1].isZero()) {
              assert(this.bin[jumpdest] && opcodes[this.bin[jumpdest]].name == 'JUMPDEST')
              this.execute(
                jumpdest,
                [...stack],
                [...path],
                trace.clone(),
              )
            } else {
              this.execute(
                pc + 1,
                [...stack],
                [...path],
                trace.clone(),
              )
            }
          } else {
            this.execute(
              pc + 1,
              [...stack],
              [...path],
              trace.clone(),
            )
            if (!this.findForbiddenJumpdests(path, jumpdest).includes(jumpdest)) {
              if (this.bin[jumpdest] && opcodes[this.bin[jumpdest]].name == 'JUMPDEST') {
                this.execute(
                  jumpdest,
                  [...stack],
                  [...path],
                  trace.clone(),
                )
              } else {
                console.log(chalk.bold.red('INVALID JUMPI'))
              }
            }
          }
          return
        }
        case 'JUMP': {
          const [label] = stack.splice(-ins)
          assert(label[0] == 'const')
          const jumpdest = label[1].toNumber()
          if (!this.findForbiddenJumpdests(path, jumpdest).includes(jumpdest)) {
            if (this.bin[jumpdest] && opcodes[this.bin[jumpdest]].name == 'JUMPDEST') {
              this.execute(
                jumpdest,
                [...stack],
                [...path],
                trace.clone(),
              )
            } else {
              console.log(chalk.bold.red('INVALID JUMP'))
            }
          }
          return
        }
        case 'SWAP': {
          const distance = this.bin[pc] - 0x8f
          const target = stack.length - 1 - distance
          const tmp = stack[target]
          assert(target >= 0)
          stack[target] = stack[stack.length - 1]
          stack[stack.length - 1] = tmp
          break
        }
        case 'DUP': {
          const distance = this.bin[pc] - 0x7f
          const target = stack.length - distance
          assert(target >= 0)
          stack.push(stack[target])
          break
        }
        case 'REVERT':
        case 'SELFDESTRUCT':
        case 'RETURN':
        case 'STOP':
        case 'INVALID': {
          return
        }
        case 'MSIZE':
        case 'CALLVALUE':
        case 'CALLER':
        case 'ADDRESS':
        case 'NUMBER':
        case 'GAS':
        case 'ORIGIN':
        case 'TIMESTAMP':
        case 'DIFFICULTY':
        case 'GASPRICE':
        case 'COINBASE':
        case 'GASLIMIT':
        case 'CALLDATASIZE':
        case 'RETURNDATASIZE': {
          stack.push(['symbol', name])
          break
        }
        case 'BALANCE':
        case 'CALLDATALOAD':
        case 'EXTCODESIZE':
        case 'EXTCODEHASH':
        case 'BLOCKHASH': {
          stack.push(['symbol', name, stack.pop()])
          break
        }
        case 'MSTORE': {
          const [memLoc, memValue] = stack.splice(-2).reverse()
          const size = ['const', new BN(32)]
          const t = ['symbol', name, memLoc, memValue, size]
          trace.add(t)
          break
        }
        case 'MLOAD': {
          const memLoc = stack.pop()
          const size = ['const', new BN(32)]
          const lastTraceIdx = ['const', new BN(trace.lastIndex())]
          stack.push(['symbol', name, memLoc, size, lastTraceIdx])
          break
        }
        case 'SSTORE': {
          const [x, y] = stack.splice(-2).reverse()
          const t = ['symbol', name, x, y]
          trace.add(t)
          break
        }
        case 'SLOAD': {
          const storageLoc = stack.pop()
          const lastTraceIdx = ['const', new BN(trace.lastIndex())]
          stack.push(['symbol', name, storageLoc, lastTraceIdx])
          break
        }
        case 'ISZERO': {
          const x = stack.pop()
          if (x[0] == 'const') {
            stack.push(['const', x[1].isZero() ? new BN(1) : new BN(0)])
          } else {
            stack.push(['symbol', name, x])
          }
          break
        }
        case 'SHL': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            if (x[1].gten(256)) {
              stack.push(['const', new BN(0)])
            } else {
              const r = y[1].shln(x[1].toNumber()).iand(MAX_INTEGER)
              stack.push(['const', r])
            }
          }
          break
        }
        case 'SHR': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            if (x[1].gten(256)) {
              stack.push(['const', new BN(0)])
            } else {
              const r = y[1].shrn(x[1].toNumber())
              stack.push(['const', r])
            }
          }
          break
        }
        case 'EQ': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].eq(y[1]) ? new BN(1) : new BN(0)])
          }
          break
        }
        case 'AND': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].and(y[1])])
          }
          break
        }
        case 'JUMPDEST': {
          break
        }
        case 'LT': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].lt(y[1]) ? new BN(1) : new BN(0)])
          }
          break
        }
        case 'SLT': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].fromTwos(256).lt(y[1].fromTwos(256)) ? new BN(1) : new BN(0)])
          }
          break
        }
        case 'GT': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].gt(y[1]) ? new BN(1) : new BN(0)])
          }
          break
        }
        case 'MUL': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].mul(y[1]).mod(TWO_POW256)])
          }
          break
        }
        case 'SUB': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].sub(y[1]).toTwos(256)])
          }
          break
        }
        case 'ADD': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].add(y[1]).mod(TWO_POW256)])
          }
          break
        }
        case 'DIV': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            if (y[1].isZero()) {
              stack.push(y)
            } else {
              stack.push(['const', x[1].div(y[1])])
            }
          }
          break
        }
        case 'SDIV': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            if (y[1].isZero()) {
              stack.push(y)
            } else {
              const a = x[1].fromTwos(256)
              const b = y[1].fromTwos(256)
              const r = a.div(b).toTwos(256)
              stack.push(['const', r])
            }
          }
          break
        }
        case 'MOD': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            if (y[1].isZero()) {
              stack.push(y)
            } else {
              stack.push(['const', x[1].mod(y[1])])
            }
          }
          break
        }
        case 'SMOD': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            if (y[1].isZero()) {
              stack.push(y)
            } else {
              const a = x[1].fromTwos(256)
              const b = y[1].fromTwos(256)
              let r = a.abs().mod(b.abs())
              if (a.isNeg()) {
                r = r.ineg()
              }
              r = r.toTwos(256)
              stack.push(['const', r])
            }
          }
          break
        }
        case 'ADDMOD': {
          const [x, y, z] = stack.splice(-3).reverse()
          if (x[0] != 'const' || y[0] != 'const' || z[0] != 'const') {
            stack.push(['symbol', name, x, y, z])
          } else {
            if (z[1].isZero()) {
              stack.push(z)
            } else {
              stack.push(['const', x.add(y).mod(z)])
            }
          }
          break
        }
        case 'SHA3': {
          const [x, y] = stack.splice(-2).reverse()
          const lastTraceIdx = ['const', new BN(trace.lastIndex())]
          stack.push(['symbol', name, ['symbol', 'MLOAD', x, y, lastTraceIdx]])
          break
        }
        case 'CODESIZE': {
          stack.push(['const', new BN(this.bin.length)])
          break
        }
        case 'CODECOPY': {
          const [memLoc, codeOffset, codeLen] = stack.splice(-3).reverse()
          if (codeOffset[0] != 'const' || codeLen[0] != 'const') {
            const value = ['symbol', name, codeOffset, codeLen]
            const t = ['symbol', 'MSTORE', memLoc, value, codeLen]
            trace.add(t)
          } else {
            const code = this.bin.slice(codeOffset[1].toNumber(), codeOffset[1].toNumber() + codeLen[1].toNumber())
            const value = ['const', new BN(code.toString('hex'), 16)]
            const t = ['symbol', 'MSTORE', memLoc, value, codeLen]
            trace.add(t)
          }
          break
        }
        case 'EXP': {
          const [base, exponent] = stack.splice(-2).reverse()
          if (exponent[0] == 'const' && exponent[1].isZero()) {
            stack.push(['const', new BN(1)])
          } else if (base[0] == 'const' && base[1].isZero()) {
            stack.push(['const', new BN(0)])
          } else {
            if (base[0] != 'const' || exponent[0] != 'const') {
              stack.push(['symbol', name, base, exponent])
            } else {
              const byteLength = exponent[1].byteLength()
              assert(byteLength >= 1 && byteLength <= 32)
              const m = BN.red(TWO_POW256)
              const redBase = base[1].toRed(m)
              const r = redBase.redPow(exponent[1])
              stack.push(['const', r.fromRed()])
            }
          }
          break
        }
        case 'NOT': {
          const x = stack.pop()
          if (x[0] != 'const') {
            stack.push(['symbol', name, x])
          } else {
            const r = x[1].notn(256)
            stack.push(['const', r])
          }
          break
        }
        case 'OR': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            const r = x[1].or(y[1])
            stack.push(['const', r])
          }
          break
        }
        case 'XOR': {
          const [x, y] = stack.splice(-2).reverse()
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            const r = x[1].xor(y[1])
            stack.push(['const', r])
          }
          break
        }
        case 'CALLDATACOPY': {
          const [memLoc, dataOffset, dataLen] = stack.splice(-3).reverse()
          const callData = ['symbol', 'CALLDATALOAD', dataOffset]
          const t = ['symbol', 'MSTORE', memLoc, callData, dataLen]
          trace.add(t)
          break
        }
        case 'RETURNDATACOPY': {
          const [memLoc, returnDataOffset, dataLen] = stack.splice(-3).reverse()
          // TODO: return data is not a opcode
          const returnData = ['symbol', 'RETURNDATA', returnDataOffset]
          const t = ['symbol', 'MSTORE', memLoc, returnData, dataLen]
          trace.add(t)
          break
        }
        case 'DELEGATECALL': {
          const [
            gasLimit,
            toAddress,
            inOffset,
            inLength,
            outOffset,
            outLength,
          ] = stack.splice(-6).reverse()
          stack.push(['symbol', name, gasLimit, toAddress, inOffset, inLength, outOffset, outLength])
          break
        }
        case 'CALL': {
          const [
            gasLimit,
            toAddress,
            value,
            inOffset,
            inLength,
            outOffset,
            outLength,
          ] = stack.splice(-7).reverse()
          // prettifyPath(path)
          analyze(value, trace)
          stack.push(['symbol', name, gasLimit, toAddress, value, inOffset, inLength, outOffset, outLength])
          break
        }
        default: {
          console.log(chalk.bold.red(`Missing ${name}`))
          const inputs = stack.splice(-ins).reverse()
          assert(outs <= 1)
          if (outs) {
            stack.push(['symbol', name, ...inputs])
          }
          break
        }
      }
      pc = pc + 1
    }
  }
}

module.exports = Contract 
