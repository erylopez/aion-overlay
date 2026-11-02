<script setup lang="ts">
// Enemies nearby: players of the other faction your game has loaded around you (the engine's list,
// tracker/mod.rs), with their legion and server, and a sound when one comes into view. Clicks go
// through to the game; while the dashboard is up it shows a sample, and can be dragged into place.
// Nothing around you measures 0, and main keeps the window hidden.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ClassIcon from '@/components/ClassIcon.vue'
import CollapseButton from '@/components/CollapseButton.vue'
import { bridge } from '@/lib/bridge.ts'
import { t } from '@/lib/i18n.ts'
import { panelStyle } from '@/lib/overlayLook.ts'
import { playSound } from '@/lib/sound.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { serverTag } from '@shared/servers.ts'
import { canAttack, type Enemy } from '@shared/tracker.ts'

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.enemies)

const ROWS = 8
const SAMPLE = computed<Enemy[]>(() => [
  { entity: -1, name: t('Enemy player'), server: 2104, legion: t('Their legion'), pvp: true, combatPower: 123_186, className: 'Assassin' },
  { entity: -2, name: t('Another one'), server: 2104, legion: null },
])
/** Nobody around while the dashboard is up: a sample to place it by. */
const preview = computed(() => !store.enemies.length && store.panelVisible)
const threat = (e: Enemy): boolean => canAttack(e)
/** Those who can attack you first. */
const list = computed(() => (store.enemies.length ? [...store.enemies].sort((a, b) => Number(threat(b)) - Number(threat(a))) : preview.value ? SAMPLE.value : []))

// An enemy coming into view sounds the alarm (only one who can attack you, unless set otherwise: in
// the Abyss that is every one): not again for the same player within a minute (they
// step in and out of range), and not more than once every 5 s however many arrive.
const AGAIN_MS = 60_000
const GAP_MS = 5_000
const heard = new Map<string, number>()
let lastSound = 0
watch(
  () => store.enemies,
  (now) => {
    const t = Date.now()
    const alarming = cfg.value.pvpOnly ? now.filter(threat) : now
    const fresh = alarming.filter((e) => t - (heard.get(e.name) ?? 0) > AGAIN_MS)
    for (const e of alarming) heard.set(e.name, t)
    if (!fresh.length || !store.ready || !cfg.value.sound || t - lastSound < GAP_MS) return
    lastSound = t
    void playSound('enemy', cfg.value.soundId, cfg.value.volume)
  },
)

const drag = windowDrag({ move: 'enemies:moveTo', end: 'enemies:dragEnd' })
/** Minimized: the header only (how many). Clickable while the dashboard is up, as dragging is. */
const toggleCollapsed = (): void => void store.set('enemies', { ...cfg.value, collapsed: !cfg.value.collapsed })

let sent = ''
function report(): void {
  const el = root.value
  const r = el && list.value.length ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('enemies:resize', { width: r.width, height: r.height })
}
watch([() => list.value.length, () => cfg.value.collapsed], () => void nextTick(report))

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <section
        v-if="list.length"
        :class="['text-glow m-1.5 w-[300px] rounded-lg border px-2.5 py-2', store.panelVisible && 'cursor-move']"
        :style="panelStyle(cfg.opacity, '239 68 68')"
        @pointerdown="store.panelVisible && drag.onPointerDown($event)"
      >
        <div :class="['flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-red', !cfg.collapsed && 'mb-1']">
          <span class="size-1.5 animate-pulse rounded-full bg-red" />
          {{ list.length === 1 ? t('Enemy nearby') : t('Enemies nearby · {n}', { n: list.length }) }}
          <span v-if="preview" class="ml-auto font-normal normal-case tracking-normal text-darker">{{ t('drag to move') }}</span>
          <CollapseButton v-if="store.panelVisible" :class="!preview && 'ml-auto'" :collapsed="cfg.collapsed" @toggle="toggleCollapsed" />
        </div>
        <div v-if="!cfg.collapsed" class="space-y-0.5">
          <div v-for="e in list.slice(0, ROWS)" :key="e.entity" class="flex items-baseline gap-1.5 text-[13px]">
            <ClassIcon class="self-center" :class-name="e.className" :size="16" />
            <span class="max-w-[150px] shrink-0 truncate font-medium text-default">{{ e.name }}</span>
            <span v-if="e.pvp && !e.openPvp" class="shrink-0 self-center rounded bg-red/20 px-1 text-[10px] font-semibold leading-4 text-red" :title="t('Their PvP is on: they can attack you')">PvP</span>
            <span v-if="e.server" class="shrink-0 text-[11px] tabular-nums text-red">[{{ serverTag(e.server) }}]</span>
            <span
              v-if="e.combatPower"
              class="shrink-0 text-[11px] font-semibold tabular-nums text-yellow"
              :title="`${t('Combat power')}${e.level ? `, Lv${e.level}` : ''}${e.gearScore ? `, ${t('gear score {n}', { n: e.gearScore })}` : ''}`"
            >
              [{{ e.combatPower.toLocaleString('en-US') }}]
            </span>
            <span v-if="e.legion" class="ml-auto min-w-0 truncate text-[11px] text-darker">&lt;{{ e.legion }}&gt;</span>
          </div>
        </div>
        <div v-if="!cfg.collapsed && list.length > ROWS" class="mt-0.5 text-[11px] text-darker">… {{ t('{n} more', { n: list.length - ROWS }) }}</div>
      </section>
    </div>
  </div>
</template>
