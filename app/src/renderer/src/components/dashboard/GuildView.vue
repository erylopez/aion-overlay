<script setup lang="ts">
// Guild: every member of your roster on the Lokthar site with all their characters (their main, then
// their alts), each with its class, gear score, combat power and Odyle energy, so alts of the right
// class and strength are easy to find for a run. Two views of the same list: by member, or every
// character on its own. Filtered by class and by a name; sorted by combat power, gear score or energy.
// What the site has is sent by main/guild.ts (the overlay reports yours as the game says it).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import { refillsBetween, ENERGY } from '@shared/characters.ts'
import type { GuildCharacter, GuildMember } from '@shared/guild.ts'
import { CLASS_COLORS } from '@shared/meter.ts'

const store = useApp()
const api = bridge()
const guild = computed(() => store.guild)

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 30_000)
onMounted(() => void api.invoke('guild:refresh'))
onBeforeUnmount(() => clearInterval(ticker))

/** The game's item icons, in public/items (bound, not written in the template: the compiler would turn a literal path into an import). */
const ICONS = { energy: 'items/odyle-energy.webp', power: 'items/combat-power.png', gear: 'items/gear-score.png' }
/** The game's colour for charged energy (as the Characters page). */
const CHARGED = '#3ce0d0'
const CLASSES = ['gladiator', 'templar', 'assassin', 'ranger', 'sorcerer', 'spiritmaster', 'cleric', 'chanter'] as const
const icons = import.meta.glob<string>('@/assets/classes/*.png', { eager: true, import: 'default' })
const ALIAS: Record<string, string> = { elementalist: 'spiritmaster', summoner: 'spiritmaster' }
const iconOf = (className: string | null): string | null => {
  const name = className?.toLowerCase()
  return name ? (Object.entries(icons).find(([k]) => k.endsWith(`/classes/${ALIAS[name] ?? name}.png`))?.[1] ?? null) : null
}
/** The class name the meter and the colours use for a site name. */
const display = (className: string | null): string | null => {
  const n = className?.toLowerCase()
  if (!n) return null
  const meterName = n === 'summoner' || n === 'elementalist' ? 'spiritmaster' : n
  return meterName.charAt(0).toUpperCase() + meterName.slice(1)
}
const colorOf = (className: string | null): string => CLASS_COLORS[display(className) ?? ''] ?? CLASS_COLORS[className ?? ''] ?? '#787b8a'
const bar = (className: string | null): string => `linear-gradient(90deg, ${colorOf(className)}a8 0%, ${colorOf(className)}40 55%, ${colorOf(className)}14 100%)`
/** The list's: fading out completely before its middle. */
const fade = (className: string | null): string => `linear-gradient(90deg, ${colorOf(className)}a0 0%, ${colorOf(className)}00 100%)`

// ---- filters ----------------------------------------------------------------------------------

const view = ref<'members' | 'characters'>((() => { try { return localStorage.getItem('guild.view') === 'characters' ? 'characters' : 'members' } catch { return 'members' } })())
const sort = ref<'power' | 'gear' | 'energy' | 'name'>('power')
const query = ref('')
const picked = ref(new Set<string>())
/** Gear score thresholds that open content (Ludra 2800, its hard mode 3000): one picked at a time. */
const GS_STEPS = [700, 1400, 1600, 1900, 2100, 2200, 2600, 2700, 2800, 3000]
const minGear = ref(0)
const toggleGear = (n: number): void => { minGear.value = minGear.value === n ? 0 : n }
const setView = (v: 'members' | 'characters'): void => {
  view.value = v
  try { localStorage.setItem('guild.view', v) } catch { /* private window */ }
}
const toggleClass = (c: string): void => {
  const next = new Set(picked.value)
  if (!next.delete(c)) next.add(c)
  picked.value = next
}

