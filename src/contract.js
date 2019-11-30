const { range, reverse } = require('lodash')
const BN = require('bn.js')
const assert = require('assert')
const { opcodes } = require('./evm')
const { logger, prettify } = require('./shared')

const TWO_POW256 = new BN('10000000000000000000000000000000000000000000000000000000000000000', 16)
/*
 * MSTORE: loc, value, len
 * MLOAD: loc, position in traces in traces
 * */

class Contract {
  constructor(bin, asm) {
    this.bin = bin
    this.asm = asm
  }

  execute(pc = 0, stack = [], path = [], traces = [], visited = {}) {
    const opcode = opcodes[this.bin[pc]]
    if (!opcode) return
    const { name, ins, outs } = opcode
    path.push({ stack: [...stack], opcode, pc })
    visited[pc] = true
    if (pc == 91) {
      console.log('---stack----')
      prettify(stack)
    }
    switch (name) {
      case 'PUSH': {
        const dataLen = this.bin[pc] - 0x5f
        const data = this.bin.slice(pc + 1, pc + 1 + dataLen).toString('hex')
        stack.push(['const', new BN(data, 16)])
        range(pc + 1, pc + 1 + dataLen).forEach(i => visited[i] = true)
        this.execute(pc + 1 + dataLen, [...stack], [...path], [...traces], visited)
        return
      }
      case 'POP': {
        stack.pop()
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'JUMPI': {
        const [cond, label] = stack.splice(-ins) 
        assert(label[0] == 'const')
        const jumpdest = label[1].toNumber()
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        assert(this.bin[jumpdest] && opcodes[this.bin[jumpdest]].name == 'JUMPDEST')
        this.execute(jumpdest, [...stack], [...path], [...traces], visited)
        return
      }
      case 'JUMP': {
        const [label] = stack.splice(-ins)
        assert(label[0] == 'const')
        const jumpdest = label[1].toNumber()
        assert(this.bin[jumpdest] && opcodes[this.bin[jumpdest]].name == 'JUMPDEST')
        this.execute(jumpdest, [...stack], [...path], [...traces], visited)
        return
      }
      case 'SWAP': {
        const distance = this.bin[pc] - 0x8f
        const target = stack.length - 1 - distance
        const tmp = stack[target]
        assert(target >= 0)
        stack[target] = stack[stack.length - 1]
        stack[stack.length - 1] = tmp
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'DUP': {
        const distance = this.bin[pc] - 0x7f
        const target = stack.length - distance
        assert(target >= 0)
        stack.push(stack[target])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'REVERT':
      case 'SELFDESTRUCT':
      case 'RETURN':
      case 'STOP':
      case 'INVALID': {
        return
      }
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
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'EXTCODESIZE':
      case 'EXTCODEHASH':
      case 'BLOCKHASH': {
        stack.push(['symbol', 'blockhash', stack.pop()])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'MSTORE': {
        const [memOffset, memValue] = stack.splice(-2).reverse()
        const size = ['const', new BN(32)]
        traces.push(['symbol', name, memOffset, memValue, size])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'MLOAD': {
        stack.push(['symbol', name, stack.pop(), ['const', new BN(traces.length - 1)]])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'SSTORE': {
        const [x, y] = stack.splice(-2).reverse()
        traces.push(['symbol', name, x, y])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'SLOAD': {
        stack.push(['symbol', name, stack.pop(), ['const', new BN(traces.length - 1)]])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'ISZERO': {
        const x = stack.pop()
        if (x[0] == 'const') {
          stack.push(x[1].isZero() ? 1 : 0)
        } else {
          stack.push(['symbol', name, x])
        }
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
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
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'CALLDATALOAD': {
        stack.push(['symbol', name, stack.pop()])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'EQ': {
        const [x, y] = stack.splice(-2).reverse()
        if (x[0] != 'const' || y[0] != 'const') {
          stack.push(['symbol', name, x, y])
        } else {
          stack.push(x[1].eq(y[1]) ? BN(1) : BN(0))
        }
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'AND': {
        const [x, y] = stack.splice(-2).reverse()
        if (x[0] != 'const' || y[0] != 'const') {
          stack.push(['symbol', name, x, y])
        } else {
          stack.push(['const', x[1].and(y[1])])
        }
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'JUMPDEST': {
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'LT': {
        const [x, y] = stack.splice(-2).reverse()
        if (x[0] != 'const' || y[0] != 'const') {
          stack.push(['symbol', name, x, y])
        } else {
          stack.push(['const', x[1].lt(y[1]) ? new BN(1) : new BN(0)])
        }
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'MUL': {
        const [x, y] = stack.splice(-2).reverse()
        if (x[0] != 'const' || y[0] != 'const') {
          stack.push(['symbol', name, x, y])
        } else {
          stack.push(['const', x[1].mul(y[1]).mod(TWO_POW256)])
        }
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'SUB': {
        const [x, y] = stack.splice(-2).reverse()
        if (x[0] != 'const' || y[0] != 'const') {
          stack.push(['symbol', name, x, y])
        } else {
          stack.push(['const', x[1].sub(y[1]).toTwos(256)])
        }
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'ADD': {
        const [x, y] = stack.splice(-2).reverse()
        if (x[0] != 'const' || y[0] != 'const') {
          stack.push(['symbol', name, x, y])
        } else {
          stack.push(['const', x[1].add(y[1]).mod(TWO_POW256)])
        }
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
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
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
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
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
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
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
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
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'SMOD': {
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
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'SHA3': {
        const [x, y] = stack.splice(-2).reverse()
        stack.push(['symbol', name, ['symbol', 'MLOAD', x, y]])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'CODESIZE': {
        stack.push(['const', new BN(this.bin.length)])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      case 'CODECOPY': {
        const [memOffset, codeOffset, codeLen] = stack.splice(-3).reverse()
        assert(codeOffset[0] == 'const')
        assert(codeLen[0] == 'const')
        const code = this.bin.slice(codeOffset[1].toNumber(), codeOffset[1].toNumber() + codeLen[1].toNumber())
        const value = ['const', new BN(code.toString(16), 'hex')]
        traces.push(['symbol', 'MSTORE', memOffset, value, codeLen])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
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
        console.log(`--WEI--`)
        prettify([value])
        stack.push(['symbol', name, gasLimit, toAddress, value, inOffset, inLength, outOffset, outLength])
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
      default: {
        console.log(name)
        stack = stack.slice(0, stack.length - ins)
        range(outs).forEach(() => {
          stack.push(['const', new BN(0)])
        })
        this.execute(pc + 1, [...stack], [...path], [...traces], visited)
        return
      }
    }
  }
}

module.exports = Contract 
