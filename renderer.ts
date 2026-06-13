/**
 * LiteFlow Canvas 渲染器
 */
import type { LFNode, LFEdge, LFViewport, LODLevel, LFStats, LFPoint, LFGroup } from './types'
import type { LFEngine } from './engine'
import { getNodeType } from './registry'
import type { LFNodeType, LFSlot } from './types'

// ==================== 常量 ====================

const GRID_SIZE = 20
const GRID_COLOR = 'rgba(255,255,255,0.05)'
const GRID_COLOR_MAJOR = 'rgba(255,255,255,0.08)'
const BG_COLOR = '#1a1a2e'

const NODE_RADIUS = 10
const NODE_HEADER_H = 32
const NODE_SLOT_H = 24
const NODE_FIELD_H = 28
const NODE_PADDING = 10
const NODE_MIN_WIDTH = 240
const NODE_MIN_HEIGHT = NODE_HEADER_H

const SLOT_RADIUS = 5
const SLOT_HIT_RADIUS = 10

const LINK_WIDTH = 2
const LINK_HIT_DISTANCE = 8

// 阴影阈值：节点数超过此值时禁用阴影
const SHADOW_NODE_THRESHOLD = 200

// 复用临时变量
const _tempBBox = new Float32Array(4)
const _linkBBox = new Float32Array(4)
const _marginArea = new Float32Array(4)

// ==================== 预计算节点类型信息 ====================

interface CachedNodeType {
  outSlots: LFSlot[]
  inSlots: LFSlot[]
  outSlotCount: number
  inSlotCount: number
  /** full LOD 下的节点高度 */
  fullHeight: number
  /** medium LOD 下的节点高度 */
  mediumHeight: number
  /** minimal LOD 下的节点高度（有 progress） */
  minimalHeightWithProgress: number
  /** minimal LOD 下的节点高度（无 progress） */
  minimalHeightNoProgress: number
  /** 输出端口起始 Y 偏移（full LOD） */
  outSlotStartY_full: number
  /** 输出端口起始 Y 偏移（minimal LOD） */
  outSlotStartY_minimal: number
  /** 是否有 progress 字段 */
  hasProgress: boolean
}

const _cachedNodeTypes: Record<string, CachedNodeType> = {}

function _cacheNodeType(type: string, nodeType: LFNodeType): CachedNodeType {
  if (_cachedNodeTypes[type]) return _cachedNodeTypes[type]

  const outSlots = nodeType.slots.filter(s => s.dir === 'out')
  const inSlots = nodeType.slots.filter(s => s.dir === 'in')
  const hasProgress = nodeType.fields.some(f => f.key === 'progress')

  // full LOD 高度（不绘制 range 和 textarea）
  let fullH = NODE_HEADER_H + NODE_PADDING
  let hasVisibleField = false
  for (const field of nodeType.fields) {
    if (field.type === 'range') continue
    if (field.type === 'textarea') continue
    fullH += NODE_FIELD_H
    hasVisibleField = true
  }
  // 如果没有可见字段（如备注节点），不显示内容区
  if (!hasVisibleField) {
    fullH = NODE_HEADER_H
  } else {
    fullH += outSlots.length * NODE_SLOT_H + 8
  }

  // medium LOD 高度
  const mediumH = NODE_HEADER_H + 24

  // minimal LOD 高度
  const minimalHWithProgress = 27
  const minimalHNoProgress = 24

  // 输出端口起始 Y
  const outSlotStartY_full = fullH - outSlots.length * NODE_SLOT_H - 4
  const outSlotStartY_minimal = NODE_HEADER_H + 4

  const cached: CachedNodeType = {
    outSlots,
    inSlots,
    outSlotCount: outSlots.length,
    inSlotCount: inSlots.length,
    fullHeight: fullH,
    mediumHeight: mediumH,
    minimalHeightWithProgress: minimalHWithProgress,
    minimalHeightNoProgress: minimalHNoProgress,
    outSlotStartY_full,
    outSlotStartY_minimal,
    hasProgress,
  }
  _cachedNodeTypes[type] = cached
  return cached
}

/** 获取节点类型缓存，未命中时自动构建（支持运行时注册的自定义类型） */
function _getCachedNodeType(type: string): CachedNodeType | null {
  if (_cachedNodeTypes[type]) return _cachedNodeTypes[type]
  const nodeType = getNodeType(type)
  if (!nodeType) return null
  return _cacheNodeType(type, nodeType)
}

// ==================== 工具函数 ====================

function overlapBounding(a: Float32Array | number[], b: Float32Array | number[]): boolean {
  const aRight = a[0] + a[2]
  const aBottom = a[1] + a[3]
  const bRight = b[0] + b[2]
  const bBottom = b[1] + b[3]
  return a[0] < bRight && aRight > b[0] && a[1] < bBottom && aBottom > b[1]
}

function bezierPoint(
  x1: number, y1: number,
  cx1: number, cy1: number,
  cx2: number, cy2: number,
  x2: number, y2: number,
  t: number
): [number, number] {
  const u = 1 - t
  const tt = t * t
  const uu = u * u
  const uuu = uu * u
  const ttt = tt * t
  return [
    uuu * x1 + 3 * uu * t * cx1 + 3 * u * tt * cx2 + ttt * x2,
    uuu * y1 + 3 * uu * t * cy1 + 3 * u * tt * cy2 + ttt * y2,
  ]
}

