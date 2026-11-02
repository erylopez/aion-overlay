<script setup lang="ts">
// The floating icon. Drag it anywhere (it stays where it is dropped); click it to open or close
// the panel. The ring says what the tracker is doing; a yellow "!" badge says a newer version is
// out (main/updater.ts looks now and then), and the icon pulses when a soul drops. A timer alerting chimes once and shakes the bubble every few
// seconds until a click dismisses it.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { statusText, statusTone } from '@/components/StatusDot.vue'
import { bridge } from '@/lib/bridge.ts'
import { t } from '@/lib/i18n.ts'
import { playChime } from '@/lib/chime.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import type { UpdateState } from '@shared/update.ts'

const store = useApp()
const tone = computed(() => statusTone(store.status))
const RING = { green: 'ring-green', amber: 'ring-yellow', red: 'ring-red', gray: 'ring-darkest' } as const

const pulse = ref(0)
watch(
  () => store.toasts.length,
  (n, was) => {
    if (n > was) pulse.value++
  },
)

// The chime plays here: the bubble is up whenever the game is, and one window plays it once.
let offAlert: (() => void) | null = null
let offUpdate: (() => void) | null = null
const update = ref<UpdateState | null>(null)
/** A newer version than this one is out (or on its way in). */
const newer = computed(() => !!update.value && ['available', 'downloading', 'ready'].includes(update.value.status))
onMounted(async () => {
  offAlert = bridge().on('timers:alert', () => {
    if (store.settings.timers.sound) playChime(store.settings.timers.volume)
  })
  offUpdate = bridge().on('update:state', (s) => (update.value = s))
  update.value = await bridge().invoke('update:get')
})
onBeforeUnmount(() => {
  offAlert?.()
  offUpdate?.()
})
const shaking = computed(() => store.alerting.length > 0 && store.settings.timers.shake)

const drag = windowDrag({
  move: 'bubble:moveTo',
  end: 'bubble:dragEnd',
  onClick: () => {
    // A click with an alert up dismisses it and opens the panel on that timer; otherwise it opens
    // or closes the panel.
    void bridge().invoke(store.alerting.length ? 'timers:open' : 'panel:toggle')
  },
})

const title = computed(() =>
  store.alerting.length
    ? t('A timer is up: click to see it')
    : `${statusText(store.status)} · ${t('{n} souls this session', { n: store.sessionSouls })}${newer.value ? ` · ${t('Version {v} is out: see Updates', { v: update.value!.latest ?? '' })}` : ''}`,
)
</script>

<template>
  <div class="flex h-full w-full items-center justify-center">
    <button
      type="button"
      :title="title"
      :class="[
        'relative size-12 cursor-grab touch-none rounded-full ring-2 ring-offset-2 ring-offset-transparent transition active:cursor-grabbing',
        RING[tone],
        store.panelVisible ? 'scale-95' : 'hover:scale-105',
        shaking && 'animate-alert',
      ]"
      @pointerdown="drag.onPointerDown"
      @pointerup="drag.onPointerUp"
    >
      <img :key="pulse" src="/icon.png" alt="" draggable="false" :class="['size-12 rounded-full bg-[#18181b] p-1 object-contain', pulse && 'animate-soul']" />
      <span v-if="newer" class="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-yellow text-[13px] font-extrabold leading-none text-black shadow">!</span>
    </button>
  </div>
</template>

<style scoped>
@keyframes soul {
  0% {
    transform: scale(1);
    filter: brightness(1);
  }
  35% {
    transform: scale(1.18);
    filter: brightness(1.6);
  }
  100% {
    transform: scale(1);
    filter: brightness(1);
  }
}
.animate-soul {
  animation: soul 700ms ease-out;
}
/* A timer is up: a short rotating shake, then still, every 3 s. */
@keyframes alert {
  0%,
  30%,
  100% {
    transform: rotate(0);
  }
  5% {
    transform: rotate(-14deg);
  }
  10% {
    transform: rotate(12deg);
  }
  15% {
    transform: rotate(-9deg);
  }
  20% {
    transform: rotate(6deg);
  }
  25% {
    transform: rotate(-3deg);
  }
}
.animate-alert {
  animation: alert 3s ease-in-out infinite;
}
</style>