/** Energy now: the site's figure refilled for the time since it answered (+15 every 3 hours). */
const energyNow = (c: GuildCharacter): number | null => {
  const e = c.energy
  if (!e) return null
  return e.value >= e.max ? e.value : Math.min(e.max, e.value + refillsBetween(ENERGY, guild.value.at || now.value, now.value) * e.per)
}
const sortKey = (c: GuildCharacter): number => (sort.value === 'power' ? (c.combatPower ?? 0) : sort.value === 'gear' ? (c.gearScore ?? 0) : sort.value === 'energy' ? (energyNow(c) ?? -1) + (c.energy?.extra ?? 0) / 1000 : 0)

const classOf = (c: GuildCharacter): string => (ALIAS[c.className?.toLowerCase() ?? ''] ?? c.className?.toLowerCase() ?? '')
const matches = (c: GuildCharacter, owner: string): boolean => {
  const q = query.value.trim().toLowerCase()
  if (picked.value.size && !picked.value.has(classOf(c))) return false
  if (minGear.value && (c.gearScore ?? 0) < minGear.value) return false
  return !q || owner.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
}

interface Card { member: GuildMember; rows: GuildCharacter[]; best: number }
const cards = computed<Card[]>(() => {
  const out: Card[] = []
  for (const member of guild.value.members) {
    const rows = member.characters.filter((c) => matches(c, member.name))
    if (!rows.length) continue
    // The main stays first; the others by what is sorted.
    const sorted = [...rows].sort((a, b) => Number(b.main) - Number(a.main) || (sort.value === 'name' ? a.name.localeCompare(b.name) : sortKey(b) - sortKey(a)))
    out.push({ member, rows: sorted, best: Math.max(...rows.map(sortKey)) })
  }
  return out.sort((a, b) => (sort.value === 'name' ? a.member.name.localeCompare(b.member.name) : b.best - a.best))
})
interface Flat { c: GuildCharacter; owner: string; you: boolean; id: number }
const flat = computed<Flat[]>(() => {
  const rows: Flat[] = []
  for (const member of guild.value.members) for (const c of member.characters) if (matches(c, member.name)) rows.push({ c, owner: member.name, you: member.you, id: member.id })
  return rows.sort((a, b) => (sort.value === 'name' ? a.c.name.localeCompare(b.c.name) : sortKey(b.c) - sortKey(a.c)))
})
const total = computed(() => guild.value.members.reduce((n, m) => n + m.characters.length, 0))

const short = (n: number | null): string => {
  if (n === null || n <= 0) return '–'
  return n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString('en-US')
}
const pct = (c: GuildCharacter): number => (c.energy ? Math.min(100, ((energyNow(c) ?? 0) / c.energy.max) * 100) : 0)

const refreshing = ref(false)
async function refresh(): Promise<void> {
  refreshing.value = true
  try { await api.invoke('guild:refresh') } finally { refreshing.value = false }
}
const turnOn = (): void => void store.set('guildEvents', { ...store.settings.guildEvents, enabled: true })

const SORTS = [
  { id: 'power', label: 'CP' },
  { id: 'gear', label: 'GS' },
  { id: 'energy', label: 'Energy' },
  { id: 'name', label: 'A–Z' },
] as const
const busy = computed(() => guild.value.state === 'loading' && !guild.value.members.length)
</script>

