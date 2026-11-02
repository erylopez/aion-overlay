<script setup lang="ts">
// Copied from Nyerk (GPL-3.0), https://github.com/xCROv/aion2-nyerk
// app/src/renderer/src/pages/KillFeedPage.vue at ddcdc48 (0.2.17).
// The kill feed over the game: a small window opened from the PvP page. Its title bar holds
// this session's kills and deaths (all it shows between kills), moves the window and closes it;
// each player kill around you slides in under it and falls off after a few seconds, as the HUD's
// soul lines do. Its skull opens a small map of where you last died.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
import ClassIcon from '@/components/ClassIcon.vue'
import CollapseButton from '@/components/CollapseButton.vue'
import SkullMark from '@/components/SkullMark.vue'
import WorldMap from '@/components/WorldMap.vue'
import { bridge } from '@/lib/bridge.ts'
import { t } from '@/lib/i18n.ts'
import { panelStyle } from '@/lib/overlayLook.ts'
import { loadSpawns, type SpawnData } from '@/lib/spawns.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { serverTag } from '@shared/servers.ts'
import { lastDeath, type PvpKill } from '@shared/tracker.ts'

const SHOW_MS = 8000
const MAX_LINES = 5

const store = useApp()
const root = ref<HTMLElement | null>(null)
const counts = computed(() => ({
  kills: store.pvp.filter((k) => k.mine).length,
  deaths: store.pvp.filter((k) => k.died).length,
}))
const tag = (server: number | null): string | null =>
  server === null || server === (store.status?.server ?? null) ? null : serverTag(server)

/** The kills on show: each added as it comes, and dropped SHOW_MS later. */
const lines = ref<PvpKill[]>([])
let known = -1
watch(
  () => store.pvp,
  (all) => {
    // Until the store is ready the list is the past (the window just opened), counted below once
    // ready: only what comes after is shown. A shorter list is a Clear.
    if (!store.ready || known < 0 || all.length < known) {
      if (store.ready) known = all.length
      return
    }
    for (const k of all.slice(known)) {
      // Raw objects on both sides: the store's list and this one hold reactive proxies, and a proxy
      // never equals its object (the HUD's toasts found this out).
      const raw = toRaw(k)
      lines.value = [...lines.value, raw].slice(-MAX_LINES)
      setTimeout(() => (lines.value = lines.value.filter((x) => toRaw(x) !== raw)), SHOW_MS)
    }
    known = all.length
  },
  { immediate: true },
)
watch(() => store.ready, (ready) => ready && known < 0 && (known = store.pvp.length))

const drag = windowDrag({ move: 'killfeed:moveTo', end: 'killfeed:dragEnd' })
const close = (): void => void bridge().invoke('killfeed:close')
const cfg = computed(() => store.settings.killFeed)
/**
 * Your target under the title bar: the player you last targeted, as the game sends their sheet.
 * The game says nothing when you let go of one, so it stays TARGET_MS, unless another replaces it.
 */
const TARGET_MS = 120_000
const clock = ref(Date.now())
const ticker = setInterval(() => (clock.value = Date.now()), 5000)
onBeforeUnmount(() => clearInterval(ticker))
const target = computed(() => {
  const tp = store.target
  return cfg.value.target && tp && clock.value - tp.at < TARGET_MS ? tp : null
})
const cp = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))

/** The enemy sound (Enemies nearby's), muted or not from here: the same setting as the PvP page's. */
const enemySound = computed(() => store.settings.enemies.sound)
const toggleSound = (): void => void store.set('enemies', { ...store.settings.enemies, sound: !enemySound.value })

/** Where you last died: the skull opens a small map of it (the zones' data loaded only then). */
const death = computed(() => lastDeath(store.pvp))
const showDeath = ref(false)
const spawns = shallowRef<SpawnData | null>(null)
const deathWorld = computed(() => (death.value && spawns.value ? (spawns.value.worlds[death.value.place.world] ?? null) : null))
function toggleDeath(): void {
  showDeath.value = !showDeath.value
  if (showDeath.value && !spawns.value) void loadSpawns().then((d) => (spawns.value = d))
}
const ago = (at: number): string => {
  const m = Math.max(0, Math.round((clock.value - at) / 60_000))
  return m < 1 ? t('just now') : m < 60 ? t('{n} min ago', { n: m }) : t('{n} h ago', { n: Math.round(m / 60) })
}

/** Minimized: the title bar only (the kills and deaths), no kill lines. */
const toggleCollapsed = (): void => void store.set('killFeed', { ...cfg.value, collapsed: !cfg.value.collapsed })

