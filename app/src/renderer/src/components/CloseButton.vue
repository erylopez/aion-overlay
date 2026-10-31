<script setup lang="ts">
// An overlay's close button, in its header: turns the overlay off (the app turns it back on).
// Stops the pointer so pressing it doesn't start dragging the window.
import { t } from '@/lib/i18n.ts'
defineEmits<{ close: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex size-5 shrink-0 items-center justify-center rounded text-darker hover:bg-dark hover:text-default"
    :title="t('Close (turn it back on from the app)')"
    @pointerdown.stop
    @dblclick.stop
    @click="$emit('close')"
  >
    <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  </button>
</template>
