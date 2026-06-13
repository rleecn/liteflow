<template>
  <div class="liteflow-container" ref="containerRef">
    <canvas ref="bgCanvasRef" class="liteflow-bg-canvas" />
    <canvas ref="canvasRef" class="liteflow-canvas" />
    <!-- 右键菜单 -->
    <teleport to="body">
      <ContextMenu
        :visible="menu.visible"
        :position="menu.position"
        :type="menu.type"
        @delete-node="deleteSelectedNode"
        @duplicate-node="duplicateSelectedNode"
        @delete-edge="deleteSelectedEdge"
        @add-node="onMenuAddNode"
        @add-group="onMenuAddGroup"
        @close="closeMenu"
      />
    </teleport>
    <!-- 状态栏 -->
    <div class="status-bar">
      <span>节点: {{ stats.visibleNodes }}/{{ stats.totalNodes }}</span>
      <span>连线: {{ stats.visibleEdges }}/{{ stats.totalEdges }}</span>
      <span>FPS: {{ stats.fps }}</span>
      <span>LOD: {{ stats.lod }}</span>
    </div>
    <!-- 缩略图 -->
    <canvas
      ref="minimapRef"
      class="minimap"
      @pointerdown="onMinimapPointerDown"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { LFEngine, LFRenderer } from './index'
import type { LFNode, LFStats } from './types'
import { getTargetNodeType, getNodeType, registerBuiltinTypes } from './registry'
import ContextMenu from './ContextMenu.vue'

const props = withDefaults(defineProps<{
  /** 是否注册内置节点类型，默认 true。设为 false 则只使用自定义注册的节点类型 */
  builtinTypes?: boolean
}>(), {
  builtinTypes: true,
})

// 根据配置决定是否注册内置类型
if (props.builtinTypes) {
  registerBuiltinTypes()
}

const containerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const bgCanvasRef = ref<HTMLCanvasElement | null>(null)
const minimapRef = ref<HTMLCanvasElement | null>(null)

const engine = new LFEngine()
let renderer: LFRenderer | null = null

const stats = reactive<LFStats>({
  totalNodes: 0, visibleNodes: 0, totalEdges: 0, visibleEdges: 0, fps: 0, lod: 'full',
})

// 右键菜单
const menu = reactive({
  visible: false,
  position: { x: 0, y: 0 },
  type: 'pane' as 'node' | 'edge' | 'pane',
  targetId: '',
  worldPos: { x: 0, y: 0 },
})

const emit = defineEmits<{
  (e: 'node-select', node: LFNode | null): void
}>()

// ==================== 生命周期 ====================

