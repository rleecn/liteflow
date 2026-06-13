/**
 * LiteFlow 节点类型注册中心
 * 支持内置节点类型和用户自定义节点类型
 */
import type { LFNodeType } from './types'

// ==================== 分类注册 ====================

const _categories = new Map<string, string>()

export function registerCategory(id: string, label: string): void {
  _categories.set(id, label)
}

export function removeCategory(id: string): void {
  _categories.delete(id)
}

export function getCategories(): Record<string, string> {
  const result: Record<string, string> = {}
  _categories.forEach((label, id) => { result[id] = label })
  return result
}

// ==================== 节点类型注册 ====================

const _nodeTypes = new Map<string, LFNodeType>()

export function registerNodeType(nodeType: LFNodeType): void {
  _nodeTypes.set(nodeType.type, nodeType)
}

export function removeNodeType(type: string): void {
  _nodeTypes.delete(type)
}

export function getNodeType(type: string): LFNodeType | undefined {
  return _nodeTypes.get(type)
}

export function getAllNodeTypes(): Record<string, LFNodeType> {
  const result: Record<string, LFNodeType> = {}
  _nodeTypes.forEach((nt, type) => { result[type] = nt })
  return result
}

export function getNodeTypesByCategory(categoryId: string): LFNodeType[] {
  const result: LFNodeType[] = []
  _nodeTypes.forEach(nt => {
    if (nt.category === categoryId) result.push(nt)
  })
  return result
}

/** 根据源节点类型和输出端口推断目标节点类型 */
export function getTargetNodeType(sourceType: string, slotId: string): string | null {
  const map: Record<string, string> = {
    // 项目管理
    requirement: 'requirement',
    'sub-requirement': 'requirement',
    task: 'task',
    remark: 'remark',
    'note-out': 'note',
    // 思维导图
    branch: 'mind-branch',
    leaf: 'mind-leaf',
    // UML
    inherit: 'uml-class',
    implement: 'uml-class',
    compose: 'uml-class',
    // 流程图
    out: 'flow-process',
    yes: 'flow-process',
    no: 'flow-process',
  }
  return map[slotId] || null
}

// ==================== 内置节点类型 ====================

let _builtinRegistered = false

