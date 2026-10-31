<script setup lang="ts">
// An overlay's resize corner (lib/cornerResize.ts), at the bottom right of its card (a `group`):
// shown while the pointer is over the card, or while dragging. A double-click resets the size.
import { t } from '@/lib/i18n.ts'
defineProps<{ active?: boolean }>()
defineEmits<{ grab: [e: PointerEvent]; reset: [] }>()
</script>

<template>
  <div
    :class="[
      'absolute bottom-0 right-0 z-20 flex size-4 cursor-nwse-resize items-end justify-end p-0.5 text-darker transition-opacity hover:text-default',
      active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
    ]"
    :title="t('Drag to resize; double-click for the default size')"
    @pointerdown.stop="$emit('grab', $event)"
    @dblclick.stop="$emit('reset')"
  >
    <svg viewBox="0 0 10 10" class="size-2.5 drop-shadow" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M9 3 3 9M9 6 6 9" /></svg>
  </div>
</template>