let resizeObserver: ResizeObserver | null = null
let statsTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  if (!canvasRef.value || !bgCanvasRef.value || !containerRef.value) return

  renderer = new LFRenderer(canvasRef.value, bgCanvasRef.value, engine)

  // 回调
  renderer.onNodeSelect = (node) => {
    emit('node-select', node)
  }
  renderer.onContextMenu = (params) => {
    menu.visible = true
    menu.position = { x: params.x, y: params.y }
    menu.type = params.type
    menu.targetId = params.targetId
    // 存储世界坐标，用于创建分组
    if (renderer) {
      const rect = canvasRef.value!.getBoundingClientRect()
      const world = renderer.screenToWorld(params.x - rect.left, params.y - rect.top)
      menu.worldPos = { x: world.x, y: world.y }
    }
  }
  renderer.onConnect = (sourceId, sourceSlot, targetId) => {
    engine.addEdge(sourceId, sourceSlot, targetId)
    renderer!.markDirty()
  }

  // 从输出端口拖线到空白区域，自动创建对应类型节点并连线
  renderer.onConnectToEmpty = ({ sourceId, sourceSlot, worldX, worldY }) => {
    const sourceNode = engine.getNode(sourceId)
    if (!sourceNode) return

    // 根据源端口推断目标节点类型
    const targetType = getTargetNodeType(sourceNode.type, sourceSlot)
    if (!targetType) return

    // 计算新节点位置（偏移到鼠标释放位置附近）
    const newNodeX = worldX + 20
    const newNodeY = worldY - 40

    // 创建节点
    const nodeTypeDef = getNodeType(targetType)
    if (!nodeTypeDef) return
    const count = engine.nodes.filter(n => n.type === targetType).length + 1
    const data = { ...nodeTypeDef.defaultData }
    if (data.name !== undefined) data.name = `${nodeTypeDef.title} ${count}`
    if (data.title !== undefined) data.title = `${nodeTypeDef.title} ${count}`

    const newNode = engine.addNode(targetType, data, [newNodeX, newNodeY])

    // 自动连线
    engine.addEdge(sourceId, sourceSlot, newNode.id)
    renderer!.markDirty()
    emit('node-select', newNode)
  }

  // 尺寸
  const rect = containerRef.value.getBoundingClientRect()
  renderer.resize(rect.width, rect.height)
  renderer.startRendering()

  // 监听尺寸变化
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect
      renderer?.resize(width, height)
    }
  })
  resizeObserver.observe(containerRef.value)

  // 统计更新
  statsTimer = setInterval(() => {
    if (renderer) {
      Object.assign(stats, renderer.stats)
    }
  }, 500)

  // 缩略图更新
  initMinimap()
})

onUnmounted(() => {
  renderer?.destroy()
  renderer = null
  resizeObserver?.disconnect()
  if (statsTimer) clearInterval(statsTimer)
  if (minimapTimer) clearInterval(minimapTimer)
})

// ==================== 缩略图 ====================

let minimapTimer: ReturnType<typeof setInterval> | null = null
let minimapDragging = false

function initMinimap() {
  const miniCanvas = minimapRef.value
  if (!miniCanvas) return

  const dpr = window.devicePixelRatio || 1
  const w = 200
  const h = 140
  miniCanvas.width = w * dpr
  miniCanvas.height = h * dpr
  miniCanvas.style.width = w + 'px'
  miniCanvas.style.height = h + 'px'

  // 定时更新缩略图
  minimapTimer = setInterval(() => {
    if (renderer) {
      renderer.drawMinimap(miniCanvas)
    }
  }, 300)
}

function onMinimapPointerDown(e: PointerEvent) {
  if (!renderer || !minimapRef.value) return
  minimapDragging = true
  minimapRef.value.setPointerCapture(e.pointerId)
  navigateMinimap(e)
  window.addEventListener('pointermove', onMinimapPointerMove)
  window.addEventListener('pointerup', onMinimapPointerUp)
}

function onMinimapPointerMove(e: PointerEvent) {
  if (!minimapDragging) return
  navigateMinimap(e)
}

function onMinimapPointerUp() {
  minimapDragging = false
  window.removeEventListener('pointermove', onMinimapPointerMove)
  window.removeEventListener('pointerup', onMinimapPointerUp)
}

function navigateMinimap(e: PointerEvent) {
  if (!renderer || !minimapRef.value) return
  const rect = minimapRef.value.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const x = (e.clientX - rect.left) * dpr
  const y = (e.clientY - rect.top) * dpr
  renderer.navigateFromMinimap(minimapRef.value, x, y)
}

// ==================== 右键菜单 ====================

function closeMenu() {
  menu.visible = false
}

function deleteSelectedNode() {
  engine.removeNode(menu.targetId)
  closeMenu()
  renderer?.markDirty()
  emit('node-select', null)
}

function duplicateSelectedNode() {
  const newNode = engine.duplicateNode(menu.targetId)
  closeMenu()
  renderer?.markDirty()
  if (newNode) emit('node-select', newNode)
}

function deleteSelectedEdge() {
  engine.removeEdge(menu.targetId)
  closeMenu()
  renderer?.markDirty()
}

