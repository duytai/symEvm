const assert = require('assert')
const { uniqBy, lastIndexOf } = require('lodash')
const { prettify, formatSymbol } = require('./prettify')
const BN = require('bn.js')
const jp = require('jsonpath')

const findSymbol = (symbol, cond) => {
  const [type, name, ...params] = symbol
  if (cond(symbol)) return [symbol]
  return params.reduce(
    (agg, symbol) => [...agg, ...findSymbol(symbol, cond)],
    [],
  )
}

const findSymbols = (symbol, cond) => {
  const [type, name, ...params] = symbol
  if (type == 'const') return []
  return params.reduce(
    (agg, symbol) => [...agg, ...findSymbols(symbol, cond)],
    cond(symbol) ? [symbol] : [],
  )
} 

const findOperands = (pc, srcmap, ast) => {
  const { s, l } = srcmap.toSL(pc)
  const key = [s, l, 0].join(':')
  const response = jp.query(ast, `$..children[?(@.src=="${key}")]`)
  assert(response.length >= 1)
  const { children, name, attributes } = response[response.length - 1]
  const { operator } = attributes
  const ret = { range: [s, s + l], operands: [], operator }
  children.forEach(({ src, attributes }) => {
    const { type } = attributes 
    const [s, l] = src.split(':').map(x => parseInt(x))
    const id = srcmap.source.slice(s, s + l)
    ret.operands.push({ id, type, range: [s, s + l]})
  })
  return ret
}

const findPayables = (srcmap, ast) => {
  const selector = `$..children[?(@.name=="FunctionDefinition" && @.attributes.stateMutability=="payable")]`
  const response = jp.query(ast, selector)
  assert(response.length >= 1)
  const ret = []
  for (const idx in response) {
    const func = response[idx]
    assert(func.name == 'FunctionDefinition')
    const block = func.children[func.children.length - 1]
    assert(block.name == 'Block')
    const blockSrc = block.src.split(':').map(x => parseInt(x))
    const source = srcmap.source.slice(0, blockSrc[0])
    const s = source.lastIndexOf('payable')
    assert(s != -1)
    ret.push({ range: [s, s + 'payable'.length], operator: 'payable' })
  }
  return ret
}

module.exports = {
  findSymbol,
  findSymbols,
  findOperands,
  findPayables,
}

