/**
 * Guild events (shared/guildEvents.ts): the Lokthar site's Aion 2 events that ask the roster who
 * comes, and your answer to each, from the main process (Node's fetch and WebSocket, at the site
 * of Settings → Lokthar), as lokthar.ts does.
 *
 * No sign-in: each request carries the characters this app has seen (Characters page; the one
 * playing first), and the site answers for the Aion roster member with one of them, or says
 * none is. The site tells of changes over its ActionCable connection (Aion2::EventsChannel):
 * { type: 'events' } or { type: 'responses', event_id }, and the list is asked again then; and
 * every few minutes anyway, more often while that connection is down.
 */
import { broadcast } from './broadcast.ts'
import { characterStore } from './characters.ts'
import { siteBase } from './lokthar.ts'
import { settings } from './settings.ts'
import { log, tracker } from './tracker.ts'
import { NO_GUILD_EVENTS, type GuildAttendee, type GuildEvent, type GuildEventDetail, type GuildEventsState, type Rsvp } from '../shared/guildEvents.ts'

const TIMEOUT_MS = 10_000
/** Asked again this often while the live connection is up (in case it missed something)... */
const POLL_LIVE_MS = 10 * 60_000
/** ...and this often while it is down. */
const POLL_MS = 60_000
/** The live connection, when it drops: tried again after this, doubling up to the most. */
const RECONNECT_MS = [5_000, 120_000] as const
/** The site pings every 3 seconds: this long without one, the connection is taken as dead. */
const STALE_MS = 20_000
const CHANNEL = 'Aion2::EventsChannel'

let state: GuildEventsState = { ...NO_GUILD_EVENTS }
let poll: ReturnType<typeof setTimeout> | null = null
let socket: WebSocket | null = null
let socketKey = ''
let reconnectIn: number = RECONNECT_MS[0]
let reconnect: ReturnType<typeof setTimeout> | null = null
let stale: ReturnType<typeof setTimeout> | null = null
let refreshing: Promise<void> | null = null
let again = false

function set(patch: Partial<GuildEventsState>): void {
  state = { ...state, ...patch, at: Date.now() }
  broadcast('guildEvents:state', state)
}

/** The characters to be known by: the one playing first, then the rest the Characters page has. */
function characters(): { name: string; server: number }[] {
  const s = tracker.status()
  const all = Object.values(characterStore.all()).map((c) => ({ name: c.name, server: c.server }))
  if (s.character && s.server !== null && s.server !== undefined) all.unshift({ name: s.character, server: s.server })
  return [...new Map(all.map((c) => [`${c.server}:${c.name.toLowerCase()}`, c])).values()]
}

function url(path: string, query?: Record<string, string>): URL | string {
  const base = siteBase()
  if (typeof base === 'string') return base
  const u = new URL(path, base)
  for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v)
  return u
}

