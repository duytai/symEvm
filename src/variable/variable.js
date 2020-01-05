const assert = require('assert')
const chalk = require('chalk')
const { logger, isConst } = require('../shared')

class Variable  {
  constructor(root) {
    assert(root)
    this.root = root
    this.members = [] 
  }

  add(m) {
    assert(m)
    this.members.push(m)
  }

  addN(ms) {
    assert(ms.length > 0)
    ms.forEach(m => {
      this.members.push(m)
    })
  }

  toString() {
    const root = typeof this.root == 'string'
      ? this.root
      : `[${this.root.toString()}]`
    const prop = this.members.map(m => {
      if (m[0] == 'const') return m[1].toString(16)
      return '*'
    }).join('.')
    return [root, prop].filter(p => !!p).join('.')
  }

  prettify() {
    logger.debug(chalk.green.bold(this.toString()))
  }

  exactEqual(other) {
    return false
  }

}

module.exports = Variable