function onMenuAddNode(type: string) {
  const nodeTypeDef = getNodeType(type)
  if (!nodeTypeDef) return
  const count = engine.nodes.filter(n => n.type === type).length + 1
  const data = { ...nodeTypeDef.defaultData }
  if (data.name !== undefined) data.name = `${nodeTypeDef.title} ${count}`
  if (data.title !== undefined) data.title = `${nodeTypeDef.title} ${count}`
  if (data.content !== undefined) data.content = ''

  const node = addNode(type, data)
  closeMenu()
  emit('node-select', node)
}

function onMenuAddGroup() {
  const group = engine.addGroup(
    '新分组',
    menu.worldPos.x - 200,
    menu.worldPos.y - 150,
    400,
    300,
  )
  // 自动包含分组区域内的节点
  engine.updateGroupNodes(group)
  closeMenu()
  renderer?.markDirty()
}

// ==================== 公开 API ====================

function addNode(type: string, data?: Record<string, any>, position?: [number, number]): LFNode {
  const node = engine.addNode(type, data, position)
  renderer?.markDirty()
  return node
}

function addGroup(title: string, x: number, y: number, width?: number, height?: number, color?: string) {
  const group = engine.addGroup(title, x, y, width, height, color)
  engine.updateGroupNodes(group)
  renderer?.markDirty()
  return group
}

function addEdge(sourceId: string, sourceSlot: string | null, targetId: string): void {
  engine.addEdge(sourceId, sourceSlot, targetId)
  renderer?.markDirty()
}

function autoLayout(): void {
  if (engine.nodes.length === 0) return

  const NODE_WIDTH = 260
  const NODE_HEIGHT = 200
  const H_GAP = 100
  const V_GAP = 30

  const childrenOf: Record<string, string[]> = {}
  const parentOf: Record<string, string> = {}
  engine.nodes.forEach(n => { childrenOf[n.id] = [] })
  engine.edges.forEach(e => {
    if (childrenOf[e.sourceId]) {
      childrenOf[e.sourceId].push(e.targetId)
    }
    parentOf[e.targetId] = e.sourceId
  })

  const roots = engine.nodes.filter(n => !parentOf[n.id]).map(n => n.id)

  const levelOf: Record<string, number> = {}
  const queue = roots.map(id => ({ id, level: 0 }))
  while (queue.length > 0) {
    const { id, level } = queue.shift()!
    if (levelOf[id] !== undefined) continue
    levelOf[id] = level
    for (const childId of (childrenOf[id] || [])) {
      if (levelOf[childId] === undefined) {
        queue.push({ id: childId, level: level + 1 })
      }
    }
  }

  engine.nodes.forEach(n => {
    if (levelOf[n.id] === undefined) levelOf[n.id] = 0
  })

  const subtreeHeight: Record<string, number> = {}
  function getSubtreeHeight(id: string): number {
    if (subtreeHeight[id] !== undefined) return subtreeHeight[id]
    const kids = childrenOf[id] || []
    if (kids.length === 0) {
      subtreeHeight[id] = NODE_HEIGHT
      return NODE_HEIGHT
    }
    const total = kids.reduce((sum, kid) => sum + getSubtreeHeight(kid) + V_GAP, -V_GAP)
    subtreeHeight[id] = Math.max(NODE_HEIGHT, total)
    return subtreeHeight[id]
  }

  const positions: Record<string, { x: number; y: number }> = {}
  function layoutNode(id: string, x: number, yStart: number, yEnd: number) {
    const yCenter = (yStart + yEnd) / 2 - NODE_HEIGHT / 2
    positions[id] = { x, y: yCenter }

    const kids = childrenOf[id] || []
    if (kids.length === 0) return

    const totalKidsHeight = kids.reduce((sum, kid) => sum + getSubtreeHeight(kid), 0) + (kids.length - 1) * V_GAP
    let currentY = yCenter + NODE_HEIGHT / 2 - totalKidsHeight / 2

    for (const kid of kids) {
      const kidHeight = getSubtreeHeight(kid)
      layoutNode(kid, x + NODE_WIDTH + H_GAP, currentY, currentY + kidHeight)
      currentY += kidHeight + V_GAP
    }
  }

  let offsetY = 50
  for (const rootId of roots) {
    const h = getSubtreeHeight(rootId)
    layoutNode(rootId, 50, offsetY, offsetY + h)
    offsetY += h + V_GAP * 2
  }

  const orphans = engine.nodes.filter(n => !positions[n.id])
  if (orphans.length > 0) {
    const maxLevel = Math.max(...Object.values(levelOf), 0)
    const orphanX = 50 + (maxLevel + 1) * (NODE_WIDTH + H_GAP)
    orphans.forEach((n, i) => {
      positions[n.id] = { x: orphanX, y: 50 + i * (NODE_HEIGHT + V_GAP) }
    })
  }

  for (const n of engine.nodes) {
    if (positions[n.id]) {
      engine.moveNode(n.id, positions[n.id].x, positions[n.id].y)
    }
  }

  renderer?.markDirty()
  renderer?.fitView()
}

