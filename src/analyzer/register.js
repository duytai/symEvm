const assert = require('assert')
const DNode = require('./dnode')
const StackVar = require('./stackvar')
const {
  logger,
  prettify,
  findSymbol,
  formatSymbol,
  toRId,
} = require('../shared')
const { StateVariable, LocalVariable } = require('../variable')

class Register {
  constructor(symbol, trackingPos, ep, endPoints, visited = []) {
    const id = toRId(trackingPos, ep.last().pc, symbol)
    visited.push(id)
    this.trackingPos = trackingPos
    this.dnode = new DNode(symbol, ep.last().pc, id)
    this.ep = ep
    this.endPoints = endPoints
    this.internalAnalysis(symbol, this.dnode, visited)
    // this.conditionAnalysis(symbol, this.dnode, visited)
    // this.crossfunctionAnalysis(symbol, this.dnode, visited)
  }

  internalAnalysis(symbol, dnode, visited) {
    assert(symbol && dnode && visited)
    switch (symbol[1]) {
      case 'MLOAD': {
        const subEpSize = symbol[5][1].toNumber()
        const subEp = this.ep.sub(subEpSize)
        const localVariable = new LocalVariable(symbol[2], subEp)
        dnode.node.variable = localVariable
        dnode.node.alias = localVariable.toAlias()
        subEp.eachLocalVariable(({ variable: otherVariable, subEp, storedLoc, storedValue, kTrackingPos, vTrackingPos }) => {
          if (localVariable.eq(otherVariable)) {
            if (!visited.includes(toRId(vTrackingPos, subEp.last().pc, storedValue))) {
              const subRegister = new Register(storedValue, vTrackingPos, subEp, this.endPoints, visited)
              dnode.addChild(subRegister.dnode)
              subRegister.dnode.addParent(dnode)
            }
            if (!visited.includes(toRId(kTrackingPos, subEp.last().pc, storedLoc))) {
              const subRegister = new Register(storedLoc, kTrackingPos, subEp, this.endPoints, visited)
              dnode.addChild(subRegister.dnode)
              subRegister.dnode.addParent(dnode)
            }
          }
        })
        break
      }
      case 'SLOAD': {
        const subEpSize = symbol[4][1].toNumber()
        const subEp = this.ep.sub(subEpSize)
        const stateVariable = new StateVariable(symbol[2], subEp)
        dnode.node.variable = stateVariable
        dnode.node.alias = stateVariable.toAlias()
        subEp.eachStateVariable(({ variable: otherVariable, subEp, storedLoc, storedValue, kTrackingPos, vTrackingPos }) => {
          if (stateVariable.eq(otherVariable)) {
            if (!visited.includes(toRId(vTrackingPos, subEp.last().pc, storedValue))) {
              const subRegister = new Register(storedValue, vTrackingPos, subEp, this.endPoints, visited)
              dnode.addChild(subRegister.dnode)
              subRegister.dnode.addParent(dnode)
            }
            if (!visited.includes(toRId(kTrackingPos, subEp.last().pc, storedLoc))) {
              const subRegister = new Register(storedLoc, kTrackingPos, subEp, this.endPoints, visited)
              dnode.addChild(subRegister.dnode)
              subRegister.dnode.addParent(dnode)
            }
          }
        })
        break
      }
      default: {
        const symbols = findSymbol(symbol, ([type, name]) => ['SLOAD', 'MLOAD'].includes(name))
        symbols.forEach(symbol => {
          const id = toRId(this.trackingPos, this.ep.last().pc, symbol)
          const subNode = new DNode(symbol, this.ep.last().pc, id)
          this.internalAnalysis(symbol, subNode, visited)
          dnode.addChild(subNode)
          subNode.addParent(dnode)
        })
      }
    }
  }

  conditionAnalysis(_, dnode, visited) {
    const pcs = [this.ep.last().pc]
    const condition = new Condition(this.ep, this.endPoints)
    const stackVar = new StackVar(this.ep)
    const ancestors = stackVar.myAncestors(this.trackingPos)
    ancestors.forEach(ancestor => pcs.push(ancestor))
    const conds = condition.batchFindConds(pcs) 
    conds.forEach(({ pc, cond, epIdx, trackingPos }) => {
      const subEp = this.ep.sub(epIdx + 1)
      assert(subEp.last().pc == pc)
      if (!visited.includes(toRId(trackingPos, subEp.last().pc, cond))) {
        const subRegister = new Register(cond, trackingPos, subEp, this.endPoints, visited)
        dnode.addChild(subRegister.dnode)
        subRegister.dnode.addParent(dnode)
      }
    })
  }

  crossfunctionAnalysis(_, dnode, visited) {
    const sloads = dnode.findSloads()
    sloads.forEach(sload => {
      const { variable: stateVariable } = sload.node
      this.endPoints.forEach(ep => {
        ep.eachStateVariable(({ variable: otherVariable, subEp, storedLoc, storedValue, kTrackingPos, vTrackingPos }) => {
          if (stateVariable.eq(otherVariable)) {
            if (!visited.includes(toRId(vTrackingPos, subEp.last().pc, storedValue))) {
              const subRegister = new Register(storedValue, vTrackingPos, subEp, this.endPoints, visited)
              dnode.addChild(subRegister.dnode)
              subRegister.dnode.addParent(dnode)
            }
            if (!visited.includes(toRId(kTrackingPos, subEp.last().pc, storedLoc))) {
              const subRegister = new Register(storedLoc, kTrackingPos, subEp, this.endPoints, visited)
              dnode.addChild(subRegister.dnode)
              subRegister.dnode.addParent(dnode)
            }
          }
        })
      })
    })
  }

  prettify(srcmap) {
    this.dnode.prettify(0, srcmap)
  }
}

module.exports = Register 
