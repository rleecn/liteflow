/**
 * LiteFlow 图引擎
 * 管理节点和边的数据，提供增删改查操作
 * 核心设计：数据与渲染分离，引擎只管数据
 */
import type { LFNode, LFEdge, LFGraph, LFGroup } from './types'
import { getNodeType } from './registry'

let _nodeIdCounter = 0
let _groupIdCounter = 0

function nextNodeId(): string {
  return `n-${++_nodeIdCounter}`
}

function nextGroupId(): string {
  return `g-${++_groupIdCounter}`
}

export class LFEngine {
  nodes: LFNode[] = []
  edges: LFEdge[] = []
  groups: LFGroup[] = []

  /** 节点查找索引（手动维护，O(1)查找） */
  private _nodeMap = new Map<string, LFNode>()

  /** 数据版本号，用于缩略图缓存判断 */
  _version = 0

  // ==================== 节点操作 ====================

  addNode(type: string, data?: Record<string, any>, position?: [number, number]): LFNode {
    const nodeType = getNodeType(type)
    if (!nodeType) throw new Error(`Unknown node type: ${type}`)

    const id = nextNodeId()
    const nodeData = { ...nodeType.defaultData, ...data }
    const node: LFNode = {
      id,
      type,
      x: position ? position[0] : 100 + ((_nodeIdCounter % 10) * 280),
      y: position ? position[1] : 100 + (Math.floor(_nodeIdCounter / 10) * 200),
      width: 240,
      height: 0, // 由渲染器根据内容计算
      minHeight: 0, // 0 表示自动计算
      data: nodeData,
      selected: false,
      collapsed: false,
      _bbox: new Float32Array(4),
    }
    this._updateBBox(node)
    this.nodes.push(node)
    this._nodeMap.set(id, node)
    this._version++
    return node
  }

  removeNode(id: string): void {
    const idx = this.nodes.findIndex(n => n.id === id)
    if (idx === -1) return
    this.nodes.splice(idx, 1)
    this._nodeMap.delete(id)
    // 删除关联的边
    this.edges = this.edges.filter(e => e.sourceId !== id && e.targetId !== id)
    this._version++
  }

  getNode(id: string): LFNode | undefined {
    return this._nodeMap.get(id)
  }

  moveNode(id: string, x: number, y: number): void {
    const node = this._nodeMap.get(id)
    if (!node) return
    node.x = x
    node.y = y
    this._updateBBox(node)
  }

  selectNode(id: string | null): void {
    for (const n of this.nodes) {
      n.selected = n.id === id
    }
  }

  duplicateNode(id: string): LFNode | null {
    const source = this._nodeMap.get(id)
    if (!source) return null
    const newNode = this.addNode(source.type, { ...source.data }, [source.x + 40, source.y + 40])
    return newNode
  }

  // ==================== 边操作 ====================

  addEdge(sourceId: string, sourceSlot: string | null, targetId: string, targetSlot: string | null = null): LFEdge {
    const id = `e-${sourceId}-${targetId}-${sourceSlot || ''}-${Date.now()}`
    const edge: LFEdge = { id, sourceId, sourceSlot, targetId, targetSlot }
    this.edges.push(edge)
    this._version++
    return edge
  }

  removeEdge(id: string): void {
    const idx = this.edges.findIndex(e => e.id === id)
    if (idx !== -1) this.edges.splice(idx, 1)
    this._version++
  }

  getEdgesOfNode(nodeId: string): LFEdge[] {
    return this.edges.filter(e => e.sourceId === nodeId || e.targetId === nodeId)
  }

  // ==================== 分组操作 ====================

  addGroup(title: string, x: number, y: number, width = 400, height = 300, color = '#2a4a6b'): LFGroup {
    const id = nextGroupId()
    const group: LFGroup = {
      id,
      title,
      x, y, width, height,
      color,
      nodeIds: [],
      _bbox: new Float32Array(4),
    }
    this.updateGroupBBox(group)
    this.groups.push(group)
    this._version++
    return group
  }

  removeGroup(id: string): void {
    const idx = this.groups.findIndex(g => g.id === id)
    if (idx !== -1) this.groups.splice(idx, 1)
    this._version++
  }

