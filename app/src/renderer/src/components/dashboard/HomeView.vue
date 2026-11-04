<script setup lang="ts">
// Home: who is playing and whether the game is being read, every overlay with its switch (the
// overlays' own settings are on their pages), and a card per page with what it has now.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import StatusDot, { statusText } from '@/components/StatusDot.vue'
import Toggle from '@/components/Toggle.vue'
import Countdown from '@/components/ui/Countdown.vue'
import { bridge } from '@/lib/bridge.ts'
import { plural, t } from '@/lib/i18n.ts'
import { currentWorld, nearbyPets, useSpawns } from '@/lib/spawns.ts'
import { timerNext } from '@/lib/timerView.ts'
import { useApp } from '@/stores/app.ts'
import { formatKina } from '@shared/kina.ts'
import { NO_METER, type MeterData } from '@shared/meter.ts'
import type { Settings } from '@shared/settings.ts'
import { serverName } from '@shared/servers.ts'
import { LANGS } from '@shared/i18n.ts'
import { bossZone, TIMERS } from '@shared/timers.ts'

const emit = defineEmits<{ go: [page: string] }>()
const store = useApp()
const api = bridge()
const spawns = useSpawns()

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)
const meter = ref<MeterData>(NO_METER)
const fights = ref<number | null>(null)
const overlaysOff = ref(false)
const offs: (() => void)[] = []
onMounted(async () => {
  offs.push(api.on('meter:dps', (m) => (meter.value = m)))
  offs.push(api.on('overlays:hidden', (off) => (overlaysOff.value = off)))
  offs.push(api.on('history:changed', async () => (fights.value = (await api.invoke('history:list')).filter((f) => !f.isTrain).length)))
  meter.value = await api.invoke('meter:get')
  overlaysOff.value = await api.invoke('overlays:hidden')
  fights.value = (await api.invoke('history:list')).filter((f) => !f.isTrain).length
})
onBeforeUnmount(() => {
  clearInterval(ticker)
  for (const off of offs) off()
})

