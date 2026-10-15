/**
 * Everything the windows render from, kept in step with main. Each window has its own copy of
 * this store (separate renderers); main broadcasts every change to all of them.
 */
import { defineStore } from 'pinia'
import { computed, reactive, ref, toRaw } from 'vue'
import { SETTINGS_DEFAULTS, type SettingKey, type Settings } from '@shared/settings.ts'
import { MAX_LEVEL, NO_NEARBY, type Nearby, type Pet, type ShopStock, type SoulToast, type TrackerStatus } from '@shared/tracker.ts'
import { kinaPerHour, kinaSeries, NO_KINA, type KinaSession } from '@shared/kina.ts'
import type { FieldBosses, TimerAlert, TimerId } from '@shared/timers.ts'
import { bridge } from '@/lib/bridge.ts'
import type { Genus } from '@/lib/petDb.ts'
import type { Continent } from '@/lib/spawns.ts'

const TOAST_MS = 5000

export const useApp = defineStore('app', () => {
  const settings = ref<Settings>(structuredClone(SETTINGS_DEFAULTS))
  const status = ref<TrackerStatus | null>(null)
  const petMap = ref(new Map<number, Pet>())
  const toasts = ref<SoulToast[]>([])
  const hudEditing = ref(false)
  const panelVisible = ref(false)
  const ready = ref(false)
  const nearby = ref<Nearby>(NO_NEARBY)
  /** The timers alerting now (the bubble shakes while there are any). */
  const alerting = ref<TimerAlert[]>([])
  /** The field bosses as the map last listed them (the Gartua timer). */
  const fieldBosses = ref<FieldBosses>({})
  /** Timers to scroll to and highlight in the Timers tab (the bubble was clicked on their alert). */
  const timerFocus = ref<{ ids: TimerId[]; at: number } | null>(null)
  /** The Black Cloud Merchant's stock: the tabs opened, until their restock. */
  const shop = ref<ShopStock[]>([])
  /** This session's Kina; the rate is redrawn every few seconds as active time runs on. */
  const kina = ref<KinaSession>(NO_KINA)
  const now = ref(Date.now())
  setInterval(() => (now.value = Date.now()), 5000)
  const kinaRate = computed(() => kinaPerHour(kina.value, now.value))
  /** Kina per hour over time, for the sparklines. */
  const kinaTimeline = computed(() => kinaSeries(kina.value, now.value))
  /**
   * The collection's search, sort and filter pills. Kept here, not in the tab: the tab is rebuilt
   * after a pet's map closes, and the filters used to reset with it.
   */
  const collectionView = reactive({
    query: '',
    sort: 'souls' as 'souls' | 'name' | 'level' | 'recent' | 'range',
    filter: 'all' as 'all' | 'nearby' | 'pinned' | 'unfinished' | 'session',
    genus: null as Genus | null,
    continent: null as Continent | null,
  })
  /** The pet whose drop locations the panel is showing, if any. */
  const openPetId = ref<number | null>(null)

  const pets = computed(() => [...petMap.value.values()])
  const sessionSouls = computed(() => pets.value.reduce((n, p) => n + p.session, 0))
  /** Pets that gained souls this session, most recent first (by the last toast, then by count). */
  const lastSoulAt = ref(new Map<number, number>())
  /**
   * The current fight: when it began and when anything last happened (a kill, a soul, a crystal).
   * After settings.hud.idleHideSeconds of nothing, `fighting` turns false: the HUD clears and hides
   * until the next one, which then lists only its own pets.
   */
  const fightStart = ref(0)
  const lastActivity = ref(0)
  const fighting = ref(false)
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  function activity(at = Date.now()): void {
    if (!fighting.value) fightStart.value = at
    lastActivity.value = at
    fighting.value = true
    armIdle()
  }
  function armIdle(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    const secs = settings.value.hud.idleHideSeconds
    if (!secs || !fighting.value) return
    const left = lastActivity.value + secs * 1000 - Date.now()
    if (left <= 0) fighting.value = false
    else idleTimer = setTimeout(armIdle, left)
  }
  const recentPets = computed(() =>
    pets.value
      .filter((p) => p.session > 0 && !(settings.value.hideMaxed && p.level >= MAX_LEVEL))
      // With the idle timeout on, only this fight's pets: the last one's are cleared.
      .filter((p) => !settings.value.hud.idleHideSeconds || (lastSoulAt.value.get(p.id) ?? 0) >= fightStart.value)
      .sort((a, b) => (lastSoulAt.value.get(b.id) ?? 0) - (lastSoulAt.value.get(a.id) ?? 0) || b.session - a.session),
  )

  function addToast(t: SoulToast): void {
    toasts.value = [...toasts.value, t].slice(-4)
    activity(t.at)
    lastSoulAt.value = new Map(lastSoulAt.value).set(t.pet.id, t.at)
    // The array holds reactive proxies of the toasts, so compare the raw object: comparing the
    // proxy to `t` never matched, and lines stayed up until newer ones pushed them out.
    setTimeout(() => (toasts.value = toasts.value.filter((x) => toRaw(x) !== t)), TOAST_MS)
  }

  function setPet(p: Pet): void {
    petMap.value = new Map(petMap.value).set(p.id, p)
  }

  async function init(): Promise<void> {
    const api = bridge()
    api.on('settings:changed', (s) => {
      settings.value = s
      armIdle()
    })
    api.on('tracker:combat', (at) => activity(at))
    api.on('tracker:status', (s) => (status.value = s))
    api.on('tracker:pets', (list) => (petMap.value = new Map(list.map((p) => [p.id, p]))))
    api.on('tracker:pet', setPet)
    api.on('tracker:soul', (t) => {
      setPet(t.pet)
      addToast(t)
    })
    api.on('tracker:nearby', (n) => (nearby.value = n))
    api.on('tracker:shop', (s) => (shop.value = s))
    api.on('tracker:fieldBosses', (b) => (fieldBosses.value = b))
    api.on('tracker:kina', (k) => {
      kina.value = k
      now.value = Date.now()
    })
    api.on('timers:alerting', (a) => (alerting.value = a))
    api.on('hud:editing', (e) => (hudEditing.value = e))
    api.on('panel:visible', (v) => (panelVisible.value = v))
    const [s, t] = await Promise.all([api.invoke('settings:all'), api.invoke('tracker:get')])
    settings.value = s
    status.value = t.status
    petMap.value = new Map(t.pets.map((p) => [p.id, p]))
    nearby.value = t.nearby
    shop.value = t.shop
    kina.value = t.kina
    fieldBosses.value = t.fieldBosses
    alerting.value = await api.invoke('timers:get')
    ready.value = true
  }

  /** Optimistic: the local copy changes now, main's broadcast confirms it. */
  async function set<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    settings.value = { ...settings.value, [key]: value }
    await bridge().invoke('settings:set', key, JSON.parse(JSON.stringify(value)))
  }

  async function setHud(patch: Partial<Settings['hud']>): Promise<void> {
    await set('hud', { ...settings.value.hud, ...patch })
  }

  function togglePin(id: number): Promise<void> {
    const pinned = settings.value.hud.pinned
    return setHud({ pinned: pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id] })
  }

  /** A pet at the cap that the "hide maxed pets" setting leaves out (no more souls to collect). */
  function hiddenPet(id: number): boolean {
    return settings.value.hideMaxed && (petMap.value.get(id)?.level ?? 0) >= MAX_LEVEL
  }

  /** Show a pet's drop locations; the panel grows to fit the map while it is open. */
  function openPet(id: number | null): void {
    if (openPetId.value === id) return
    const wasOpen = openPetId.value !== null
    openPetId.value = id
    if (wasOpen !== (id !== null)) void bridge().invoke('panel:setExpanded', id !== null)
  }

  return {
    settings, status, pets, toasts, fighting, collectionView, shop, kina, kinaRate, kinaTimeline, alerting, timerFocus, fieldBosses, hudEditing, panelVisible, ready, sessionSouls, recentPets, openPetId, nearby,
    init, set, setHud, togglePin, openPet, hiddenPet,
  }
})