  getGroup(id: string): LFGroup | undefined {
    return this.groups.find(g => g.id === id)
  }

  moveGroup(id: string, dx: number, dy: number): void {
    const group = this.groups.find(g => g.id === id)
    if (!group) return
    group.x += dx
    group.y += dy
    this.updateGroupBBox(group)
    // 移动分组内所有节点
    for (const nodeId of group.nodeIds) {
      const node = this._nodeMap.get(nodeId)
      if (node) {
        node.x += dx
        node.y += dy
        this._updateBBox(node)
      }
    }
  }

  /** 更新分组包含的节点（根据节点中心点是否在分组区域内） */
  updateGroupNodes(group: LFGroup): void {
    group.nodeIds = []
    for (const node of this.nodes) {
      const nodeCx = node.x + node.width / 2
      const nodeCy = node.y + (node.height || 200) / 2
      if (nodeCx >= group.x && nodeCx <= group.x + group.width &&
          nodeCy >= group.y && nodeCy <= group.y + group.height) {
        group.nodeIds.push(node.id)
      }
    }
  }

  /** 查找节点所在的分组 */
  getGroupOfNode(nodeId: string): LFGroup | undefined {
    return this.groups.find(g => g.nodeIds.includes(nodeId))
  }

  updateGroupBBox(group: LFGroup): void {
    group._bbox[0] = group.x
    group._bbox[1] = group.y
    group._bbox[2] = group.width
    group._bbox[3] = group.height
  }

  // ==================== 序列化 ====================

  serialize(): LFGraph {
    return {
      nodes: this.nodes.map(n => ({
        id: n.id, type: n.type, x: n.x, y: n.y,
        width: n.width, height: n.height, minHeight: n.minHeight,
        data: { ...n.data }, selected: false, collapsed: n.collapsed,
        _bbox: new Float32Array(n._bbox),
      })),
      edges: this.edges.map(e => ({ ...e })),
      groups: this.groups.map(g => ({
        id: g.id, title: g.title, x: g.x, y: g.y,
        width: g.width, height: g.height, color: g.color,
        nodeIds: [...g.nodeIds],
        _bbox: new Float32Array(g._bbox),
      })),
    }
  }

  deserialize(graph: LFGraph): void {
    this.clear()
    for (const n of graph.nodes) {
      const node: LFNode = {
        ...n,
        selected: false,
        _bbox: new Float32Array(4),
      }
      this._updateBBox(node)
      this.nodes.push(node)
      this._nodeMap.set(node.id, node)
    }
    this.edges = graph.edges.map(e => ({ ...e }))
    if (graph.groups) {
      for (const g of graph.groups) {
        const group: LFGroup = {
          ...g,
          _bbox: new Float32Array(4),
        }
        this.updateGroupBBox(group)
        this.groups.push(group)
      }
    }
    // 更新ID计数器
    const maxId = this.nodes.reduce((max, n) => {
      const num = parseInt(n.id.replace('n-', ''), 10)
      return isNaN(num) ? max : Math.max(max, num)
    }, 0)
    _nodeIdCounter = maxId
    const maxGId = this.groups.reduce((max, g) => {
      const num = parseInt(g.id.replace('g-', ''), 10)
      return isNaN(num) ? max : Math.max(max, num)
    }, 0)
    _groupIdCounter = maxGId
  }

  clear(): void {
    this.nodes = []
    this.edges = []
    this.groups = []
    this._nodeMap.clear()
    _nodeIdCounter = 0
    _groupIdCounter = 0
  }

  // ==================== 内部方法 ====================

  private _updateBBox(node: LFNode): void {
    node._bbox[0] = node.x
    node._bbox[1] = node.y
    node._bbox[2] = node.width
    node._bbox[3] = node.height || 200
  }

  /** 批量更新包围盒（在高度计算后调用） */
  updateNodeBBox(node: LFNode, width: number, height: number): void {
    node.width = width
    node.height = height
    node._bbox[0] = node.x
    node._bbox[1] = node.y
    node._bbox[2] = width
    node._bbox[3] = height
  }
}