function loadMockData(): void {
  engine.clear()

  const p1 = engine.addNode('project', { name: '智慧城市平台', description: '城市级物联网数据中台' })
  const r1 = engine.addNode('requirement', { name: '数据采集模块', priority: '高', description: '多协议数据接入', progress: 80 }, [360, 50])
  const r2 = engine.addNode('requirement', { name: '可视化大屏', priority: '中', description: '实时数据展示', progress: 40 }, [360, 300])
  const r3 = engine.addNode('requirement', { name: '告警系统', priority: '高', description: '异常检测与通知', progress: 20 }, [360, 550])
  const t1 = engine.addNode('task', { name: 'MQTT接入', status: '已完成', assignee: '张三', progress: 100 }, [720, 50])
  const t2 = engine.addNode('task', { name: 'HTTP轮询', status: '进行中', assignee: '李四', progress: 60 }, [720, 200])
  const t3 = engine.addNode('task', { name: '3D地图', status: '待办', assignee: '王五', progress: 10 }, [720, 350])
  const t4 = engine.addNode('task', { name: '规则引擎', status: '进行中', assignee: '赵六', progress: 30 }, [720, 550])
  const n1 = engine.addNode('note', { title: '技术选型', content: '前端使用Vue3+Canvas渲染' }, [720, 700])
  const rm1 = engine.addNode('remark', { content: '需要考虑万级节点性能' }, [1080, 200])

  engine.addEdge(p1.id, 'requirement', r1.id)
  engine.addEdge(p1.id, 'requirement', r2.id)
  engine.addEdge(p1.id, 'task', r3.id)
  engine.addEdge(r1.id, 'sub-requirement', r2.id)
  engine.addEdge(r1.id, 'task', t1.id)
  engine.addEdge(r1.id, 'task', t2.id)
  engine.addEdge(r2.id, 'task', t3.id)
  engine.addEdge(r3.id, 'task', t4.id)
  engine.addEdge(r1.id, 'remark', rm1.id)
  engine.addEdge(r3.id, 'note-out', n1.id)

  renderer?.markDirty()
  setTimeout(() => renderer?.fitView(), 100)
}

