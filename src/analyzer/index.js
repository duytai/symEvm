const assert = require('assert')
const { reverse, last, first } = require('lodash')
const chalk = require('chalk')
const { prettify, logger, findSymbol } = require('../shared')
const Memory = require('./memory')
const Storage = require('./storage')

let counter = 0

const buildDependencyTree = (node, traces) => {
  const { me, childs } = node
  assert(!childs.length)
  switch (me[1]) {
    case 'MLOAD': {
      const [loc, loadSize, traceSize] = me.slice(2)
      const loadVariable = Memory.toVariable(loc)
      assert(loadVariable)
      const mstores = traces.filter(trace => ([type, name]) => name == 'MSTORE')
      mstores.forEach(mstore => {
        const [loc, storedValue] = mstore.slice(2)
        const storeVariable = Memory.toVariable(loc)
        assert(storeVariable)
        // TODO: Need to analyze aliasing 
        if (loadVariable.equal(storeVariable)) {
          if (loadVariable.toString() != 'm_40') {
            const newNode = { me: storedValue, childs: [] }
            buildDependencyTree(newNode, traces)
            childs.push(newNode)
          }
        }
      })
      break
    }
    case 'SLOAD': {
      console.log('///////')
      prettify([me])
      const [loc] = me.slice(2)
      const variable = Storage.toVariable(loc, traces)
      assert(variable)
      console.log(chalk.green(variable.toString()))
      break
    }
    default: {
      const symbols = findSymbol(me, ([type, name]) => ['SLOAD', 'MLOAD'].includes(name))
      symbols.forEach(symbol => {
        const newNode = { me: symbol, childs: [] }
        buildDependencyTree(newNode, traces)
        childs.push(newNode)
      })
    }
  }
}

const prettifyTree = (root, level = 0) => {
  const { me, childs } = root
  prettify([me], level * 2)
  childs.forEach(child => {
    prettifyTree(child, level + 1)
  })
}

const analyze = (symbol, traces) => {
  const root = { me: symbol, childs: [] }
  const [type, name, ...params] = symbol
  buildDependencyTree(root, traces)
  console.log('---ROOT---')
  prettifyTree(root)
}

module.exports = {
  analyze,
} 
