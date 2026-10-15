/**
 * Lokthar sync: the field boss list, as the game's map shows it, posted to the Lokthar site's
 * timers (POST <url>/api/aion2/field_bosses), whose spawn tracker then follows the game's own
 * respawn times.
 *
 * Off until it is turned on in Settings with a token from the site. It is the only request the app
 * makes: to that one address, carrying the boss list (ids, up or dead, times) and your game server
 * id, nothing else. It goes from here (Node's fetch), not from the windows, whose requests
 * index.ts still blocks.
 */
import { fieldBosses, type MapBoss } from './fieldBosses.ts'
import { settings } from './settings.ts'
import { log } from './tracker.ts'
import type { SyncResult } from '../shared/lokthar.ts'

const PATH = '/api/aion2/field_bosses'
const TIMEOUT_MS = 10_000
/** After a failure (the site down, no network): the latest list is tried again this much later. */
const RETRY_MS = 60_000

interface Change {
  id: number
  timer: string | null
  outcome: string
  killed_at: string | null
}

let last: SyncResult | null = null
let pending: { server: number; world: number; list: MapBoss[] } | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let busy = false

/** The site's endpoint, or why there is none. https only, but for a development server at localhost. */
function endpoint(): URL | string {
  const { url } = settings.get('lokthar')
  let base: URL
  try {
    base = new URL(url)
  } catch {
    return `not a web address: ${url}`
  }
  const local = base.hostname === 'localhost' || base.hostname === '127.0.0.1'
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) return `${base.origin} is not https`
  return new URL(PATH, base.origin)
}

async function post(body: object): Promise<{ status: number; json: Record<string, unknown> }> {
  const to = endpoint()
  if (typeof to === 'string') throw new Error(to)
  const res = await fetch(to, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.get('lokthar').token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

/** What a refusal means, in words. */
function refusal(status: number, json: Record<string, unknown>, server: number | null = null): string {
  switch (json['error']) {
    case 'unauthorized':
      return 'the token was refused: make a new one on the site'
    case 'forbidden':
      return 'your account cannot report kills (admin or the Elite reporter role)'
    case 'wrong_server':
      return `this character's server (${server ?? '?'}) is not the guild's (${(json['servers'] as number[] | undefined)?.join(', ') ?? '?'})`
  }
  return `the site answered ${status}`
}

function finish(ok: boolean, message: string): SyncResult {
  last = { at: Date.now(), ok, message }
  log(`lokthar sync: ${message}`)
  return last
}

async function send(): Promise<void> {
  if (busy || !pending) return
  const batch = pending
  pending = null
  busy = true
  try {
    const { status, json } = await post({ server: batch.server, world: batch.world, bosses: batch.list })
    if (status !== 200) {
      finish(false, refusal(status, json, batch.server))
      return
    }
    const changes = (json['changes'] as Change[] | undefined) ?? []
    const moved = changes.filter((c) => c.outcome === 'recorded' || c.outcome === 'corrected')
    const odd = changes.filter((c) => c.outcome === 'stale' || c.outcome === 'future')
    finish(
      true,
      (moved.length ? moved.map((c) => `${c.timer} ${c.outcome} (kill ${c.killed_at})`).join(', ') : 'timers already up to date') +
        (odd.length ? `; ignored ${odd.map((c) => `${c.timer} (${c.outcome})`).join(', ')}` : ''),
    )
  } catch (err) {
    finish(false, `could not reach the site: ${(err as Error).message}`)
    // Tried again a little later, unless a newer list came in meanwhile.
    pending ??= batch
    retry ??= setTimeout(() => {
      retry = null
      void send()
    }, RETRY_MS)
  } finally {
    busy = false
    if (pending && !retry) void send()
  }
}

export const lokthar = {
  last: (): SyncResult | null => last,

  /** Check the address and the token, without sending any bosses. */
  async test(): Promise<SyncResult> {
    const { token } = settings.get('lokthar')
    if (!token) return finish(false, 'no token yet')
    try {
      const { status, json } = await post({ server: fieldBosses.server(), bosses: [] })
      return status === 200 ? finish(true, `connected as ${String(json['user'])}`) : finish(false, refusal(status, json))
    } catch (err) {
      return finish(false, `could not reach the site: ${(err as Error).message}`)
    }
  },
}

export function startLokthar(): void {
  fieldBosses.onMap((server, world, list) => {
    const { sync, token } = settings.get('lokthar')
    if (!sync || !token) return
    // Field bosses are per server: until the character (and so its server) is known, nothing goes.
    if (server === null) {
      log('lokthar sync: waiting for the character, to know its server')
      return
    }
    pending = { server, world, list }
    void send()
  })
}
