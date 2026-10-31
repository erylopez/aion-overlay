<script setup lang="ts">
// Picking where the game's map is (Map page → "On the game's map"): this window dims the display,
// and a box dragged over it is the part of the screen the markers watch. Releasing keeps it;
// Escape or a right click cancels.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'

const store = useApp()
/** The box picked before, where it is on this window (dashed, to compare). */
const saved = computed(() => {
  const r = store.settings.gameMap.region
  return r ? { x: r.x - window.screenX, y: r.y - window.screenY, width: r.width, height: r.height } : null
})

const api = bridge()
const start = ref<{ x: number; y: number } | null>(null)
const end = ref<{ x: number; y: number } | null>(null)
const box = computed(() => {
  if (!start.value || !end.value) return null
  const x = Math.min(start.value.x, end.value.x)
  const y = Math.min(start.value.y, end.value.y)
  return { x, y, width: Math.abs(end.value.x - start.value.x), height: Math.abs(end.value.y - start.value.y) }
})

function down(e: PointerEvent): void {
  if (e.button === 2) return cancel()
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  start.value = { x: e.clientX, y: e.clientY }
  end.value = { x: e.clientX, y: e.clientY }
}
const move = (e: PointerEvent): void => void (start.value && (end.value = { x: e.clientX, y: e.clientY }))
function up(): void {
  const b = box.value
  start.value = null
  if (b && b.width >= 80 && b.height >= 80) void api.invoke('gamemap:setRegion', b, { width: window.innerWidth, height: window.innerHeight })
  else end.value = null
}
const cancel = (): void => void api.invoke('gamemap:setRegion', null)
const onKey = (e: KeyboardEvent): void => void (e.key === 'Escape' && cancel())
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 cursor-crosshair select-none" @pointerdown="down" @pointermove="move" @pointerup="up" @contextmenu.prevent>
    <!-- Dimmed, except the box. -->
    <svg class="pointer-events-none absolute inset-0 size-full">
      <defs>
        <mask id="hole">
          <rect width="100%" height="100%" fill="white" />
          <rect v-if="box" :x="box.x" :y="box.y" :width="box.width" :height="box.height" fill="black" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#hole)" />
      <rect v-if="saved && !box" :x="saved.x" :y="saved.y" :width="saved.width" :height="saved.height" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-dasharray="4 4" />
      <rect v-if="box" :x="box.x" :y="box.y" :width="box.width" :height="box.height" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="6 4" />
    </svg>
    <div v-if="box" class="pointer-events-none absolute rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white" :style="{ left: `${box.x}px`, top: `${box.y + box.height + 6}px` }">
      {{ Math.round(box.width) }} × {{ Math.round(box.height) }}
    </div>
    <div class="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 rounded-xl border border-card bg-darker/95 px-5 py-3 text-center shadow-card">
      <div class="text-sm font-semibold text-default">{{ t("Drag a box around the game's map") }}</div>
      <div class="mt-0.5 text-xs text-darker">{{ t('Open the map in game first, as big as you like it. Esc cancels.') }}</div>
      <div v-if="saved" class="mt-0.5 text-xs text-darkest">{{ t('The grey dashed box is the one picked before.') }}</div>
    </div>
  </div>
</template>