<template>
  <div class="mx-auto max-w-[1500px]">
    <!-- Header: the roster, and the way to ask the site again. -->
    <div class="mb-4 flex items-center gap-3">
      <h1 class="text-xl font-semibold tracking-tight">{{ t('Guild') }}</h1>
      <span v-if="guild.roster" class="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">{{ guild.roster }}</span>
      <span v-if="total" class="text-xs tabular-nums text-darker">{{ guild.members.length }} · {{ total }}</span>
      <button
        v-if="guild.state === 'ok'"
        type="button"
        class="ml-auto flex size-8 items-center justify-center rounded-md text-darker transition hover:bg-dark hover:text-default"
        :title="t('Refresh')"
        @click="refresh"
      >
        <svg viewBox="0 0 16 16" :class="['size-4', refreshing && 'animate-spin']" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
        </svg>
      </button>
    </div>

    <!-- Nothing to show: why, in one line. -->
    <div v-if="guild.state === 'notMember' || guild.state === 'off' || guild.state === 'waiting' || guild.state === 'error'" class="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-card px-6 py-20 text-center">
      <svg viewBox="0 0 16 16" class="size-9 text-darkest" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 1.5 2.5 3.5v4c0 3.2 2.3 5.6 5.5 7 3.2-1.4 5.5-3.8 5.5-7v-4zM6 8l1.5 1.5L10.5 6.5" />
      </svg>
      <div class="text-sm font-medium">
        {{ guild.state === 'notMember' ? t('None of your characters is on a roster') : guild.state === 'off' ? t('The Lokthar site is off') : guild.state === 'waiting' ? t('Waiting for a character') : t('Could not reach Lokthar') }}
      </div>
      <button v-if="guild.state === 'off'" type="button" class="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover" @click="turnOn">{{ t('Turn on') }}</button>
      <button v-else-if="guild.state === 'error'" type="button" class="rounded-md bg-dark px-3 py-1.5 text-sm font-medium hover:bg-light" @click="refresh">{{ t('Try again') }}</button>
    </div>

    <template v-else>
      <!-- Toolbar. -->
      <div class="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-2 bg-[color:var(--bg,#09090b)]/90 px-1 py-2 backdrop-blur">
        <label class="relative min-w-[200px] flex-1 sm:max-w-xs">
          <svg viewBox="0 0 16 16" class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-darker" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
          <input v-model="query" type="search" :placeholder="t('Search')" class="h-9 w-full rounded-lg border border-card bg-card pl-8 pr-3 text-sm outline-none transition focus:border-accent" />
        </label>
        <div class="flex items-center gap-1">
          <button
            v-for="c in CLASSES"
            :key="c"
            type="button"
            :title="display(c) ?? c"
            :class="['flex size-9 items-center justify-center rounded-lg border transition', picked.has(c) ? 'border-accent bg-accent/15' : 'border-transparent opacity-60 hover:bg-dark hover:opacity-100']"
            @click="toggleClass(c)"
          >
            <img v-if="iconOf(c)" :src="iconOf(c)!" alt="" draggable="false" class="size-6 object-contain" />
          </button>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <div class="inline-flex items-center gap-0.5 rounded-lg bg-dark p-0.5 text-xs">
            <button v-for="s in SORTS" :key="s.id" type="button" :class="['rounded-md px-2.5 py-1 font-medium transition-colors', sort === s.id ? 'bg-light text-default shadow-sm' : 'text-darker hover:text-default']" @click="sort = s.id">{{ t(s.label) }}</button>
          </div>
          <div class="inline-flex items-center gap-0.5 rounded-lg bg-dark p-0.5">
            <button type="button" :title="t('By member')" :class="['flex size-7 items-center justify-center rounded-md transition-colors', view === 'members' ? 'bg-light text-default shadow-sm' : 'text-darker hover:text-default']" @click="setView('members')">
              <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
            </button>
            <button type="button" :title="t('All characters')" :class="['flex size-7 items-center justify-center rounded-md transition-colors', view === 'characters' ? 'bg-light text-default shadow-sm' : 'text-darker hover:text-default']" @click="setView('characters')">
              <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
            </button>
          </div>
        </div>
        <div class="flex basis-full flex-wrap items-center gap-1">
          <img :src="ICONS.gear" alt="" draggable="false" class="mr-1 h-4 w-[11px]" :title="t('Gear score')" />
          <button
            v-for="n in GS_STEPS"
            :key="n"
            type="button"
            :class="['rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums transition', minGear === n ? 'border-accent bg-accent/15 text-default' : 'border-transparent bg-dark text-darker hover:text-default']"
            @click="toggleGear(n)"
          >{{ n }}+</button>
        </div>
      </div>

      <!-- Loading: the shape of what is coming. -->
      <div v-if="busy" class="grid gap-3 xl:grid-cols-2">
        <div v-for="i in 6" :key="i" class="h-40 animate-pulse rounded-2xl border border-card bg-card/60" />
      </div>

      <p v-else-if="!cards.length" class="py-16 text-center text-sm text-darker">{{ t('No one matches') }}</p>

      <!-- By member: a card each, their characters as bars. -->
      <TransitionGroup v-else-if="view === 'members'" tag="div" name="g" class="relative grid items-start gap-3 xl:grid-cols-2">
        <section
          v-for="card in cards"
          :key="card.member.id"
          :class="['overflow-hidden rounded-2xl border bg-card/70', card.member.you ? 'border-accent/60 shadow-[0_0_0_1px_rgba(139,92,246,0.18)]' : 'border-card']"
        >
          <header class="flex items-center gap-2 px-4 pb-1.5 pt-3">
            <span v-if="card.member.you" class="size-1.5 shrink-0 rounded-full bg-accent" />
            <h2 class="min-w-0 truncate text-[15px] font-semibold">{{ card.member.name }}</h2>
            <span class="rounded-full bg-dark px-1.5 text-[11px] font-semibold tabular-nums leading-5 text-darker">{{ card.rows.length }}</span>
          </header>
          <ul class="space-y-1 px-2 pb-2.5">
            <li v-for="c in card.rows" :key="c.name" class="guild-row group relative overflow-hidden rounded-lg">
              <div class="absolute inset-0" :style="{ background: bar(c.className) }" />
              <div class="absolute inset-y-0 left-0 w-14" style="background: linear-gradient(90deg, rgba(9, 9, 11, 0.8), rgba(9, 9, 11, 0))" />
              <div class="relative grid grid-cols-[28px_minmax(0,1fr)_84px_66px_156px] items-center gap-2.5 py-1.5 pl-2 pr-3">
                <img v-if="iconOf(c.className)" :src="iconOf(c.className)!" alt="" draggable="false" class="size-7 object-contain drop-shadow-[0_0_3px_rgba(0,0,0,0.8)]" />
                <span v-else class="size-7" />
                <span class="flex min-w-0 flex-col leading-tight">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <svg v-if="c.main" viewBox="0 0 16 16" class="size-3 shrink-0 text-[#ffc53d]" fill="currentColor" :title="t('Main')"><path d="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z" /></svg>
                    <span class="truncate text-[13px] font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.95),0_0_3px_rgba(0,0,0,0.8)]">{{ c.name }}</span>
                  </span>
                  <span class="truncate text-[10px] text-default/70 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">{{ [display(c.className), c.level ? `Lv ${c.level}` : null].filter(Boolean).join(' · ') }}</span>
                </span>
                <span class="text-right [text-shadow:0_1px_2px_rgba(0,0,0,0.95),0_0_3px_rgba(0,0,0,0.8)]" :title="t('Combat power')"><img :src="ICONS.power" alt="" draggable="false" class="mr-1 inline-block size-4 align-[-3px]" /><span class="text-[14px] font-bold tabular-nums">{{ short(c.combatPower) }}</span></span>
                <span class="text-right [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]" :title="t('Gear score')"><img :src="ICONS.gear" alt="" draggable="false" class="mr-1 inline-block h-4 w-[11px] align-[-3px]" /><span class="text-[12px] tabular-nums text-default/85">{{ c.gearScore ?? '–' }}</span></span>
                <span v-if="c.energy" class="flex items-center justify-end gap-1.5" :title="t('Odyle Energy')">
                  <span class="h-1.5 w-20 overflow-hidden rounded-full bg-black/45"><span class="block h-full rounded-full bg-[#ffc53d] transition-[width] duration-700" :style="{ width: `${pct(c)}%` }" /></span>
                  <span class="w-[42px] text-right text-[11px] font-semibold tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.95)]">{{ energyNow(c) }}<span v-if="c.energy.extra" class="block text-[9px] leading-none" :style="{ color: CHARGED }">+{{ c.energy.extra }}</span></span>
                  <img :src="ICONS.energy" alt="" draggable="false" class="size-4 shrink-0" />
                </span>
                <span v-else class="text-right text-[11px] text-default/30">–</span>
              </div>
            </li>
          </ul>
        </section>
      </TransitionGroup>

      <!-- Every character on its own, in one list. -->
      <div v-else class="overflow-hidden rounded-2xl border border-card bg-card/70">
        <div class="grid grid-cols-[28px_minmax(0,1.2fr)_minmax(0,1fr)_74px_56px_190px] items-center gap-3 border-b border-card px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-darkest">
          <span /><span>{{ t('Character') }}</span><span>{{ t('Member') }}</span><span class="flex justify-end" :title="t('Combat power')"><img :src="ICONS.power" alt="CP" draggable="false" class="size-4" /></span><span class="flex justify-end" :title="t('Gear score')"><img :src="ICONS.gear" alt="GS" draggable="false" class="h-4 w-[11px]" /></span><span class="text-right">{{ t('Energy') }}</span>
        </div>
        <TransitionGroup tag="ul" name="g" class="relative">
          <li v-for="r in flat" :key="r.id + r.c.name" class="guild-row group relative overflow-hidden border-b border-card/60 last:border-0">
            <div class="absolute inset-y-0 left-0 w-1/2" :style="{ background: fade(r.c.className) }" />
            <div class="relative grid grid-cols-[28px_minmax(0,1.2fr)_minmax(0,1fr)_74px_56px_190px] items-center gap-3 px-4 py-1.5">
              <img v-if="iconOf(r.c.className)" :src="iconOf(r.c.className)!" alt="" draggable="false" class="size-7 object-contain" />
              <span v-else class="size-7" />
              <span class="flex min-w-0 flex-col leading-tight">
                <span class="flex min-w-0 items-center gap-1.5">
                  <svg v-if="r.c.main" viewBox="0 0 16 16" class="size-3 shrink-0 text-[#ffc53d]" fill="currentColor"><path d="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z" /></svg>
                  <span class="truncate text-[13px] font-semibold">{{ r.c.name }}</span>
                </span>
                <span class="truncate text-[10px] text-default/60">{{ [display(r.c.className), r.c.level ? `Lv ${r.c.level}` : null].filter(Boolean).join(' · ') }}</span>
              </span>
              <span :class="['flex min-w-0 items-center gap-1.5 truncate text-[13px]', r.you ? 'font-semibold text-accent' : 'text-dark']"><span v-if="r.you" class="size-1.5 shrink-0 rounded-full bg-accent" />{{ r.owner }}</span>
              <span class="text-right text-[14px] font-bold tabular-nums">{{ short(r.c.combatPower) }}</span>
              <span class="text-right text-[12px] tabular-nums text-dark">{{ r.c.gearScore ?? '–' }}</span>
              <span v-if="r.c.energy" class="flex items-center justify-end gap-2">
                <span class="h-1.5 w-24 overflow-hidden rounded-full bg-dark"><span class="block h-full rounded-full bg-[#ffc53d] transition-[width] duration-700" :style="{ width: `${pct(r.c)}%` }" /></span>
                <span class="w-12 text-right text-[12px] font-semibold tabular-nums">{{ energyNow(r.c) }}<span v-if="r.c.energy.extra" class="ml-0.5 text-[10px]" :style="{ color: CHARGED }">+{{ r.c.energy.extra }}</span></span>
                <img :src="ICONS.energy" alt="" draggable="false" class="size-4 shrink-0" />
              </span>
              <span v-else class="text-right text-[11px] text-darkest">–</span>
            </div>
          </li>
        </TransitionGroup>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Cards and rows ease in and out as the filters change; the rest move over. */
.g-enter-active,
.g-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.g-move {
  transition: transform 0.28s ease;
}
.g-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.g-leave-active {
  position: absolute;
  width: 100%;
}
.g-leave-to {
  opacity: 0;
}
</style>
