const BN = require('bn.js')
const assert = require('assert')
const opcodes = require('./opcodes')
const { logger, prettify } = require('../shared')

const TWO_POW256 = new BN('10000000000000000000000000000000000000000000000000000000000000000', 16)
const MAX_INTEGER = new BN('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 16)

class Evm {
  constructor(bin) {
    this.bin = bin
    this.checkPoints = []
    this.endPoints = []
  }

  execute(pc = 0, stack, ep, trace) {
    while (true) {
      const opcode = opcodes[this.bin[pc]]
      if (!opcode) return
      const { name, ins, outs } = opcode
      ep.add({ stack: stack.clone(), opcode, pc })
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
          stack.popN(ins)
          break
        }
        case 'JUMPI': {
          const [label, cond] = stack.popN(ins) 
          assert(label[0] == 'const')
          const jumpdest = label[1].toNumber()
          if (cond[0] == 'const') {
            if (!cond[1].isZero()) {
              assert(this.bin[jumpdest] && opcodes[this.bin[jumpdest]].name == 'JUMPDEST')
              this.execute(
                jumpdest,
                stack.clone(),
                ep.clone(),
                trace.clone(),
              )
            } else {
              this.execute(
                pc + 1,
                stack.clone(),
                ep.clone(),
                trace.clone(),
              )
            }
          } else {
            this.execute(
              pc + 1,
              stack.clone(),
              ep.clone(),
              trace.clone(),
            )
            if (!ep.findForbiddenJumpdests(jumpdest).includes(jumpdest)) {
              if (this.bin[jumpdest] && opcodes[this.bin[jumpdest]].name == 'JUMPDEST') {
                this.execute(
                  jumpdest,
                  stack.clone(),
                  ep.clone(),
                  trace.clone(),
                )
              } else {
                logger.error('INVALID JUMPI')
              }
            }
          }
          return
        }
        case 'JUMP': {
          const label = stack.pop()
          assert(label[0] == 'const')
          const jumpdest = label[1].toNumber()
          if (!ep.findForbiddenJumpdests(jumpdest).includes(jumpdest)) {
            if (this.bin[jumpdest] && opcodes[this.bin[jumpdest]].name == 'JUMPDEST') {
              this.execute(
                jumpdest,
                stack.clone(),
                ep.clone(),
                trace.clone(),
              )
            } else {
              logger.error('INVALID JUMP')
            }
          }
          return
        }
        case 'SWAP': {
          stack.swapN(this.bin[pc] - 0x8f)
          break
        }
        case 'DUP': {
          stack.dupN(this.bin[pc] - 0x7f)
          break
        }
        case 'REVERT':
        case 'INVALID':
        case 'SELFDESTRUCT':
        case 'RETURN':
        case 'STOP': {
          this.endPoints.push({
            ep: ep.clone(),
            trace: trace.clone(),
          })
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
          const [memLoc, memValue] = stack.popN(ins)
          const size = ['const', new BN(32)]
          const t = ['symbol', name, memLoc, memValue, size]
          trace.add(t, pc)
          break
        }
        case 'MLOAD': {
          const memLoc = stack.pop()
          const size = ['const', new BN(32)]
          const traceSize = ['const', new BN(trace.size())]
          stack.push(['symbol', name, memLoc, size, traceSize])
          break
        }
        case 'SSTORE': {
          const [x, y] = stack.popN(ins)
          const t = ['symbol', name, x, y]
          trace.add(t, pc)
          break
        }
        case 'SLOAD': {
          const storageLoc = stack.pop()
          const traceSize = ['const', new BN(trace.size())]
          stack.push(['symbol', name, storageLoc, traceSize])
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
          const [x, y] = stack.popN(ins)
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
          const [x, y] = stack.popN(ins)
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
          const [x, y] = stack.popN(ins)
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].eq(y[1]) ? new BN(1) : new BN(0)])
          }
          break
        }
        case 'AND': {
          const [x, y] = stack.popN(ins)
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
          const [x, y] = stack.popN(ins)
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].lt(y[1]) ? new BN(1) : new BN(0)])
          }
          break
        }
        case 'SLT': {
          const [x, y] = stack.popN(ins)
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].fromTwos(256).lt(y[1].fromTwos(256)) ? new BN(1) : new BN(0)])
          }
          break
        }
        case 'GT': {
          const [x, y] = stack.popN(ins)
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].gt(y[1]) ? new BN(1) : new BN(0)])
          }
          break
        }
        case 'MUL': {
          const [x, y] = stack.popN(ins)
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].mul(y[1]).mod(TWO_POW256)])
          }
          break
        }
        case 'SUB': {
          const [x, y] = stack.popN(ins)
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].sub(y[1]).toTwos(256)])
          }
          break
        }
        case 'ADD': {
          const [x, y] = stack.popN(ins)
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            stack.push(['const', x[1].add(y[1]).mod(TWO_POW256)])
          }
          break
        }
        case 'DIV': {
          const [x, y] = stack.popN(ins)
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
          const [x, y] = stack.popN(ins)
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
          const [x, y] = stack.popN(ins)
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
          const [x, y] = stack.popN(ins)
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
          const [x, y, z] = stack.popN(ins)
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
          const [x, y] = stack.popN(ins)
          const traceSize = ['const', new BN(trace.size())]
          stack.push(['symbol', name, ['symbol', 'MLOAD', x, y, traceSize]])
          break
        }
        case 'CODESIZE': {
          stack.push(['const', new BN(this.bin.length)])
          break
        }
        case 'CODECOPY': {
          const [memLoc, codeOffset, codeLen] = stack.popN(ins)
          if (codeOffset[0] != 'const' || codeLen[0] != 'const') {
            const value = ['symbol', name, codeOffset, codeLen]
            const t = ['symbol', 'MSTORE', memLoc, value, codeLen]
            trace.add(t, pc)
          } else {
            const code = this.bin.slice(codeOffset[1].toNumber(), codeOffset[1].toNumber() + codeLen[1].toNumber())
            const value = ['const', new BN(code.toString('hex'), 16)]
            const t = ['symbol', 'MSTORE', memLoc, value, codeLen]
            trace.add(t, pc)
          }
          break
        }
        case 'EXP': {
          const [base, exponent] = stack.popN(ins)
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
          const [x, y] = stack.popN(ins)
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            const r = x[1].or(y[1])
            stack.push(['const', r])
          }
          break
        }
        case 'XOR': {
          const [x, y] = stack.popN(ins)
          if (x[0] != 'const' || y[0] != 'const') {
            stack.push(['symbol', name, x, y])
          } else {
            const r = x[1].xor(y[1])
            stack.push(['const', r])
          }
          break
        }
        case 'CALLDATACOPY': {
          const [memLoc, dataOffset, dataLen] = stack.popN(ins)
          const callData = ['symbol', 'CALLDATALOAD', dataOffset]
          const t = ['symbol', 'MSTORE', memLoc, callData, dataLen]
          trace.add(t, pc)
          break
        }
        case 'RETURNDATACOPY': {
          const [memLoc, returnDataOffset, dataLen] = stack.popN(ins)
          const returnData = ['symbol', 'RETURNDATA', returnDataOffset]
          const t = ['symbol', 'MSTORE', memLoc, returnData, dataLen]
          trace.add(t, pc)
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
          ] = stack.popN(ins)
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
          ] = stack.popN(ins)
          this.checkPoints.push({
            type: 'CALL',
            data: {
              trace: trace.clone(),
              symbol: value,
              ep: ep.clone(),
              pc,
            },
          })
          stack.push(['symbol', name, gasLimit, toAddress, value, inOffset, inLength, outOffset, outLength])
          break
        }
        default: {
          logger.error(`Missing ${name}`)
          const inputs = stack.popN(ins)
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

module.exports = Evm 