export function registerBuiltinTypes(): void {
  if (_builtinRegistered) return
  _builtinRegistered = true
  // ===== 分类 =====
  registerCategory('project-mgmt', '项目管理')
  registerCategory('mind-map', '思维导图')
  registerCategory('uml', 'UML')
  registerCategory('flowchart', '流程图')

  // ===== 项目管理 =====
  registerNodeType({
    type: 'project',
    title: '项目',
    icon: '📋',
    category: 'project-mgmt',
    color: '#2d5986',
    borderColor: '#4a9ae0',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#4a9ae0' },
      { id: 'requirement', label: '需求', dir: 'out', color: '#4a9ae0' },
      { id: 'task', label: '任务', dir: 'out', color: '#e09060' },
    ],
    fields: [
      { key: 'name', label: '项目名称', type: 'text' },
      { key: 'description', label: '描述', type: 'textarea' },
    ],
    defaultData: { name: '', description: '' },
  })

  registerNodeType({
    type: 'requirement',
    title: '需求',
    icon: '📝',
    category: 'project-mgmt',
    color: '#5b8c5a',
    borderColor: '#7ec47e',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#7ec47e' },
      { id: 'sub-requirement', label: '子需求', dir: 'out', color: '#7ec47e' },
      { id: 'task', label: '任务', dir: 'out', color: '#e09060' },
      { id: 'remark', label: '备注', dir: 'out', color: '#8fb5c9' },
    ],
    fields: [
      { key: 'name', label: '需求名称', type: 'text' },
      { key: 'priority', label: '优先级', type: 'select', options: ['高', '中', '低'] },
      { key: 'progress', label: '完成度', type: 'range', min: 0, max: 100, step: 5 },
      { key: 'description', label: '描述', type: 'textarea' },
    ],
    defaultData: { name: '', priority: '中', description: '', progress: 0 },
  })

  registerNodeType({
    type: 'task',
    title: '任务',
    icon: '✅',
    category: 'project-mgmt',
    color: '#a85c32',
    borderColor: '#e09060',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#e09060' },
      { id: 'remark', label: '备注', dir: 'out', color: '#8fb5c9' },
    ],
    fields: [
      { key: 'name', label: '任务名称', type: 'text' },
      { key: 'status', label: '状态', type: 'select', options: ['待办', '进行中', '已完成'] },
      { key: 'progress', label: '完成度', type: 'range', min: 0, max: 100, step: 5 },
      { key: 'assignee', label: '负责人', type: 'text' },
      { key: 'description', label: '描述', type: 'textarea' },
    ],
    defaultData: { name: '', status: '待办', assignee: '', progress: 0, description: '' },
  })

  registerNodeType({
    type: 'note',
    title: '笔记',
    icon: '📌',
    category: 'project-mgmt',
    color: '#6b5b95',
    borderColor: '#a08fd0',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#a08fd0' },
      { id: 'note-out', label: '关联', dir: 'out', color: '#a08fd0' },
    ],
    fields: [
      { key: 'title', label: '标题', type: 'text' },
      { key: 'content', label: '内容', type: 'textarea' },
    ],
    defaultData: { title: '', content: '' },
  })

  registerNodeType({
    type: 'remark',
    title: '备注',
    icon: '💬',
    category: 'project-mgmt',
    color: '#5a6e7f',
    borderColor: '#8fb5c9',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#8fb5c9' },
    ],
    fields: [
      { key: 'content', label: '内容', type: 'textarea' },
    ],
    defaultData: { content: '' },
  })

  // ===== 思维导图 =====
  registerNodeType({
    type: 'mind-center',
    title: '中心主题',
    icon: '🧠',
    category: 'mind-map',
    color: '#8e44ad',
    borderColor: '#c39bd3',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'branch', label: '分支', dir: 'out', color: '#c39bd3' },
    ],
    fields: [
      { key: 'name', label: '主题', type: 'text' },
    ],
    defaultData: { name: '' },
  })

  registerNodeType({
    type: 'mind-branch',
    title: '分支主题',
    icon: '🌿',
    category: 'mind-map',
    color: '#27ae60',
    borderColor: '#7dcea0',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#7dcea0' },
      { id: 'branch', label: '分支', dir: 'out', color: '#7dcea0' },
      { id: 'leaf', label: '叶子', dir: 'out', color: '#82e0aa' },
    ],
    fields: [
      { key: 'name', label: '主题', type: 'text' },
    ],
    defaultData: { name: '' },
  })

  registerNodeType({
    type: 'mind-leaf',
    title: '叶子节点',
    icon: '🍃',
    category: 'mind-map',
    color: '#1e8449',
    borderColor: '#82e0aa',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#82e0aa' },
    ],
    fields: [
      { key: 'name', label: '内容', type: 'text' },
    ],
    defaultData: { name: '' },
  })

  // ===== UML =====
  registerNodeType({
    type: 'uml-class',
    title: '类',
    icon: '📐',
    category: 'uml',
    color: '#2c3e50',
    borderColor: '#5dade2',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#5dade2' },
      { id: 'inherit', label: '继承', dir: 'out', color: '#5dade2' },
      { id: 'compose', label: '组合', dir: 'out', color: '#48c9b0' },
    ],
    fields: [
      { key: 'name', label: '类名', type: 'text' },
      { key: 'attributes', label: '属性', type: 'textarea' },
      { key: 'methods', label: '方法', type: 'textarea' },
    ],
    defaultData: { name: '', attributes: '', methods: '' },
  })

  registerNodeType({
    type: 'uml-interface',
    title: '接口',
    icon: '🔌',
    category: 'uml',
    color: '#1a5276',
    borderColor: '#5dade2',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#5dade2' },
      { id: 'implement', label: '实现', dir: 'out', color: '#5dade2' },
    ],
    fields: [
      { key: 'name', label: '接口名', type: 'text' },
      { key: 'methods', label: '方法', type: 'textarea' },
    ],
    defaultData: { name: '', methods: '' },
  })

  registerNodeType({
    type: 'uml-enum',
    title: '枚举',
    icon: '🔢',
    category: 'uml',
    color: '#1b4f72',
    borderColor: '#85c1e9',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#85c1e9' },
      { id: 'compose', label: '组合', dir: 'out', color: '#48c9b0' },
    ],
    fields: [
      { key: 'name', label: '枚举名', type: 'text' },
      { key: 'values', label: '枚举值', type: 'textarea' },
    ],
    defaultData: { name: '', values: '' },
  })

  // ===== 流程图 =====
  registerNodeType({
    type: 'flow-start',
    title: '开始',
    icon: '▶',
    category: 'flowchart',
    color: '#1e8449',
    borderColor: '#58d68d',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'out', label: '输出', dir: 'out', color: '#58d68d' },
    ],
    fields: [],
    defaultData: {},
  })

  registerNodeType({
    type: 'flow-end',
    title: '结束',
    icon: '⏹',
    category: 'flowchart',
    color: '#922b21',
    borderColor: '#ec7063',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#ec7063' },
    ],
    fields: [],
    defaultData: {},
  })

  registerNodeType({
    type: 'flow-process',
    title: '处理',
    icon: '⚙',
    category: 'flowchart',
    color: '#2e86c1',
    borderColor: '#5dade2',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#5dade2' },
      { id: 'out', label: '输出', dir: 'out', color: '#5dade2' },
    ],
    fields: [
      { key: 'name', label: '处理名称', type: 'text' },
      { key: 'description', label: '描述', type: 'textarea' },
    ],
    defaultData: { name: '', description: '' },
  })

  registerNodeType({
    type: 'flow-decision',
    title: '判断',
    icon: '◇',
    category: 'flowchart',
    color: '#d4ac0d',
    borderColor: '#f4d03f',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#f4d03f' },
      { id: 'yes', label: '是', dir: 'out', color: '#58d68d' },
      { id: 'no', label: '否', dir: 'out', color: '#ec7063' },
    ],
    fields: [
      { key: 'condition', label: '条件', type: 'text' },
    ],
    defaultData: { condition: '' },
  })

  registerNodeType({
    type: 'flow-io',
    title: '输入/输出',
    icon: '⇄',
    category: 'flowchart',
    color: '#7d3c98',
    borderColor: '#bb8fce',
    headerColor: 'rgba(0,0,0,0.15)',
    slots: [
      { id: 'in', label: '输入', dir: 'in', color: '#bb8fce' },
      { id: 'out', label: '输出', dir: 'out', color: '#bb8fce' },
    ],
    fields: [
      { key: 'name', label: '名称', type: 'text' },
      { key: 'dataType', label: '数据类型', type: 'text' },
    ],
    defaultData: { name: '', dataType: '' },
  })
}
