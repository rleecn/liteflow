<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="context-menu-overlay"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        class="context-menu"
        :style="{ left: position.x + 'px', top: position.y + 'px' }"
        @click.stop
      >
        <template v-if="type === 'node'">
          <div class="menu-item danger" @click="emit('delete-node')">
            <span class="menu-icon">🗑</span> 删除节点
          </div>
          <div class="menu-item" @click="emit('duplicate-node')">
            <span class="menu-icon">📋</span> 复制节点
          </div>
        </template>
        <template v-if="type === 'edge'">
          <div class="menu-item danger" @click="emit('delete-edge')">
            <span class="menu-icon">✂</span> 删除连线
          </div>
        </template>
        <template v-if="type === 'pane'">
          <div class="menu-item" @click="emit('add-group')">
            <span class="menu-icon">📦</span> 创建分组
          </div>
          <div class="menu-separator"></div>
          <div
            v-for="(cat, catId) in categories"
            :key="catId"
            class="menu-category"
            @mouseenter="activeCategory = catId as string"
            @mouseleave="activeCategory = null"
          >
            <div class="menu-item has-submenu">
              {{ cat }} <span class="submenu-arrow">›</span>
            </div>
            <div v-if="activeCategory === catId" class="submenu">
              <div
                v-for="nt in getNodesByCategory(catId as string)"
                :key="nt.type"
                class="menu-item"
                @click="emit('add-node', nt.type)"
              >
                <span class="menu-icon" :style="{ color: nt.borderColor }">{{ nt.icon }}</span> {{ nt.title }}
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { getCategories, getNodeTypesByCategory } from './registry'

defineProps<{
  visible: boolean
  position: { x: number; y: number }
  type: 'node' | 'edge' | 'pane'
}>()

const emit = defineEmits<{
  (e: 'delete-node'): void
  (e: 'duplicate-node'): void
  (e: 'delete-edge'): void
  (e: 'add-node', type: string): void
  (e: 'add-group'): void
  (e: 'close'): void
}>()

const categories = getCategories()
const activeCategory = ref<string | null>(null)

function getNodesByCategory(catId: string) {
  return getNodeTypesByCategory(catId)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.context-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9998;
}

.context-menu {
  position: fixed;
  z-index: 9999;
  background: #1e2d50;
  border: 1px solid #3a5080;
  border-radius: 8px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  font-size: 13px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  color: #ccc;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.menu-item.danger:hover {
  background: rgba(233, 69, 96, 0.15);
  color: #e94560;
}

.menu-item.has-submenu {
  justify-content: space-between;
  cursor: default;
}

.menu-item.has-submenu:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.menu-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
}

.submenu-arrow {
  font-size: 16px;
  margin-left: 12px;
  color: #888;
}

.menu-category {
  position: relative;
}

.menu-category + .menu-category {
  border-top: 1px solid #2a3a60;
}

.menu-separator {
  height: 1px;
  background: #2a3a60;
  margin: 4px 0;
}

.submenu {
  position: absolute;
  left: 100%;
  top: 0;
  background: #1e2d50;
  border: 1px solid #3a5080;
  border-radius: 8px;
  padding: 4px 0;
  min-width: 150px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 10000;
}
</style>