async function request(method: 'GET' | 'PUT', path: string, body?: object): Promise<{ status: number; json: Record<string, unknown> }> {
  const chars = JSON.stringify(characters())
  const to = url(path, method === 'GET' ? { characters: chars } : undefined)
  if (typeof to === 'string') throw new Error(to)
  const res = await fetch(to, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify({ ...body, characters: JSON.parse(chars) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

const time = (v: unknown): number => (typeof v === 'string' ? Date.parse(v) : 0)

function toEvent(e: Record<string, unknown>): GuildEvent {
  const counts = (e['counts'] ?? {}) as Partial<Record<Rsvp, number>>
  return {
    id: Number(e['id']),
    name: String(e['name'] ?? ''),
    activity: String(e['activity'] ?? 'other'),
    activityLabel: String(e['activity_label'] ?? e['activity'] ?? ''),
    color: String(e['color'] ?? '#64748b'),
    startsAt: time(e['starts_at']),
    endsAt: time(e['ends_at']),
    description: typeof e['description'] === 'string' && e['description'] ? e['description'] : null,
    closesAt: time(e['closes_at']),
    open: e['open'] === true,
    roster: String(e['roster'] ?? ''),
    status: (e['status'] as Rsvp | null) ?? null,
    counts: { going: counts.going ?? 0, maybe: counts.maybe ?? 0, declined: counts.declined ?? 0 },
    unanswered: Number(e['unanswered'] ?? 0),
  }
}

function toAttendee(r: Record<string, unknown>): GuildAttendee {
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    status: r['status'] as Rsvp,
    name: String(r['name'] ?? ''),
    className: typeof r['class_name'] === 'string' ? r['class_name'] : null,
    gearScore: n(r['gear_score']),
    combatPower: n(r['combat_power']),
    answeredAt: time(r['answered_at']),
  }
}

function member(json: Record<string, unknown>): GuildEventsState['member'] {
  const m = json['member'] as { name?: string; roster?: string | null } | undefined
  return m?.name ? { name: m.name, roster: m.roster ?? null } : null
}

/** A refusal, as the state shows it. */
function refused(status: number, json: Record<string, unknown>): void {
  if (json['error'] === 'not_a_member') set({ state: 'notMember', message: null, member: null, events: [] })
  else set({ state: 'error', message: `the site answered ${status}` })
}

/** Ask the site for the events again (one at a time; asked meanwhile, once more after). */
function refresh(): Promise<void> {
  if (refreshing) {
    again = true
    return refreshing
  }
  refreshing = (async () => {
    if (!settings.get('guildEvents').enabled) return
    if (!characters().length) return set({ state: 'waiting', message: null })
    if (state.state === 'off' || state.state === 'waiting') set({ state: 'loading' })
    try {
      const { status, json } = await request('GET', '/api/aion2/events')
      if (status !== 200) return refused(status, json)
      const events = ((json['events'] as Record<string, unknown>[] | undefined) ?? []).map(toEvent)
      set({ state: 'ok', message: null, member: member(json), events })
      connect()
    } catch (err) {
      set({ state: 'error', message: `could not reach the site: ${(err as Error).message}` })
    }
  })().finally(() => {
    refreshing = null
    schedule()
    if (again) {
      again = false
      void refresh()
    }
  })
  return refreshing
}

function schedule(): void {
  if (poll) clearTimeout(poll)
  poll = settings.get('guildEvents').enabled ? setTimeout(() => void refresh(), state.live ? POLL_LIVE_MS : POLL_MS) : null
}

// ---- the live connection (ActionCable's protocol, by hand) ------------------------------------

function cableUrl(): string | null {
  const base = siteBase()
  if (typeof base === 'string') return null
  const u = new URL('/cable', base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}

function disconnect(): void {
  if (reconnect) clearTimeout(reconnect)
  if (stale) clearTimeout(stale)
  reconnect = stale = null
  const s = socket
  socket = null
  socketKey = ''
  s?.close()
  if (state.live) set({ live: false })
}

/** Up, for the characters known now (again when they change): only once the site knows you. */
function connect(): void {
  const to = cableUrl()
  const identifier = JSON.stringify({ channel: CHANNEL, characters: JSON.stringify(characters()) })
  const key = `${to}|${identifier}`
  if (!to || state.state !== 'ok') return
  if (socket && socketKey === key) return
  disconnect()
  socketKey = key
  const ws = new WebSocket(to, ['actioncable-v1-json', 'actioncable-unsupported'])
  socket = ws
  const alive = (): void => {
    if (stale) clearTimeout(stale)
    stale = setTimeout(() => ws.close(), STALE_MS)
  }
  ws.addEventListener('open', alive)
  ws.addEventListener('message', (e) => {
    alive()
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(String(e.data)) as Record<string, unknown>
    } catch {
      return
    }
    switch (msg['type']) {
      case 'welcome':
        ws.send(JSON.stringify({ command: 'subscribe', identifier }))
        return
      case 'confirm_subscription':
        reconnectIn = RECONNECT_MS[0]
        set({ live: true })
        schedule()
        log('guild events: live')
        return
      case 'reject_subscription':
        log('guild events: the site turned the live connection down')
        ws.close()
        return
      case 'disconnect':
        ws.close()
        return
    }
    const message = msg['message'] as { type?: string; event_id?: number } | undefined
    if (!message?.type) return
    void refresh()
    if (message.type === 'responses' && typeof message.event_id === 'number') broadcast('guildEvents:changed', message.event_id)
  })
  ws.addEventListener('close', () => {
    if (socket !== ws) return
    socket = null
    socketKey = ''
    if (stale) clearTimeout(stale)
    if (state.live) set({ live: false })
    schedule()
    if (!settings.get('guildEvents').enabled) return
    reconnect = setTimeout(() => {
      reconnect = null
      connect()
    }, reconnectIn)
    reconnectIn = Math.min(RECONNECT_MS[1], reconnectIn * 2)
  })
  ws.addEventListener('error', () => undefined)
}

// ---- the rest of the app ---------------------------------------------------------------------

export const guildEvents = {
  get: (): GuildEventsState => state,

  refresh,

  /** Answer an event; null when the site took it, or why not. */
  async respond(id: number, status: Rsvp): Promise<string | null> {
    try {
      const res = await request('PUT', `/api/aion2/events/${id}/response`, { status })
      if (res.status === 204) {
        // Shown answered at once; the site's own count comes with the refresh.
        set({ events: state.events.map((e) => (e.id === id ? { ...e, status } : e)) })
        void refresh()
        return null
      }
      if (res.json['error'] === 'closed') return 'answers for this event are closed'
      refused(res.status, res.json)
      return state.message ?? 'the site did not take it'
    } catch (err) {
      return `could not reach the site: ${(err as Error).message}`
    }
  },

  /** An event with who answered what; null when it can't be had. */
  async detail(id: number): Promise<GuildEventDetail | null> {
    try {
      const { status, json } = await request('GET', `/api/aion2/events/${id}`)
      if (status !== 200) return null
      return {
        event: toEvent(json['event'] as Record<string, unknown>),
        responses: ((json['responses'] as Record<string, unknown>[] | undefined) ?? []).map(toAttendee),
      }
    } catch {
      return null
    }
  },

  /** Popped up and closed without answering: not popped up again this run. */
  dismiss(id: number): void {
    if (!state.dismissed.includes(id)) set({ dismissed: [...state.dismissed, id] })
  },
}

/** Turned on or off, or the site changed: start over. */
function apply(): void {
  disconnect()
  if (!settings.get('guildEvents').enabled) {
    if (poll) clearTimeout(poll)
    poll = null
    set({ ...NO_GUILD_EVENTS, dismissed: state.dismissed })
    return
  }
  void refresh()
}

export function startGuildEvents(): void {
  settings.onChanged((_all, key) => {
    if (key === 'guildEvents' || key === 'lokthar') apply()
  })
  // A character seen for the first time (or logged in) may be the one the site knows.
  let known = JSON.stringify(characters())
  const changed = (): void => {
    const now = JSON.stringify(characters())
    if (now === known) return
    known = now
    if (settings.get('guildEvents').enabled) void refresh()
  }
  tracker.onStatus(changed)
  characterStore.onChange(changed)
  apply()
}