function loadMockData5000(): void {
  engine.clear()

  const COLS = 50
  const NODE_W = 260
  const NODE_H = 120
  const H_GAP = 80
  const V_GAP = 20

  const priorities = ['高', '中', '低']
  const statuses = ['待办', '进行中', '已完成']
  const assignees = ['张三', '李四', '王五', '赵六', '钱七', '孙八']

  // 10 个项目根节点
  const projects: string[] = []
  for (let p = 0; p < 10; p++) {
    const node = engine.addNode('project', {
      name: `项目 ${p + 1}`,
      description: `第 ${p + 1} 个项目`,
    }, [50, p * (NODE_H + V_GAP) * 10])
    projects.push(node.id)
  }

  // 每个项目 10 个需求 = 100
  const requirements: string[] = []
  for (let p = 0; p < 10; p++) {
    for (let r = 0; r < 10; r++) {
      const node = engine.addNode('requirement', {
        name: `需求 ${p + 1}-${r + 1}`,
        priority: priorities[r % 3],
        description: `需求描述 ${p + 1}-${r + 1}`,
        progress: Math.floor(Math.random() * 100),
      }, [50 + (NODE_W + H_GAP), p * (NODE_H + V_GAP) * 10 + r * (NODE_H + V_GAP)])
      requirements.push(node.id)
      engine.addEdge(projects[p], 'requirement', node.id)
    }
  }

  // 每个需求 5 个任务 = 500
  const tasks: string[] = []
  for (let i = 0; i < requirements.length; i++) {
    for (let t = 0; t < 5; t++) {
      const node = engine.addNode('task', {
        name: `任务 ${i + 1}-${t + 1}`,
        status: statuses[t % 3],
        assignee: assignees[t % assignees.length],
        progress: Math.floor(Math.random() * 100),
      }, [50 + (NODE_W + H_GAP) * 2, i * (NODE_H + V_GAP) * 5 + t * (NODE_H + V_GAP)])
      tasks.push(node.id)
      engine.addEdge(requirements[i], 'task', node.id)
    }
  }

  // 每个任务 2 个备注 = 1000
  for (let i = 0; i < tasks.length; i++) {
    for (let m = 0; m < 2; m++) {
      const node = engine.addNode('remark', {
        content: `备注内容 ${i + 1}-${m + 1}`,
      }, [50 + (NODE_W + H_GAP) * 3, i * (NODE_H + V_GAP) * 2 + m * (NODE_H + V_GAP)])
      engine.addEdge(tasks[i], 'remark', node.id)
    }
  }

  // 额外笔记节点凑到 5000+ (当前 10+100+500+1000=1610, 还需 ~3400)
  for (let i = 0; i < 3400; i++) {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    engine.addNode('note', {
      title: `笔记 ${i + 1}`,
      content: `这是第 ${i + 1} 条笔记内容`,
    }, [50 + (NODE_W + H_GAP) * (4 + Math.floor(col / 10)), row * (NODE_H + V_GAP) * 10 + col * (NODE_H + V_GAP)])
  }

  renderer?.markDirty()
  setTimeout(() => renderer?.fitView(), 200)
}

function serialize(): { nodes: any[]; edges: any[]; groups: any[] } {
  return engine.serialize()
}

function deserialize(data: { nodes: any[]; edges: any[]; groups?: any[] }): void {
  engine.deserialize({ ...data, groups: data.groups || [] })
  renderer?.markDirty()
  setTimeout(() => renderer?.fitView(), 100)
}

function clearAll(): void {
  engine.clear()
  renderer?.markDirty()
}

function getNodes(): LFNode[] {
  return engine.nodes
}

function markDirty(): void {
  renderer?.markDirty()
}

defineExpose({
  addNode,
  addGroup,
  addEdge,
  autoLayout,
  loadMockData,
  loadMockData5000,
  serialize,
  deserialize,
  clearAll,
  getNodes,
  markDirty,
  engine,
})
</script>

<style scoped>
.liteflow-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1a1a2e;
}

.liteflow-bg-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.liteflow-canvas {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.liteflow-canvas:active {
  cursor: grabbing;
}

/* 状态栏 */
.status-bar {
  position: absolute;
  bottom: 8px;
  left: 8px;
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  pointer-events: none;
  user-select: none;
}

/* 缩略图 */
.minimap {
  position: absolute;
  bottom: 8px;
  right: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.2s;
}
.minimap:hover {
  border-color: rgba(255, 255, 255, 0.3);
}
</style>
