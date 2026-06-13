/**
 * LiteFlow 类型定义
 */

export interface LFNode {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  /** 用户手动设置的最小高度，0 表示自动计算 */
  minHeight: number
  data: Record<string, any>
  selected: boolean
  collapsed: boolean
  /** 预计算的包围盒，避免每帧重算 */
  _bbox: Float32Array
}

export interface LFEdge {
  id: string
  sourceId: string
  sourceSlot: string | null
  targetId: string
  targetSlot: string | null
}

export interface LFSlot {
  id: string
  label: string
  dir: 'in' | 'out'
  color: string
}

export interface LFNodeType {
  type: string
  title: string
  icon: string
  category: string
  color: string
  borderColor: string
  headerColor: string
  slots: LFSlot[]
  fields: LFField[]
  defaultData: Record<string, any>
  /** 自定义绘制（可选，覆盖默认绘制） */
  drawBody?: (ctx: CanvasRenderingContext2D, node: LFNode, lod: LODLevel, nodeType: LFNodeType) => void
}

export interface LFField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'range' | 'number'
  options?: string[]
  min?: number
  max?: number
  step?: number
}

export interface LFGroup {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  color: string
  /** 包含的节点ID列表（自动计算） */
  nodeIds: string[]
  /** 预计算的包围盒 */
  _bbox: Float32Array
}

export type LODLevel = 'full' | 'medium' | 'minimal'

export interface LFViewport {
  x: number
  y: number
  zoom: number
}

export interface LFGraph {
  nodes: LFNode[]
  edges: LFEdge[]
  groups: LFGroup[]
}

export interface LFPoint {
  x: number
  y: number
}

/** 渲染统计信息 */
export interface LFStats {
  totalNodes: number
  visibleNodes: number
  totalEdges: number
  visibleEdges: number
  fps: number
  lod: LODLevel
}
