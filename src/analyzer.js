const assert = require('assert')
const { reverse } = require('lodash')
const {
  prettify,
  logger,
  isConstWithValue,
  isConst,
  isSymbol,
} = require('./shared')

const find = (symbol, cond) => {
  const [type, name, ...params] = symbol
  if (cond(symbol)) return [symbol]
  return params.reduce(
    (agg, symbol) => [...agg, ...find(symbol, cond)],
    [],
  )
}

const buildDependencyTree = (node, traces) => {
  const { me, childs } = node
  assert(isSymbol(me))
  assert(!childs.length)
  const [type, name, ...params] = me
  switch (name) {
    case 'MLOAD': {
      break
    }
    case 'SLOAD': {
      const [loadOffset, traceSize] = params
      assert(isConst(traceSize))
      /* Data is saved at specific location */
      if (isConst(loadOffset)) {
        const validTraces = reverse(traces.slice(0, traceSize[1].toNumber()))
        for (let i = 0; i < validTraces.length; i ++) {
          const trace = validTraces[i]
          const [type, name, ...params] = trace
          if (name == 'SSTORE') {
            const [storeOffset, value, traceSize] = params
            if (isConst(storeOffset)) {
              if (storeOffset[1].toNumber() == loadOffset[1].toNumber()) {
                const newNode = { me: trace, childs: [] }
                buildDependencyTree(newNode, traces)
                childs.push(newNode)
              }
            }
          }
        }
      } else {
      }
      break
    }
    default: {
      const symbols = find(me, ([type, name]) => type == 'symbol' && ['SLOAD', 'MLOAD'].includes(name))
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
  prettify(traces)
  const [type, name, ...params] = symbol 
  switch (type) {
    case 'const': {
      logger.info(`No dependency since wei is ${JSON.stringify(symbol)}`)
      break
    }
    case 'symbol': {
      const foundSymbols = find(symbol, ([type, name]) => type == 'symbol' && name == 'NUMBER')
      if (foundSymbols.length > 0) {
        logger.info(`Number dependency since wei is ${JSON.stringify(symbol)}`)
      } else {
        const root = { me: symbol, childs: [] }
        buildDependencyTree(root, traces)
        console.log('////TREE')
        prettifyTree(root)
      }
      break
    }
  }
}

module.exports = {
  analyze,
} 
