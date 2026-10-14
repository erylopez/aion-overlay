<script setup lang="ts">
// A label and its hint on the left, the control on the right; a warning in red under the label.
defineProps<{ label: string; hint?: string; warning?: string }>()
</script>

<template>
  <div class="flex items-center justify-between gap-4 py-2">
    <div class="min-w-0">
      <div class="text-sm">{{ label }}</div>
      <div v-if="hint" class="text-xs leading-snug text-darker">{{ hint }}</div>
      <div v-if="warning" class="text-xs leading-snug text-danger">{{ warning }}</div>
    </div>
    <div class="shrink-0"><slot /></div>
  </div>
</template>