/** 文本自动换行，返回分行数组 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return ['-']
  const lines: string[] = []
  const paragraphs = String(text).split('\n')
  for (const para of paragraphs) {
    if (para === '') { lines.push(''); continue }
    let currentLine = ''
    for (let i = 0; i < para.length; i++) {
      const testLine = currentLine + para[i]
      if (ctx.measureText(testLine).width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine)
        currentLine = para[i]
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) lines.push(currentLine)
  }
  return lines.length > 0 ? lines : ['-']
}

// ==================== 渲染器 ====================

export class LFRenderer {
  private _canvas: HTMLCanvasElement
  private _bgCanvas: HTMLCanvasElement
  private _ctx: CanvasRenderingContext2D
  private _bgCtx: CanvasRenderingContext2D

  private _engine: LFEngine

  // 视口
  private _vpX = 0
  private _vpY = 0
  private _vpZoom = 1
  private _contW = 0
  private _contH = 0

  // 可见区域（世界坐标）
  private _visibleArea = new Float32Array(4)

  // 脏标记
  private _dirtyBg = true
  private _dirtyFg = true

  // 渲染循环
  private _rafId = 0
  private _isRendering = false
  private _lastTime = 0
  private _fps = 0

  // 可见节点缓存
  private _visibleNodes: LFNode[] = []

  // 交互状态
  private _draggingNode: LFNode | null = null
  private _dragOffsetX = 0
  private _dragOffsetY = 0
  private _panning = false
  private _panStartX = 0
  private _panStartY = 0
  private _panStartVpX = 0
  private _panStartVpY = 0

  // 连线拖拽
  private _connectingFrom: { nodeId: string; slotId: string; slotDir: 'in' | 'out'; x: number; y: number } | null = null
  private _mouseX = 0
  private _mouseY = 0

  // 节点缩放
  private _resizingNode: LFNode | null = null
  private _resizeStartMouseX = 0
  private _resizeStartMouseY = 0
  private _resizeStartWidth = 0
  private _resizeStartMinHeight = 0

  // 分组拖拽
  private _draggingGroup: LFGroup | null = null
  private _dragGroupLastX = 0
  private _dragGroupLastY = 0

  // 分组缩放
  private _resizingGroup: LFGroup | null = null
  private _resizeGroupStartMouseX = 0
  private _resizeGroupStartMouseY = 0
  private _resizeGroupStartWidth = 0
  private _resizeGroupStartHeight = 0

  // 选中节点
  private _selectedNodeId: string | null = null

  // 回调
  onNodeSelect: ((node: LFNode | null) => void) | null = null
  onContextMenu: ((params: { x: number; y: number; type: 'node' | 'edge' | 'pane'; targetId: string }) => void) | null = null
  onConnect: ((sourceId: string, sourceSlot: string | null, targetId: string) => void) | null = null
  /** 从输出端口拖线到空白区域时触发，用于自动创建节点 */
  onConnectToEmpty: ((params: { sourceId: string; sourceSlot: string; worldX: number; worldY: number }) => void) | null = null

  // 统计
  private _stats: LFStats = {
    totalNodes: 0, visibleNodes: 0, totalEdges: 0, visibleEdges: 0, fps: 0, lod: 'full',
  }

  get stats(): LFStats { return this._stats }
  get viewport(): LFViewport { return { x: this._vpX, y: this._vpY, zoom: this._vpZoom } }
  get selectedNodeId(): string | null { return this._selectedNodeId }

  constructor(canvas: HTMLCanvasElement, bgCanvas: HTMLCanvasElement, engine: LFEngine) {
    this._canvas = canvas
    this._bgCanvas = bgCanvas
    this._engine = engine

    this._ctx = canvas.getContext('2d')!
    this._bgCtx = bgCanvas.getContext('2d')!

    this._bindEvents()
  }

  // ==================== 生命周期 ====================

  startRendering(): void {
    if (this._isRendering) return
    this._isRendering = true
    this._lastTime = performance.now()
    this._renderLoop()
  }

  stopRendering(): void {
    this._isRendering = false
    if (this._rafId) {
      cancelAnimationFrame(this._rafId)
      this._rafId = 0
    }
  }

  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1
    this._canvas.width = width * dpr
    this._canvas.height = height * dpr
    this._canvas.style.width = width + 'px'
    this._canvas.style.height = height + 'px'
    this._bgCanvas.width = width * dpr
    this._bgCanvas.height = height * dpr
    this._bgCanvas.style.width = width + 'px'
    this._bgCanvas.style.height = height + 'px'
    this._contW = width
    this._contH = height
    this._dirtyBg = true
    this._dirtyFg = true
  }

  markDirty(): void {
    this._dirtyBg = true
    this._dirtyFg = true
  }

  // ==================== 坐标转换 ====================

  screenToWorld(sx: number, sy: number): LFPoint {
    const dpr = window.devicePixelRatio || 1
    return {
      x: (sx * dpr - this._vpX) / (this._vpZoom * dpr),
      y: (sy * dpr - this._vpY) / (this._vpZoom * dpr),
    }
  }

  worldToScreen(wx: number, wy: number): LFPoint {
    const dpr = window.devicePixelRatio || 1
    return {
      x: wx * this._vpZoom + this._vpX / dpr,
      y: wy * this._vpZoom + this._vpY / dpr,
    }
  }

  // ==================== 视口 ====================

  setViewport(x: number, y: number, zoom: number): void {
    this._vpX = x
    this._vpY = y
    this._vpZoom = zoom
    this._computeVisibleArea()
    this._dirtyBg = true
    this._dirtyFg = true
  }

  private _computeVisibleArea(): void {
    const dpr = window.devicePixelRatio || 1
    if (this._contW === 0) {
      this._visibleArea.set([0, 0, 0, 0])
      return
    }
    const startx = -this._vpX / (this._vpZoom * dpr)
    const starty = -this._vpY / (this._vpZoom * dpr)
    const w = this._contW / this._vpZoom
    const h = this._contH / this._vpZoom
    this._visibleArea[0] = startx
    this._visibleArea[1] = starty
    this._visibleArea[2] = w
    this._visibleArea[3] = h
  }

  private _getLOD(): LODLevel {
    if (this._vpZoom >= 0.5) return 'full'
    if (this._vpZoom >= 0.25) return 'medium'
    return 'minimal'
  }

  // ==================== 渲染循环 ====================

  private _renderLoop = (): void => {
    if (!this._isRendering) return

    const now = performance.now()
    const dt = now - this._lastTime
    this._lastTime = now
    this._fps = dt > 0 ? 1000 / dt : 0

    this._computeVisibleArea()
    this._computeVisibleNodes()

    if (this._dirtyBg) {
      this._drawBackground()
      this._dirtyBg = false
    }

    if (this._dirtyFg) {
      this._drawForeground()
      this._dirtyFg = false
    }

    this._updateStats()

    if (this._dirtyBg || this._dirtyFg || this._connectingFrom || this._draggingNode || this._draggingGroup || this._resizingNode || this._resizingGroup || this._panning) {
      this._rafId = requestAnimationFrame(this._renderLoop)
    } else {
      this._rafId = requestAnimationFrame(this._idleLoop)
    }
  }

  private _idleLoop = (): void => {
    if (!this._isRendering) return
    if (this._dirtyBg || this._dirtyFg) {
      this._rafId = requestAnimationFrame(this._renderLoop)
    } else {
      this._rafId = requestAnimationFrame(this._idleLoop)
    }
  }

  private _computeVisibleNodes(): void {
    this._visibleNodes.length = 0
    const area = this._visibleArea
    const buffer = 100
    _tempBBox[0] = area[0] - buffer
    _tempBBox[1] = area[1] - buffer
    _tempBBox[2] = area[2] + buffer * 2
    _tempBBox[3] = area[3] + buffer * 2

    const nodes = this._engine.nodes
    for (let i = 0, len = nodes.length; i < len; i++) {
      const n = nodes[i]
      if (overlapBounding(n._bbox, _tempBBox)) {
        this._visibleNodes.push(n)
      }
    }
  }

  // ==================== 背景层 ====================

  private _drawBackground(): void {
    const ctx = this._bgCtx
    const w = this._bgCanvas.width
    const h = this._bgCanvas.height
    const dpr = window.devicePixelRatio || 1

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)

    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, w, h)

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.translate(this._vpX / dpr, this._vpY / dpr)
    ctx.scale(this._vpZoom, this._vpZoom)

    this._drawGrid(ctx)

    ctx.restore()
  }

  private _drawGrid(ctx: CanvasRenderingContext2D): void {
    const area = this._visibleArea
    const startX = Math.floor(area[0] / GRID_SIZE) * GRID_SIZE
    const startY = Math.floor(area[1] / GRID_SIZE) * GRID_SIZE
    const endX = area[0] + area[2]
    const endY = area[1] + area[3]

    ctx.lineWidth = 1 / this._vpZoom

    // 小网格
    ctx.beginPath()
    for (let x = startX; x <= endX; x += GRID_SIZE) {
      if (x % (GRID_SIZE * 5) === 0) continue
      ctx.moveTo(x, startY)
      ctx.lineTo(x, endY)
    }
    for (let y = startY; y <= endY; y += GRID_SIZE) {
      if (y % (GRID_SIZE * 5) === 0) continue
      ctx.moveTo(startX, y)
      ctx.lineTo(endX, y)
    }
    ctx.strokeStyle = GRID_COLOR
    ctx.stroke()

    // 主网格
    ctx.beginPath()
    const majorSize = GRID_SIZE * 5
    const majorStartX = Math.floor(area[0] / majorSize) * majorSize
    const majorStartY = Math.floor(area[1] / majorSize) * majorSize
    for (let x = majorStartX; x <= endX; x += majorSize) {
      ctx.moveTo(x, startY)
      ctx.lineTo(x, endY)
    }
    for (let y = majorStartY; y <= endY; y += majorSize) {
      ctx.moveTo(startX, y)
      ctx.lineTo(endX, y)
    }
    ctx.strokeStyle = GRID_COLOR_MAJOR
    ctx.stroke()
  }

  // ==================== 前景层 ====================

  private _drawForeground(): void {
    const ctx = this._ctx
    const w = this._canvas.width
    const h = this._canvas.height
    const dpr = window.devicePixelRatio || 1

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.translate(this._vpX / dpr, this._vpY / dpr)
    ctx.scale(this._vpZoom, this._vpZoom)

    const lod = this._getLOD()
    const totalNodes = this._engine.nodes.length
    const enableShadow = totalNodes < SHADOW_NODE_THRESHOLD && lod !== 'minimal'

    // 绘制分组（在连线和节点下方）
    this._drawGroups(ctx, lod)

    // 绘制连线（在节点下方）
    this._drawConnections(ctx, lod)

    // 绘制节点
    const visibleNodes = this._visibleNodes
    for (let i = 0, len = visibleNodes.length; i < len; i++) {
      this._drawNode(ctx, visibleNodes[i], lod, enableShadow)
    }

    // 绘制正在拖拽的连线
    if (this._connectingFrom) {
      this._drawConnectingLine(ctx)
    }

    ctx.restore()
  }

  // ==================== 节点绘制 ====================

  private _drawNode(ctx: CanvasRenderingContext2D, node: LFNode, lod: LODLevel, enableShadow: boolean): void {
    const nodeType = getNodeType(node.type)
    if (!nodeType) return

    const cached = _getCachedNodeType(node.type)
    if (!cached) return
    const width = node.width || NODE_MIN_WIDTH

    // 动态计算高度（full LOD 根据内容自动换行）
    let height: number
    if (lod === 'full') {
      const bodyH = this._computeBodyHeight(node, nodeType, width)
      const autoH = bodyH > 0 ? NODE_HEADER_H + bodyH : NODE_HEADER_H
      height = Math.max(autoH, node.minHeight || 0)
    } else if (lod === 'medium') {
      height = cached.mediumHeight
    } else {
      height = cached.hasProgress && node.data.progress !== undefined
        ? cached.minimalHeightWithProgress
        : cached.minimalHeightNoProgress
    }

    // 更新包围盒
    node.height = height
    node._bbox[0] = node.x
    node._bbox[1] = node.y
    node._bbox[2] = width
    node._bbox[3] = height

    ctx.save()
    ctx.translate(node.x, node.y)

    // 阴影（性能杀手，大节点量时禁用）
    if (enableShadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.3)'
      ctx.shadowBlur = 12
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 4
    }

    // 节点背景
    ctx.beginPath()
    ctx.roundRect(0, 0, width, height, NODE_RADIUS)
    ctx.fillStyle = nodeType.color
    ctx.fill()

    // 清除阴影
    if (enableShadow) {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }

    // 边框
    ctx.beginPath()
    ctx.roundRect(0, 0, width, height, NODE_RADIUS)
    ctx.strokeStyle = node.selected ? '#fff' : nodeType.borderColor
    ctx.lineWidth = node.selected ? 2.5 : 1.5
    ctx.stroke()

    // 完成状态发光（仅少量节点时）
    if (enableShadow && node.data.progress >= 100) {
      ctx.shadowColor = 'rgba(74,222,128,0.3)'
      ctx.shadowBlur = 12
      ctx.beginPath()
      ctx.roundRect(0, 0, width, height, NODE_RADIUS)
      ctx.strokeStyle = '#4ade80'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }

    // 头部
    this._drawNodeHeader(ctx, node, nodeType, cached, width, lod)

    // 内容区
    if (lod === 'full') {
      this._drawNodeBody(ctx, node, nodeType, width)
    } else if (lod === 'medium') {
      this._drawNodeBodyMedium(ctx, node, width)
    }

    // minimal 模式下绘制迷你进度条
    if (lod === 'minimal' && cached.hasProgress && node.data.progress !== undefined) {
      const barY = height - 3
      ctx.fillStyle = 'rgba(0,0,0,0.2)'
      ctx.fillRect(0, barY, width, 3)
      const progress = Math.min(100, Math.max(0, node.data.progress || 0))
      ctx.fillStyle = progress >= 100 ? '#4ade80' : progress >= 50 ? '#fde047' : '#fca5a5'
      ctx.fillRect(0, barY, width * progress / 100, 3)
    }

    // 端口
    this._drawNodeSlots(ctx, node, cached, width, height, lod)

    // 选中节点的缩放手柄（圆形，压住边框）
    if (node.selected && lod !== 'minimal') {
      const hr = 5
      const hx = width
      const hy = height
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.beginPath()
      ctx.arc(hx, hy, hr, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(hx, hy, hr, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.restore()
  }

  private _drawNodeHeader(
    ctx: CanvasRenderingContext2D, node: LFNode, nodeType: LFNodeType,
    cached: CachedNodeType, width: number, lod: LODLevel
  ): void {
    const headerH = lod === 'minimal' ? 24 : NODE_HEADER_H

    // 头部背景
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(0, 0, width, headerH, [NODE_RADIUS, NODE_RADIUS, 0, 0])
    ctx.fillStyle = nodeType.headerColor
    ctx.fill()
    ctx.restore()

    // 图标 + 标题
    const fontSize = lod === 'minimal' ? 11 : 14
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.fillStyle = '#eee'
    ctx.textBaseline = 'middle'

    let titleText = node.data.name || node.data.title || nodeType.title
    // 备注节点用 content 前20字作为标题
    if (node.type === 'remark' && node.data.content) {
      titleText = String(node.data.content).substring(0, 20)
    }
    ctx.fillText(nodeType.icon, NODE_PADDING, headerH / 2)

    // 标题截断：超宽时显示省略号
    const titleX = NODE_PADDING + 18
    const maxTitleW = width - titleX - NODE_PADDING - (cached.hasProgress ? 44 : 0)
    let displayTitle = titleText
    if (ctx.measureText(displayTitle).width > maxTitleW) {
      while (displayTitle.length > 0 && ctx.measureText(displayTitle + '…').width > maxTitleW) {
        displayTitle = displayTitle.slice(0, -1)
      }
      displayTitle += '…'
    }
    ctx.fillText(displayTitle, titleX, headerH / 2)

    // 进度标记（full/medium LOD）
    if (lod !== 'minimal' && cached.hasProgress && node.data.progress !== undefined) {
      const progress = Math.min(100, Math.max(0, node.data.progress || 0))
      const badgeText = `${progress}%`
      // 固定宽度，避免 measureText
      const badgeW = 36
      const badgeX = width - badgeW - NODE_PADDING

      ctx.fillStyle = progress >= 100 ? 'rgba(74,222,128,0.3)' : progress >= 50 ? 'rgba(250,204,21,0.3)' : 'rgba(255,100,100,0.3)'
      ctx.beginPath()
      ctx.roundRect(badgeX, (headerH - 16) / 2, badgeW, 16, 8)
      ctx.fill()

      ctx.fillStyle = progress >= 100 ? '#4ade80' : progress >= 50 ? '#fde047' : '#fca5a5'
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      ctx.fillText(badgeText, badgeX + 5, headerH / 2)
    }
  }

  /** 计算节点内容区高度（基于文本自动换行） */
  private _computeBodyHeight(node: LFNode, nodeType: LFNodeType, width: number): number {
    const visibleFields = nodeType.fields.filter(f => f.type !== 'range' && f.type !== 'textarea')
    if (visibleFields.length === 0) return 0

    const ctx = this._ctx
    const maxTextWidth = width - NODE_PADDING * 2
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

    let bodyH = NODE_PADDING
    for (const field of visibleFields) {
      bodyH += 14 // label
      const value = String(node.data[field.key] || '-')
      const lines = wrapText(ctx, value, maxTextWidth)
      bodyH += lines.length * 16 + 4
    }

    const cached = _getCachedNodeType(node.type)
    bodyH += (cached?.outSlotCount || 0) * NODE_SLOT_H + 8

    return bodyH
  }

  private _drawNodeBody(
    ctx: CanvasRenderingContext2D, node: LFNode, nodeType: LFNodeType, width: number
  ): void {
    const bodyY = NODE_HEADER_H
    const maxTextWidth = width - NODE_PADDING * 2
    let y = bodyY + NODE_PADDING

    for (const field of nodeType.fields) {
      if (field.type === 'range') continue
      if (field.type === 'textarea') continue

      const value = node.data[field.key]
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      ctx.textBaseline = 'top'
      ctx.fillText(field.label, NODE_PADDING, y)
      y += 14

      ctx.fillStyle = '#eee'
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      const lines = wrapText(ctx, String(value || '-'), maxTextWidth)
      for (const line of lines) {
        ctx.fillText(line, NODE_PADDING, y)
        y += 16
      }
      y += 4
    }
  }

  private _drawNodeBodyMedium(
    ctx: CanvasRenderingContext2D, node: LFNode, width: number
  ): void {
    const bodyY = NODE_HEADER_H
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.textBaseline = 'top'

    let summary = ''
    if (node.data.priority) summary += `[${node.data.priority}] `
    if (node.data.status) summary += `${node.data.status} `
    if (node.data.progress !== undefined) summary += `${node.data.progress}% `
    if (node.data.assignee) summary += `· ${node.data.assignee} `
    if (node.data.description) summary += `- ${node.data.description.substring(0, 20)}`
    if (node.data.content) summary += `- ${node.data.content.substring(0, 20)}`
    if (!summary) summary = '无详情'

    ctx.fillText(summary, NODE_PADDING, bodyY + 6, width - NODE_PADDING * 2)
  }

  private _drawNodeSlots(
    ctx: CanvasRenderingContext2D, node: LFNode, cached: CachedNodeType,
    width: number, height: number, lod: LODLevel
  ): void {
    // 输入端口（左侧）
    if (cached.inSlotCount > 0) {
      const sy = NODE_HEADER_H / 2
      const sx = 0
      const r = lod === 'minimal' ? 3 : SLOT_RADIUS
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = cached.inSlots[0].color
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // 输出端口（右侧）
    const outSlots = cached.outSlots
    const outCount = cached.outSlotCount
    if (outCount > 0) {
      const slotStartY = lod === 'minimal'
        ? cached.outSlotStartY_minimal
        : (height || cached.fullHeight) - outCount * NODE_SLOT_H - 4
      const r = lod === 'minimal' ? 3 : SLOT_RADIUS

      for (let i = 0; i < outCount; i++) {
        const sy = slotStartY + i * NODE_SLOT_H + NODE_SLOT_H / 2
        const sx = width

        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fillStyle = outSlots[i].color
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()

        // 标签（非 minimal 模式）
        if (lod !== 'minimal') {
          ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          ctx.fillStyle = 'rgba(255,255,255,0.5)'
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'right'
          ctx.fillText(outSlots[i].label, sx - r - 6, sy)
          ctx.textAlign = 'left'
        }
      }
    }
  }

  // ==================== 分组绘制 ====================

  private _drawGroups(ctx: CanvasRenderingContext2D, lod: LODLevel): void {
    if (lod === 'minimal') return

    const groups = this._engine.groups
    const area = this._visibleArea
    const buffer = 50

    for (let i = 0, len = groups.length; i < len; i++) {
      const g = groups[i]

      // 视口裁剪
      _tempBBox[0] = g.x - buffer
      _tempBBox[1] = g.y - buffer
      _tempBBox[2] = g.width + buffer * 2
      _tempBBox[3] = g.height + buffer * 2
      if (!overlapBounding(_tempBBox, area)) continue

      ctx.save()

      // 分组背景（半透明）
      ctx.fillStyle = g.color + '20'
      ctx.fillRect(g.x, g.y, g.width, g.height)

      // 分组边框（虚线）
      ctx.strokeStyle = g.color + '80'
      ctx.lineWidth = 1.5
      ctx.setLineDash([8, 4])
      ctx.strokeRect(g.x, g.y, g.width, g.height)
      ctx.setLineDash([])

      // 右下角缩放手柄
      const hs = 8
      const hx = g.x + g.width - hs / 2
      const hy = g.y + g.height - hs / 2
      ctx.fillStyle = g.color + '80'
      ctx.beginPath()
      ctx.roundRect(hx, hy, hs, hs, 2)
      ctx.fill()

      ctx.restore()
    }
  }

  // ==================== 连线绘制 ====================

  private _drawConnections(ctx: CanvasRenderingContext2D, lod: LODLevel): void {
    if (lod === 'minimal') return

    const area = this._visibleArea
    const margin = 20
    _marginArea[0] = area[0] - margin
    _marginArea[1] = area[1] - margin
    _marginArea[2] = area[2] + margin * 2
    _marginArea[3] = area[3] + margin * 2

    const edges = this._engine.edges
    const isMedium = lod === 'medium'

    let visibleEdges = 0
    for (let i = 0, len = edges.length; i < len; i++) {
      const edge = edges[i]
      const sourceNode = this._engine.getNode(edge.sourceId)
      const targetNode = this._engine.getNode(edge.targetId)
      if (!sourceNode || !targetNode) continue

      // 快速裁剪：源或目标节点在视口内
      if (!overlapBounding(sourceNode._bbox, _marginArea) && !overlapBounding(targetNode._bbox, _marginArea)) continue

      const startPos = this.getSlotPosition(sourceNode, edge.sourceSlot || 'in')
      const endX = targetNode.x
      const endY = targetNode.y + NODE_HEADER_H / 2

      // 连线包围盒裁剪
      _linkBBox[0] = Math.min(startPos.x, endX)
      _linkBBox[1] = Math.min(startPos.y, endY)
      _linkBBox[2] = Math.abs(endX - startPos.x)
      _linkBBox[3] = Math.abs(endY - startPos.y)
      if (!overlapBounding(_linkBBox, _marginArea)) continue

      // 绘制贝塞尔曲线
      const dx = Math.abs(endX - startPos.x) * 0.5
      ctx.beginPath()
      ctx.moveTo(startPos.x, startPos.y)
      ctx.bezierCurveTo(startPos.x + dx, startPos.y, endX - dx, endY, endX, endY)

      const isComplete = targetNode.data?.progress >= 100
      ctx.strokeStyle = isComplete ? '#4ade80' : '#4a9ae0'
      ctx.lineWidth = isMedium ? 1.5 : LINK_WIDTH
      if (!isComplete && !isMedium) {
        ctx.setLineDash([8, 4])
      }
      ctx.stroke()
      if (!isComplete && !isMedium) {
        ctx.setLineDash([])
      }

      visibleEdges++
    }
    this._stats.visibleEdges = visibleEdges
  }

  private _drawConnectingLine(ctx: CanvasRenderingContext2D): void {
    if (!this._connectingFrom) return
    const from = this._connectingFrom
    const worldMouse = this.screenToWorld(this._mouseX, this._mouseY)

    ctx.beginPath()
    if (from.slotDir === 'out') {
      const dx = Math.abs(worldMouse.x - from.x) * 0.5
      ctx.moveTo(from.x, from.y)
      ctx.bezierCurveTo(from.x + dx, from.y, worldMouse.x - dx, worldMouse.y, worldMouse.x, worldMouse.y)
    } else {
      const dx = Math.abs(worldMouse.x - from.x) * 0.5
      ctx.moveTo(worldMouse.x, worldMouse.y)
      ctx.bezierCurveTo(worldMouse.x + dx, worldMouse.y, from.x - dx, from.y, from.x, from.y)
    }
    ctx.strokeStyle = '#aFA'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 3])
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ==================== 端口位置计算 ====================

  /** 获取输出端口的世界坐标（使用缓存，避免每帧 filter + indexOf） */
  getSlotPosition(node: LFNode, slotId: string): LFPoint {
    const cached = _getCachedNodeType(node.type)
    if (!cached) return { x: node.x, y: node.y }

    // 输入端口
    if (slotId === 'in') {
      return { x: node.x, y: node.y + NODE_HEADER_H / 2 }
    }

    // 输出端口
    const outSlots = cached.outSlots
    for (let i = 0; i < cached.outSlotCount; i++) {
      if (outSlots[i].id === slotId) {
        const lod = this._getLOD()
        const slotStartY = lod === 'minimal'
          ? cached.outSlotStartY_minimal
          : (node.height || cached.fullHeight) - cached.outSlotCount * NODE_SLOT_H - 4
        return {
          x: node.x + node.width,
          y: node.y + slotStartY + i * NODE_SLOT_H + NODE_SLOT_H / 2,
        }
      }
    }

    return { x: node.x, y: node.y }
  }

  // ==================== 交互事件 ====================

  private _bindEvents(): void {
    const el = this._canvas
    el.addEventListener('pointerdown', this._onPointerDown)
    el.addEventListener('pointermove', this._onPointerMove)
    el.addEventListener('pointerup', this._onPointerUp)
    el.addEventListener('wheel', this._onWheel, { passive: false })
    el.addEventListener('contextmenu', this._onContextMenu)
  }

  unbindEvents(): void {
    const el = this._canvas
    el.removeEventListener('pointerdown', this._onPointerDown)
    el.removeEventListener('pointermove', this._onPointerMove)
    el.removeEventListener('pointerup', this._onPointerUp)
    el.removeEventListener('wheel', this._onWheel)
    el.removeEventListener('contextmenu', this._onContextMenu)
  }

  private _onPointerDown = (e: PointerEvent): void => {
    const rect = this._canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    this._mouseX = sx
    this._mouseY = sy

    const world = this.screenToWorld(sx, sy)

    if (e.button === 2) return

    // 检查选中节点的缩放手柄（圆形）
    if (this._selectedNodeId) {
      const selNode = this._engine.getNode(this._selectedNodeId)
      if (selNode) {
        const nh = selNode.height || 200
        const hx = selNode.x + selNode.width
        const hy = selNode.y + nh
        if (Math.hypot(world.x - hx, world.y - hy) <= 7) {
          this._resizingNode = selNode
          this._resizeStartMouseX = world.x
          this._resizeStartMouseY = world.y
          this._resizeStartWidth = selNode.width
          this._resizeStartMinHeight = selNode.minHeight || selNode.height || 0
          this._canvas.setPointerCapture(e.pointerId)
          return
        }
      }
    }

    // 检查端口
    const slotHit = this._hitTestSlot(world.x, world.y)
    if (slotHit) {
      this._connectingFrom = {
        nodeId: slotHit.nodeId,
        slotId: slotHit.slotId,
        slotDir: slotHit.dir,
        x: slotHit.x,
        y: slotHit.y,
      }
      this._dirtyFg = true
      return
    }

    // 检查节点
    const hitNode = this._hitTestNode(world.x, world.y)
    if (hitNode) {
      this._draggingNode = hitNode
      this._dragOffsetX = world.x - hitNode.x
      this._dragOffsetY = world.y - hitNode.y

      this._selectedNodeId = hitNode.id
      this._engine.selectNode(hitNode.id)
      this.onNodeSelect?.(hitNode)
      this._dirtyFg = true
      this._canvas.setPointerCapture(e.pointerId)
      return
    }

    // 检查分组缩放手柄（手柄在分组边界外，需独立检测）
    const hitGroupHandle = this._hitTestGroupHandle(world.x, world.y)
    if (hitGroupHandle) {
      this._resizingGroup = hitGroupHandle
      this._resizeGroupStartMouseX = world.x
      this._resizeGroupStartMouseY = world.y
      this._resizeGroupStartWidth = hitGroupHandle.width
      this._resizeGroupStartHeight = hitGroupHandle.height
      this._canvas.setPointerCapture(e.pointerId)
      this._dirtyFg = true
      return
    }

    // 检查分组体（拖拽分组）
    const hitGroup = this._hitTestGroup(world.x, world.y)
    if (hitGroup) {
      this._draggingGroup = hitGroup
      this._dragGroupLastX = world.x
      this._dragGroupLastY = world.y
      this._canvas.setPointerCapture(e.pointerId)
      this._dirtyFg = true
      return
    }

    // 空白区域：平移
    this._panning = true
    this._panStartX = e.clientX
    this._panStartY = e.clientY
    this._panStartVpX = this._vpX
    this._panStartVpY = this._vpY
    this._canvas.setPointerCapture(e.pointerId)

    this._selectedNodeId = null
    this._engine.selectNode(null)
    this.onNodeSelect?.(null)
    this._dirtyFg = true
  }

  private _onPointerMove = (e: PointerEvent): void => {
    const rect = this._canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    this._mouseX = sx
    this._mouseY = sy

    if (this._connectingFrom) {
      this._dirtyFg = true
      return
    }

    if (this._resizingNode) {
      const world = this.screenToWorld(sx, sy)
      const dx = world.x - this._resizeStartMouseX
      const dy = world.y - this._resizeStartMouseY
      this._resizingNode.width = Math.max(NODE_MIN_WIDTH, this._resizeStartWidth + dx)
      this._resizingNode.minHeight = Math.max(NODE_MIN_HEIGHT, this._resizeStartMinHeight + dy)
      this._dirtyFg = true
      this._dirtyBg = true
      return
    }

    if (this._draggingNode) {
      const world = this.screenToWorld(sx, sy)
      this._engine.moveNode(this._draggingNode.id, world.x - this._dragOffsetX, world.y - this._dragOffsetY)
      this._dirtyFg = true
      this._dirtyBg = true
      return
    }

    if (this._resizingGroup) {
      const world = this.screenToWorld(sx, sy)
      const dx = world.x - this._resizeGroupStartMouseX
      const dy = world.y - this._resizeGroupStartMouseY
      this._resizingGroup.width = Math.max(100, this._resizeGroupStartWidth + dx)
      this._resizingGroup.height = Math.max(100, this._resizeGroupStartHeight + dy)
      this._engine.updateGroupBBox(this._resizingGroup)
      this._dirtyFg = true
      this._dirtyBg = true
      return
    }

    if (this._draggingGroup) {
      const world = this.screenToWorld(sx, sy)
      const dx = world.x - this._dragGroupLastX
      const dy = world.y - this._dragGroupLastY
      this._engine.moveGroup(this._draggingGroup.id, dx, dy)
      this._dragGroupLastX = world.x
      this._dragGroupLastY = world.y
      this._dirtyFg = true
      this._dirtyBg = true
      return
    }

    if (this._panning) {
      const dx = e.clientX - this._panStartX
      const dy = e.clientY - this._panStartY
      const dpr = window.devicePixelRatio || 1
      this._vpX = this._panStartVpX + dx * dpr
      this._vpY = this._panStartVpY + dy * dpr
      this._dirtyBg = true
      this._dirtyFg = true
      return
    }

    // 鼠标悬停缩放手柄时改变光标
    let cursorSet = false
    if (this._selectedNodeId) {
      const selNode = this._engine.getNode(this._selectedNodeId)
      if (selNode) {
        const world = this.screenToWorld(sx, sy)
        const nh = selNode.height || 200
        const hx = selNode.x + selNode.width
        const hy = selNode.y + nh
        if (Math.hypot(world.x - hx, world.y - hy) <= 7) {
          this._canvas.style.cursor = 'nwse-resize'
          cursorSet = true
        }
      }
    }
    // 检查分组缩放手柄
    if (!cursorSet) {
      const world = this.screenToWorld(sx, sy)
      const groups = this._engine.groups
      for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i]
        const hs = 8
        const hx = g.x + g.width - hs / 2
        const hy = g.y + g.height - hs / 2
        if (world.x >= hx - 2 && world.x <= hx + hs + 2 &&
            world.y >= hy - 2 && world.y <= hy + hs + 2) {
          this._canvas.style.cursor = 'nwse-resize'
          cursorSet = true
          break
        }
      }
    }
    if (!cursorSet) {
      this._canvas.style.cursor = ''
    }
  }

  private _onPointerUp = (e: PointerEvent): void => {
    if (this._connectingFrom) {
      const rect = this._canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const world = this.screenToWorld(sx, sy)

      const slotHit = this._hitTestSlot(world.x, world.y)
      if (slotHit && slotHit.nodeId !== this._connectingFrom.nodeId) {
        const from = this._connectingFrom
        if (from.slotDir === 'out' && slotHit.dir === 'in') {
          this.onConnect?.(from.nodeId, from.slotId, slotHit.nodeId)
        } else if (from.slotDir === 'in' && slotHit.dir === 'out') {
          this.onConnect?.(slotHit.nodeId, slotHit.slotId, from.nodeId)
        }
      } else if (this._connectingFrom.slotDir === 'out') {
        this.onConnectToEmpty?.({
          sourceId: this._connectingFrom.nodeId,
          sourceSlot: this._connectingFrom.slotId,
          worldX: world.x,
          worldY: world.y,
        })
      }

      this._connectingFrom = null
      this._dirtyFg = true
      return
    }

    if (this._resizingNode) {
      this._resizingNode = null
      return
    }

    if (this._draggingNode) {
      // 节点拖拽结束后，检查是否离开了所在分组
      const group = this._engine.getGroupOfNode(this._draggingNode.id)
      if (group) {
        const nodeCx = this._draggingNode.x + this._draggingNode.width / 2
        const nodeCy = this._draggingNode.y + (this._draggingNode.height || 200) / 2
        if (nodeCx < group.x || nodeCx > group.x + group.width ||
            nodeCy < group.y || nodeCy > group.y + group.height) {
          // 节点已移出分组，从分组中移除
          const idx = group.nodeIds.indexOf(this._draggingNode.id)
          if (idx !== -1) group.nodeIds.splice(idx, 1)
        }
      }
      this._engine._version++ // 通知缩略图更新
      this._draggingNode = null
      return
    }

    if (this._resizingGroup) {
      // 分组缩放结束后，更新分组包含的节点
      this._engine.updateGroupNodes(this._resizingGroup)
      this._engine._version++ // 通知缩略图更新
      this._resizingGroup = null
      return
    }

    if (this._draggingGroup) {
      // 分组拖拽结束后，更新分组包含的节点
      this._engine.updateGroupNodes(this._draggingGroup)
      this._engine._version++ // 通知缩略图更新
      this._draggingGroup = null
      return
    }

    if (this._panning) {
      this._panning = false
      return
    }
  }

  private _onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const rect = this._canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const mx = (e.clientX - rect.left) * dpr
    const my = (e.clientY - rect.top) * dpr

    const oldZoom = this._vpZoom
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    this._vpZoom = Math.min(2, Math.max(0.1, this._vpZoom * delta))

    const ratio = this._vpZoom / oldZoom
    this._vpX = mx - (mx - this._vpX) * ratio
    this._vpY = my - (my - this._vpY) * ratio

    this._dirtyBg = true
    this._dirtyFg = true
  }

  private _onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    const rect = this._canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const world = this.screenToWorld(sx, sy)

    const hitNode = this._hitTestNode(world.x, world.y)
    if (hitNode) {
      this._selectedNodeId = hitNode.id
      this._engine.selectNode(hitNode.id)
      this.onContextMenu?.({ x: e.clientX, y: e.clientY, type: 'node', targetId: hitNode.id })
    } else {
      const hitEdge = this._hitTestEdge(world.x, world.y)
      if (hitEdge) {
        this.onContextMenu?.({ x: e.clientX, y: e.clientY, type: 'edge', targetId: hitEdge.id })
      } else {
        this.onContextMenu?.({ x: e.clientX, y: e.clientY, type: 'pane', targetId: '' })
      }
    }
    this._dirtyFg = true
  }

  // ==================== 碰撞检测 ====================

  private _hitTestNode(wx: number, wy: number): LFNode | null {
    for (let i = this._visibleNodes.length - 1; i >= 0; i--) {
      const n = this._visibleNodes[i]
      if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + (n.height || 200)) {
        return n
      }
    }
    return null
  }

  private _hitTestGroup(wx: number, wy: number): LFGroup | null {
    const groups = this._engine.groups
    // 从后往前检测，后添加的分组在上层
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]
      if (wx >= g.x && wx <= g.x + g.width && wy >= g.y && wy <= g.y + g.height) {
        return g
      }
    }
    return null
  }

  private _hitTestGroupHandle(wx: number, wy: number): LFGroup | null {
    const groups = this._engine.groups
    const hs = 8
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]
      const hx = g.x + g.width - hs / 2
      const hy = g.y + g.height - hs / 2
      if (wx >= hx - 4 && wx <= hx + hs + 4 &&
          wy >= hy - 4 && wy <= hy + hs + 4) {
        return g
      }
    }
    return null
  }

  private _hitTestSlot(wx: number, wy: number): { nodeId: string; slotId: string; dir: 'in' | 'out'; x: number; y: number } | null {
    for (let i = this._visibleNodes.length - 1; i >= 0; i--) {
      const node = this._visibleNodes[i]
      const cached = _getCachedNodeType(node.type)
      if (!cached) continue

      // 输入端口
      if (cached.inSlotCount > 0) {
        const pos = { x: node.x, y: node.y + NODE_HEADER_H / 2 }
        if (Math.hypot(wx - pos.x, wy - pos.y) <= SLOT_HIT_RADIUS) {
          return { nodeId: node.id, slotId: cached.inSlots[0].id, dir: 'in', x: pos.x, y: pos.y }
        }
      }

      // 输出端口
      const lod = this._getLOD()
      const slotStartY = lod === 'minimal'
        ? cached.outSlotStartY_minimal
        : (node.height || cached.fullHeight) - cached.outSlotCount * NODE_SLOT_H - 4
      for (let j = 0; j < cached.outSlotCount; j++) {
        const pos = {
          x: node.x + node.width,
          y: node.y + slotStartY + j * NODE_SLOT_H + NODE_SLOT_H / 2,
        }
        if (Math.hypot(wx - pos.x, wy - pos.y) <= SLOT_HIT_RADIUS) {
          return { nodeId: node.id, slotId: cached.outSlots[j].id, dir: 'out', x: pos.x, y: pos.y }
        }
      }
    }
    return null
  }

  private _hitTestEdge(wx: number, wy: number): LFEdge | null {
    for (const edge of this._engine.edges) {
      const sourceNode = this._engine.getNode(edge.sourceId)
      const targetNode = this._engine.getNode(edge.targetId)
      if (!sourceNode || !targetNode) continue

      const startPos = this.getSlotPosition(sourceNode, edge.sourceSlot || 'in')
      const endX = targetNode.x
      const endY = targetNode.y + NODE_HEADER_H / 2

      const dx = Math.abs(endX - startPos.x) * 0.5
      for (let t = 0; t <= 1; t += 0.1) {
        const [px, py] = bezierPoint(
          startPos.x, startPos.y,
          startPos.x + dx, startPos.y,
          endX - dx, endY,
          endX, endY,
          t
        )
        if (Math.hypot(wx - px, wy - py) <= LINK_HIT_DISTANCE) {
          return edge
        }
      }
    }
    return null
  }

  // ==================== 工具方法 ====================

  private _updateStats(): void {
    this._stats.totalNodes = this._engine.nodes.length
    this._stats.visibleNodes = this._visibleNodes.length
    this._stats.totalEdges = this._engine.edges.length
    this._stats.fps = Math.round(this._fps)
    this._stats.lod = this._getLOD()
  }

  /** 适配视口以显示所有节点 */
  fitView(padding = 50): void {
    if (this._engine.nodes.length === 0) return
    const dpr = window.devicePixelRatio || 1

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of this._engine.nodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.width)
      maxY = Math.max(maxY, n.y + (n.height || 200))
    }

    const contentW = maxX - minX + padding * 2
    const contentH = maxY - minY + padding * 2
    const canvasW = this._contW
    const canvasH = this._contH

    const zoom = Math.min(canvasW / contentW, canvasH / contentH, 2)
    this._vpZoom = zoom
    this._vpX = (canvasW - contentW * zoom) / 2 * dpr - (minX - padding) * zoom * dpr
    this._vpY = (canvasH - contentH * zoom) / 2 * dpr - (minY - padding) * zoom * dpr

    this._dirtyBg = true
    this._dirtyFg = true
  }

  /** 将视口中心移动到指定节点 */
  focusNode(nodeId: string): void {
    const node = this._engine.getNode(nodeId)
    if (!node) return
    const dpr = window.devicePixelRatio || 1
    const cx = node.x + node.width / 2
    const cy = node.y + (node.height || 200) / 2
    this._vpX = this._contW * dpr / 2 - cx * this._vpZoom * dpr
    this._vpY = this._contH * dpr / 2 - cy * this._vpZoom * dpr
    this._dirtyBg = true
    this._dirtyFg = true
  }

  destroy(): void {
    this.stopRendering()
    this.unbindEvents()
  }

  // ==================== 缩略图 ====================

  private _minimapCache: HTMLCanvasElement | null = null
  private _minimapCacheKey = ''

  /** 绘制缩略图到指定 canvas */
  drawMinimap(miniCanvas: HTMLCanvasElement): void {
    const ctx = miniCanvas.getContext('2d')
    if (!ctx) return

    const nodes = this._engine.nodes
    const cw = miniCanvas.width
    const ch = miniCanvas.height

    // 计算缓存 key（节点数量+版本）
    const cacheKey = `${nodes.length}_${this._engine._version}`
    const cacheDirty = cacheKey !== this._minimapCacheKey

    // 节点层有变化时重建离屏缓存
    if (cacheDirty || !this._minimapCache) {
      if (!this._minimapCache) {
        this._minimapCache = document.createElement('canvas')
      }
      this._minimapCache.width = cw
      this._minimapCache.height = ch
      this._minimapCacheKey = cacheKey

      const offCtx = this._minimapCache.getContext('2d')!
      offCtx.clearRect(0, 0, cw, ch)

      // 背景
      offCtx.fillStyle = 'rgba(20, 20, 40, 0.85)'
      offCtx.fillRect(0, 0, cw, ch)

      if (nodes.length > 0) {
        // 计算所有节点的包围盒
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (let i = 0, len = nodes.length; i < len; i++) {
          const n = nodes[i]
          minX = Math.min(minX, n.x)
          minY = Math.min(minY, n.y)
          maxX = Math.max(maxX, n.x + n.width)
          maxY = Math.max(maxY, n.y + (n.height || 200))
        }

        const padding = 20
        const contentW = maxX - minX + padding * 2
        const contentH = maxY - minY + padding * 2
        const scale = Math.min(cw / contentW, ch / contentH)
        const offsetX = (cw - contentW * scale) / 2 - (minX - padding) * scale
        const offsetY = (ch - contentH * scale) / 2 - (minY - padding) * scale

        // 绘制节点到离屏缓存
        for (let i = 0, len = nodes.length; i < len; i++) {
          const n = nodes[i]
          const nodeType = getNodeType(n.type)
          if (!nodeType) continue

          const x = n.x * scale + offsetX
          const y = n.y * scale + offsetY
          const w = Math.max(n.width * scale, 2)
          const h = Math.max((n.height || 200) * scale, 2)

          offCtx.fillStyle = nodeType.color
          offCtx.fillRect(x, y, w, h)
        }

        // 存储变换参数供 navigateFromMinimap 使用
        this._minimapScale = scale
        this._minimapOffsetX = offsetX
        this._minimapOffsetY = offsetY
      }
    }

    // 从缓存绘制节点层
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    ctx.drawImage(this._minimapCache!, 0, 0)

    // 绘制视口矩形（每帧都更新）
    if (nodes.length > 0 && this._minimapScale > 0) {
      const area = this._visibleArea
      const vpX = area[0] * this._minimapScale + this._minimapOffsetX
      const vpY = area[1] * this._minimapScale + this._minimapOffsetY
      const vpW = area[2] * this._minimapScale
      const vpH = area[3] * this._minimapScale

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(vpX, vpY, vpW, vpH)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
      ctx.fillRect(vpX, vpY, vpW, vpH)
    }
  }

  private _minimapScale = 0
  private _minimapOffsetX = 0
  private _minimapOffsetY = 0

  /** 缩略图点击/拖动导航：将视口中心移动到缩略图中点击的世界坐标 */
  navigateFromMinimap(miniCanvas: HTMLCanvasElement, clickX: number, clickY: number): void {
    if (this._minimapScale <= 0) return
    const dpr = window.devicePixelRatio || 1

    const worldX = (clickX - this._minimapOffsetX) / this._minimapScale
    const worldY = (clickY - this._minimapOffsetY) / this._minimapScale

    this._vpX = this._contW * dpr / 2 - worldX * this._vpZoom * dpr
    this._vpY = this._contH * dpr / 2 - worldY * this._vpZoom * dpr
    this._dirtyBg = true
    this._dirtyFg = true
  }
}
