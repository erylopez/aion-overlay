<script setup lang="ts">
// A class's emblem, as the game draws it (assets/classes, from A2Tools DPS Meter, GPL-3.0), by the
// meter's class name; nothing for an unknown one. The meter and Details draw the same files.
import { computed } from 'vue'

const props = withDefaults(defineProps<{ className: string | null | undefined; size?: number }>(), { size: 16 })
const icons = import.meta.glob<string>('@/assets/classes/*.png', { eager: true, import: 'default' })
/** The engine's (and the Lokthar site's) name for one class, the files' for it. */
const ALIAS: Record<string, string> = { elementalist: 'spiritmaster', summoner: 'spiritmaster' }
const src = computed(() => {
  const name = props.className?.toLowerCase()
  return name ? (icons[`/src/assets/classes/${ALIAS[name] ?? name}.png`] ?? null) : null
})
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="className ?? ''"
    :title="className ?? ''"
    :width="size"
    :height="size"
    class="shrink-0 object-contain"
    draggable="false"
  />
</template>
