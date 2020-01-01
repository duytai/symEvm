const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Web3 = require('web3')
const Contract = require('../src/contract')
const { logger } = require('../src/shared')

const binFolder = path.join(__dirname, 'bin/')
const binFiles = fs.readdirSync(binFolder).sort()
const allowedContract = process.env.CONTRACT

const main = async() => {
  if (allowedContract.startsWith('0x')) {
    const web3 = new Web3('https://mainnet.infura.io/v3/6f9974d98d0941629d72a2c830f47ecd')
    const code = await web3.eth.getCode(allowedContract)
    assert(code, 'Code must exist')
    const bin = code.slice(2)
    logger.info(`binLengh: ${bin.length}`)
    const contract = new Contract(Buffer.from(bin, 'hex'))
    contract.execute()
  } else {
    const binFile = binFiles[allowedContract]
    assert(binFile, 'binFile must exist')
    logger.info(`binFile ${binFile}`)
    const bin = fs.readFileSync(path.join(binFolder, binFile), 'utf8').slice(2)
    logger.info(`binLengh: ${bin.length}`)
    const contract = new Contract(Buffer.from(bin, 'hex'))
    contract.execute()
    logger.info(`binFile ${binFile}`)
  }
}

main().then(() => {
  console.log('>> Done')
})