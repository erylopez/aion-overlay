<script setup lang="ts">
// Where you last died (lib/skull.ts), as SVG: in a map's SVG (`at` and `size` in its units) or as an
// icon of its own (no `at`).
import { SKULL } from '@/lib/skull.ts'

const props = withDefaults(defineProps<{ at?: [number, number] | null; size?: number }>(), { at: null, size: 16 })
const k = (): number => props.size / 16
</script>

<template>
  <g v-if="at" :transform="`translate(${at[0] - size / 2} ${at[1] - size / 2}) scale(${k()})`">
    <!-- A <title> for its hover text. -->
    <slot />
    <circle :cx="SKULL.disc[0]" :cy="SKULL.disc[1]" :r="SKULL.disc[2] - 0.6" :fill="SKULL.colors.disc" :stroke="SKULL.colors.ring" stroke-width="1.2" />
    <path :d="SKULL.head" :fill="SKULL.colors.bone" />
    <circle v-for="(e, i) in SKULL.eyes" :key="i" :cx="e[0]" :cy="e[1]" :r="e[2]" :fill="SKULL.colors.ink" />
    <path :d="SKULL.nose" :fill="SKULL.colors.ink" />
    <path :d="SKULL.teeth" :stroke="SKULL.colors.ink" stroke-width="0.5" />
  </g>
  <svg v-else viewBox="0 0 16 16" :width="size" :height="size" aria-hidden="true">
    <circle :cx="SKULL.disc[0]" :cy="SKULL.disc[1]" :r="SKULL.disc[2] - 0.6" :fill="SKULL.colors.disc" :stroke="SKULL.colors.ring" stroke-width="1.2" />
    <path :d="SKULL.head" :fill="SKULL.colors.bone" />
    <circle v-for="(e, i) in SKULL.eyes" :key="i" :cx="e[0]" :cy="e[1]" :r="e[2]" :fill="SKULL.colors.ink" />
    <path :d="SKULL.nose" :fill="SKULL.colors.ink" />
    <path :d="SKULL.teeth" :stroke="SKULL.colors.ink" stroke-width="0.5" />
  </svg>
</template>
