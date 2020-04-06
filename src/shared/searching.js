const assert = require('assert')
const { uniqBy } = require('lodash')
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

module.exports = {
  findSymbol,
  findSymbols,
  findOperands,
}