// ---- the greeting: the time of day, and the one thing worth saying now -------------------------
const hour = computed(() => new Date(now.value).getHours())
const greeting = computed(() => {
  const h = hour.value
  return t(h < 5 ? 'Late night grind' : h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening')
})
/** Under it: what matters most right now, else what the app is. */
const greetingLine = computed(() => {
  const s = store.status
  if (s?.state === 'error') return t('Your pets, fights, buffs, maps and timers, read from the game as you play.')
  if (s?.state === 'idle') return t('Aion 2 is not open: everything wakes up with the game.')
  const event = nextEvent.value
  const mins = event ? Math.round((event.at - now.value) / 60_000) : null
  if (event && mins !== null && mins <= 60) return mins <= 0 ? t('{name} is starting now.', { name: event.def.name }) : t('{name} starts in {n} min.', { name: event.def.name, n: mins })
  if (bossesUp.value) return plural(bossesUp.value, '{n} field boss alive in Verteron right now.', '{n} field bosses alive in Verteron right now.')
  if (store.sessionSouls) return plural(store.sessionSouls, '{n} soul so far this session: keep farming.', '{n} souls so far this session: keep farming.')
  if (hour.value < 5) return t('Late one: remember to sleep at some point.')
  const day = new Date(now.value).getDay()
  if (day === 0 || day === 6) return t('Weekend: good time to farm some pets.')
  return t('Your pets, fights, buffs, maps and timers, read from the game as you play.')
})
const who = computed(() => {
  const s = store.status
  return [s?.character, s?.server ? serverName(s.server) : null, s?.level ? `Lv ${s.level}` : null].filter(Boolean).join(' · ')
})
const npcapMissing = computed(() => store.status?.npcapMissing === true)
const error = computed(() => (store.status?.state === 'error' && !npcapMissing.value ? (store.status.detail ?? t('The engine stopped with an error.')) : null))

// ---- the overlays -----------------------------------------------------------------------------
type Overlay = { id: string; name: string; about: string; page: string; on: boolean; set: (on: boolean) => void }
function flip<K extends keyof Settings>(key: K, field: string): (on: boolean) => void {
  return (on) => void store.set(key, { ...(store.settings[key] as object), [field]: on } as unknown as Settings[K])
}
const overlays = computed<Overlay[]>(() => {
  const s = store.settings
  return [
    { id: 'hud', name: t('Pets HUD'), about: t('Souls, nearby soul monsters, Hidden Cubes'), page: 'settings', on: s.hud.enabled, set: flip('hud', 'enabled') },
    { id: 'meter', name: t('Damage meter'), about: t('You and your party, live'), page: 'meter', on: s.meter.enabled, set: flip('meter', 'enabled') },
    { id: 'skills', name: t('My skills'), about: t('Your damage, skill by skill'), page: 'meter', on: s.skills.enabled, set: flip('skills', 'enabled') },
    { id: 'buffs', name: 'Buffs', about: t('What is on you, and for how long'), page: 'buffs', on: s.buffs.enabled, set: flip('buffs', 'enabled') },
    { id: 'cc', name: t('CC / Debuffs'), about: t('When you are stunned, rooted, feared…'), page: 'buffs', on: s.buffs.cc, set: flip('buffs', 'cc') },
    { id: 'training', name: t('Training'), about: t('Training dummy runs: clock and DPS'), page: 'training', on: s.dummy.overlay, set: flip('dummy', 'overlay') },
    { id: 'minimap', name: t('Map'), about: t('Your zone, tracked pets, cubes'), page: 'map', on: s.minimap.enabled, set: flip('minimap', 'enabled') },
    { id: 'bossRuns', name: t('Boss Runs'), about: t('Field bosses about to spawn, with their TP'), page: 'bosses', on: s.bossRuns.enabled, set: flip('bossRuns', 'enabled') },
    { id: 'timerBar', name: t('Countdown bar'), about: t('Events with an alert on'), page: 'events', on: s.timerBar.enabled, set: flip('timerBar', 'enabled') },
    {
      id: 'killFeed',
      name: t('Kill feed'),
      about: t('Player kills around you'),
      page: 'pvp',
      on: s.killFeed.open,
      set: (on) => void api.invoke(on ? 'killfeed:open' : 'killfeed:close'),
    },
    { id: 'merchant', name: t('Merchant pets'), about: t('When you open the Black Cloud shop'), page: 'settings', on: s.hud.merchant, set: flip('hud', 'merchant') },
  ]
})
const overlaysOn = computed(() => overlays.value.filter((o) => o.on).length)
async function toggleAll(): Promise<void> {
  overlaysOff.value = await api.invoke('overlays:toggle')
}

// ---- what each page has now -------------------------------------------------------------------
function short(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`
  return Math.round(n).toLocaleString('en-US')
}
const zone = computed(() => {
  const id = spawns.value ? currentWorld(store.nearby, spawns.value) : null
  return id !== null ? (spawns.value?.worlds[id]?.name ?? null) : null
})
const nearbyCount = computed(() => (spawns.value ? nearbyPets(store.nearby, spawns.value).filter((n) => !store.hiddenPet(n.pet)).length : 0))
const nextEvent = computed(() => {
  const t = store.settings.timers
  const on = TIMERS.filter((d) => d.schedule.kind !== 'boss' && t.enabled[d.id] && t.shown[d.id])
  return on.map((def) => ({ def, at: timerNext(def, now.value) })).sort((a, b) => a.at - b.at)[0] ?? null
})
const bossesUp = computed(() => Object.entries(store.fieldBosses).filter(([id, b]) => b.up && bossZone(Number(id)) === 'verteron').length)
const pvp = computed(() => ({ kills: store.pvp.filter((k) => k.mine).length, deaths: store.pvp.filter((k) => k.died).length }))
const myDps = computed(() => meter.value.rows.find((r) => r.you) ?? null)

const ICONS: Record<string, string> = {
  meter: 'M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5',
  map: 'M1.5 4l4.5-2 4 2 4.5-2v10l-4.5 2-4-2-4.5 2zM6 2v10M10 4v10',
  pets: 'M5 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM11 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM3 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM13 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 9c-2 0-3.5 2-3.5 3.3 0 1 1 1.2 2.2 1.2.6 0 .9-.3 1.3-.3s.7.3 1.3.3c1.2 0 2.2-.2 2.2-1.2C11.5 11 10 9 8 9Z',
  pvp: 'M3 13 13 3M9.5 3H13v3.5M3 3l4 4M13 13l-3-3',
  buffs: 'M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z',
  events: 'M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14h3',
  bosses: 'M8 2a5 5 0 0 0-3.5 8.5V13h7v-2.5A5 5 0 0 0 8 2zM6 8.5h.01M10 8.5h.01',
  history: 'M2 8a6 6 0 1 0 1.8-4.3M2 2.5v3h3M8 5v3l2 1.5',
  session: 'M2.5 11.5 6 8l2.5 2.5 5-5M10 5.5h3.5V9',
}
</script>

<template>
  <div>
    <!-- Who and what: the greeting, the game's state, all overlays at once. -->
    <div class="relative mb-6 overflow-hidden rounded-xl border border-card bg-gradient-to-br from-accent-soft/70 via-card to-card px-6 py-6">
      <img src="/icon.png" alt="" class="pointer-events-none absolute -right-6 -top-6 size-40 opacity-10" draggable="false" />
      <div class="flex items-start gap-3">
        <h1 class="min-w-0 flex-1 text-3xl font-bold tracking-tight">{{ greeting }}{{ store.status?.character ? `, ${store.status.character}` : '' }}</h1>
        <div class="relative flex shrink-0 rounded-full border border-card bg-default/60 p-0.5 text-xs" role="group" :aria-label="t('Language')">
          <button
            v-for="l in LANGS"
            :key="l.id"
            type="button"
            :class="['rounded-full px-2.5 py-0.5 font-medium transition', store.settings.language === l.id ? 'bg-accent/20 text-accent' : 'text-darker hover:text-default']"
            @click="store.set('language', l.id)"
          >
            {{ l.label }}
          </button>
        </div>
      </div>
      <p class="mt-1 text-sm text-darker">{{ greetingLine }}</p>
      <div class="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span class="flex items-center gap-2 rounded-full border border-card bg-default/60 px-3 py-1 font-medium">
          <StatusDot :status="store.status" />{{ t(statusText(store.status)) }}<span v-if="who" class="text-darker">· {{ who }}</span>
        </span>
        <span class="rounded-full border border-card bg-default/60 px-3 py-1 font-medium">{{ plural(overlaysOn, '{n} overlay on', '{n} overlays on') }}</span>
        <button
          type="button"
          :class="['rounded-full border px-3 py-1 font-medium transition', overlaysOff ? 'border-yellow/50 bg-yellow/10 text-yellow' : 'border-card bg-default/60 hover:bg-dark']"
          :title="t('Alt+Shift+E does the same from the game')"
          @click="toggleAll"
        >
          {{ overlaysOff ? t('Overlays hidden: show them') : t('Hide all overlays') }} <span class="text-darkest">Alt+Shift+E</span>
        </button>
      </div>
    </div>

    <!-- Npcap missing: nothing works without it, so it comes first, with the way to get it. Main checks
         again every few seconds and starts the tracker once it is there. -->
    <div v-if="npcapMissing" class="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-warning/50 bg-warning/10 px-5 py-4">
      <svg viewBox="0 0 16 16" class="size-6 shrink-0 text-warning" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1.5 15 14H1zM8 6v3.5M8 11.8v.2" /></svg>
      <div class="min-w-0 flex-1">
        <div class="text-base font-semibold text-default">{{ t('Install Npcap to use the overlay') }}</div>
        <div class="text-sm text-dark">{{ t('The overlay reads the game\'s traffic with Npcap. Install it with its default options and the overlay starts by itself.') }}</div>
      </div>
      <a href="https://npcap.com/#download" target="_blank" rel="noopener" class="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
        <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" /></svg>
        {{ t('Download Npcap') }}
      </a>
    </div>

    <div v-if="error" class="mb-6 flex items-start gap-3 rounded-xl border border-danger/50 bg-danger/10 px-4 py-3">
      <svg viewBox="0 0 16 16" class="mt-0.5 size-4 shrink-0 text-danger" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1.5 15 14H1zM8 6v3.5M8 11.8v.2" /></svg>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-danger">{{ t('The game\'s traffic can\'t be read') }}</div>
        <div class="text-sm text-dark">{{ error }}</div>
      </div>
      <Button size="sm" @click="api.invoke('tracker:restart')">{{ t('Try again') }}</Button>
    </div>

    <section class="mb-6">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-darker">{{ t('Overlays') }}</h2>
      <div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <div
          v-for="o in overlays"
          :key="o.id"
          :class="['flex items-center gap-3 rounded-xl border px-3.5 py-3 transition', o.on ? 'border-accent/40 bg-accent-soft/30' : 'border-card bg-card']"
        >
          <button type="button" class="min-w-0 flex-1 text-left" :title="t('{name}: its settings', { name: o.name })" @click="emit('go', o.page)">
            <div class="truncate text-sm font-medium">{{ o.name }}</div>
            <div class="truncate text-xs text-darker">{{ o.about }}</div>
          </button>
          <Toggle :model-value="o.on" @update:model-value="o.set($event)" />
        </div>
      </div>
    </section>

    <section class="mb-6">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-darker">{{ t('In game') }}</h2>
      <div class="grid grid-cols-2 gap-3">
        <button v-for="card in [
          { page: 'meter', title: t('Combat Meter'), line: meter.target ? `${meter.target.name}: ${myDps ? t('you {dps}/s', { dps: short(myDps.dps) }) : plural(meter.rows.length, '{n} player', '{n} players')}` : t('No fight right now.') },
          { page: 'map', title: t('Map'), line: zone ? `${zone}${store.cubes.length ? ` · ${plural(store.cubes.length, '{n} Hidden Cube nearby', '{n} Hidden Cubes nearby')}` : ''}` : t('Where you are shows once you enter a zone.') },
          { page: 'pets', title: 'Pets', line: `${plural(store.sessionSouls, '{n} soul this session', '{n} souls this session')} · ${plural(nearbyCount, '{n} pet around you', '{n} pets around you')}` },
          { page: 'buffs', title: 'Buffs', line: store.settings.buffs.enabled ? t('{n} on you now', { n: store.buffs.length }) : t('The buffs overlay is off.') },
          { page: 'pvp', title: 'PvP', line: t('{n} kills seen · yours {kills}, deaths {deaths}', { n: store.pvp.length, kills: pvp.kills, deaths: pvp.deaths }) },
          { page: 'bosses', title: 'Field Bosses', line: Object.keys(store.fieldBosses).length ? t('{n} alive in Verteron', { n: bossesUp }) : t('Open the map in game to read them.') },
        ]" :key="card.page" type="button" class="group flex items-center gap-4 rounded-xl border border-card bg-card px-4 py-3.5 text-left transition hover:border-light hover:bg-dark" @click="emit('go', card.page)">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dark text-accent group-hover:bg-light">
            <svg viewBox="0 0 16 16" class="size-5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS[card.page]" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">{{ card.title }}</span>
            <span class="block truncate text-xs text-darker">{{ card.line }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="size-4 shrink-0 text-darkest" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 4 4 4-4 4" /></svg>
        </button>
        <button type="button" class="group flex items-center gap-4 rounded-xl border border-card bg-card px-4 py-3.5 text-left transition hover:border-light hover:bg-dark" @click="emit('go', 'events')">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dark text-accent group-hover:bg-light">
            <svg viewBox="0 0 16 16" class="size-5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS.events" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">{{ t('Event Alerts') }}</span>
            <span v-if="nextEvent" class="block truncate text-xs text-darker">{{ t('{name} in', { name: nextEvent.def.name }) }} <span class="text-yellow"><Countdown :at="nextEvent.at" :now="now" /></span></span>
            <span v-else class="block truncate text-xs text-darker">{{ t('No alerts on: pick the events to hear about.') }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="size-4 shrink-0 text-darkest" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 4 4 4-4 4" /></svg>
        </button>
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-darker">{{ t('Records') }}</h2>
      <div class="grid grid-cols-2 gap-3">
        <button v-for="card in [
          { page: 'history', title: t('History'), line: fights === null ? '…' : plural(fights, '{n} boss fight saved', '{n} boss fights saved') },
          { page: 'session', title: t('Session'), line: store.kinaRate !== null ? t('{kina} Kina per hour · {n} souls', { kina: formatKina(store.kinaRate), n: store.sessionSouls }) : t('{n} souls so far', { n: store.sessionSouls }) },
        ]" :key="card.page" type="button" class="group flex items-center gap-4 rounded-xl border border-card bg-card px-4 py-3.5 text-left transition hover:border-light hover:bg-dark" @click="emit('go', card.page)">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dark text-accent group-hover:bg-light">
            <svg viewBox="0 0 16 16" class="size-5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS[card.page]" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">{{ card.title }}</span>
            <span class="block truncate text-xs text-darker">{{ card.line }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="size-4 shrink-0 text-darkest" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 4 4 4-4 4" /></svg>
        </button>
      </div>
    </section>
  </div>
</template>
