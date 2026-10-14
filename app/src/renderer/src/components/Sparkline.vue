<script setup lang="ts">
// A one-line trend in the current text colour, as wide as its box. Without `label` it is
// decoration (the HUD, which takes no mouse); with it, hovering shows a point's label.
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{ values: number[]; stroke?: number; label?: (i: number) => string }>(), { stroke: 2 })

// Drawn in a 100 x 100 box stretched to fit; the stroke keeps its width (non-scaling).
const max = computed(() => Math.max(...props.values, 1))
const x = (i: number): number => (props.values.length < 2 ? 0 : (i / (props.values.length - 1)) * 100)
const y = (v: number): number => 96 - (v / max.value) * 92
const line = computed(() => props.values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' '))
const area = computed(() => `0,100 ${line.value} 100,100`)

const hover = ref<number | null>(null)
function onMove(e: PointerEvent): void {
  if (!props.label || props.values.length < 2) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const f = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1)
  hover.value = Math.round(f * (props.values.length - 1))
}
</script>

<template>
  <div class="relative" @pointermove="onMove" @pointerleave="hover = null">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="block size-full overflow-visible" aria-hidden="true">
      <polygon :points="area" fill="currentColor" opacity="0.12" />
      <polyline
        :points="line"
        fill="none"
        stroke="currentColor"
        :stroke-width="stroke"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
      <line
        v-if="hover !== null"
        :x1="x(hover)"
        :x2="x(hover)"
        y1="0"
        y2="100"
        stroke="currentColor"
        stroke-width="1"
        opacity="0.5"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div
      v-if="hover !== null && label"
      class="pointer-events-none absolute -top-6 whitespace-nowrap rounded bg-darker px-1.5 py-0.5 text-[10px] tabular-nums text-dark shadow-card"
      :style="{ left: `${x(hover)}%`, transform: `translateX(${x(hover) > 70 ? -100 : x(hover) < 30 ? 0 : -50}%)` }"
    >
      {{ label(hover) }}
    </div>
  </div>
</template>