/** Tell main how big the window is: it is sized to its content. */
let sent = ''
function report(): void {
  const r = root.value?.getBoundingClientRect()
  if (!r) return
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void bridge().invoke('killfeed:resize', { width: r.width, height: r.height })
}
watch([lines, counts, target, () => cfg.value.collapsed, showDeath, deathWorld], () => void nextTick(report), { deep: true })
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
      <div class="text-glow m-1.5 w-[300px] rounded-lg border" :style="panelStyle(cfg.opacity)">
        <header class="flex cursor-move items-center gap-2 px-2.5 py-1.5" :title="t('Drag to move')" @pointerdown="drag.onPointerDown">
          <svg viewBox="0 0 16 16" class="size-3.5 text-danger" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <path d="M3 13 13 3M9.5 3H13v3.5M3 3l4 4M13 13l-3-3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="text-[11px] font-semibold uppercase tracking-wide text-darker">PvP</span>
          <span class="text-xs tabular-nums"><span class="font-semibold text-green">{{ counts.kills }}</span> kills</span>
          <span class="text-xs tabular-nums"><span class="font-semibold text-danger">{{ counts.deaths }}</span> {{ t('deaths') }}</span>
          <button
            v-if="death"
            type="button"
            :class="['ml-auto flex size-5 shrink-0 items-center justify-center rounded hover:bg-dark', showDeath && 'bg-dark']"
            :title="showDeath ? t('Hide where you last died') : t('Where you last died')"
            @pointerdown.stop
            @dblclick.stop
            @click="toggleDeath"
          >
            <SkullMark :size="16" />
          </button>
          <button
            type="button"
            :class="['flex size-5 shrink-0 items-center justify-center rounded hover:bg-dark hover:text-default', !death && 'ml-auto', enemySound ? 'text-dark' : 'text-danger']"
            :title="enemySound ? t('Enemy sound on: click to mute it') : t('Enemy sound muted: click to turn it on')"
            @pointerdown.stop
            @dblclick.stop
            @click="toggleSound"
          >
            <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" />
              <path v-if="enemySound" d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.3 6.3 0 0 1 0 9" />
              <path v-else d="M10.5 6l4 4M14.5 6l-4 4" />
            </svg>
          </button>
          <CollapseButton :collapsed="cfg.collapsed" @toggle="toggleCollapsed" />
          <button
            type="button"
            class="flex size-5 items-center justify-center rounded text-darker hover:bg-dark hover:text-default"
            :title="t('Close (the PvP page or Home opens it again)')"
            @pointerdown.stop
            @click="close"
          >
            <svg viewBox="0 0 16 16" class="size-3" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <div v-if="showDeath && death" :class="['px-2.5 py-1.5', cfg.opacity > 0 && 'border-t border-card']" @pointerdown.stop>
          <div class="mb-1 flex min-w-0 items-baseline gap-1.5 text-xs">
            <span class="truncate font-semibold text-default">{{ deathWorld?.name ?? t('Loading map…') }}</span>
            <span class="shrink-0 text-darker">{{ ago(death.at) }}</span>
            <span class="ml-auto min-w-0 truncate text-darker">{{ t('by {name}', { name: death.killer.name }) }}</span>
          </div>
          <div class="h-[220px] overflow-hidden rounded border border-card">
            <WorldMap
              v-if="deathWorld"
              :world="deathWorld"
              :layers="[]"
              :focus="[death.place.position]"
              :death="death.place.position"
              :you="store.nearby.world === death.place.world ? store.nearby.position : null"
              :hint="false"
            />
          </div>
        </div>
        <div
          v-if="target && !cfg.collapsed"
          :class="['flex min-w-0 items-center gap-1.5 px-2.5 py-1.5', cfg.opacity > 0 && 'border-t border-card']"
          :title="t('Your target: {class}, Lv{level}, gear score {gs}', { class: target.className ?? t('class unknown'), level: target.level, gs: target.gearScore }) + (target.legion ? `, <${target.legion}>` : '')"
        >
          <ClassIcon :class-name="target.className" :size="20" />
          <span :class="['truncate text-sm font-semibold', target.enemy ? 'text-danger' : 'text-default']">{{ target.name }}</span>
          <span class="shrink-0 text-[10px] text-yellow">[{{ serverTag(target.server) }}]</span>
          <span v-if="target.combatPower" class="ml-auto shrink-0 text-xs font-semibold tabular-nums text-yellow">{{ cp(target.combatPower) }}</span>
        </div>
        <TransitionGroup
          v-if="lines.length && !cfg.collapsed"
          tag="div"
          name="toast"
          :class="['space-y-1 px-2.5 py-1.5', cfg.opacity > 0 && 'border-t border-card']"
        >
          <div
            v-for="k in lines"
            :key="`${k.at}-${k.killer.name}`"
            :class="['flex min-w-0 items-center gap-1 text-xs', k.fight && 'cursor-pointer hover:underline']"
            :title="k.fight ? t('Show the fight') : undefined"
            @pointerdown.stop
            @click="k.fight && bridge().invoke('details:open', { kind: 'pvp', id: k.fight })"
          >
            <ClassIcon :class-name="k.killer.className" :size="14" />
            <span :class="['truncate font-semibold', k.mine ? 'text-green' : 'text-dark']">{{ k.killer.name }}</span>
            <span v-if="tag(k.killer.server)" class="shrink-0 text-[10px] text-yellow">[{{ tag(k.killer.server) }}]</span>
            <span class="shrink-0 text-darker">→</span>
            <ClassIcon :class-name="k.victim?.className" :size="14" />
            <span :class="['truncate font-semibold', k.died ? 'text-danger' : 'text-dark']">{{ k.victim?.name ?? t('a player') }}</span>
            <span v-if="k.victim && tag(k.victim.server)" class="shrink-0 text-[10px] text-yellow">[{{ tag(k.victim.server) }}]</span>
          </div>
        </TransitionGroup>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 300ms ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.toast-leave-to {
  opacity: 0;
}
</style>
