/**
 * Guild events: the Lokthar site's Aion 2 events that ask the roster who comes (made on its admin
 * calendar), and each member's answer, going, maybe or not going (main/guildEvents.ts). The site
 * knows the member by the characters this app has seen in game: no sign-in.
 */

export type Rsvp = 'going' | 'maybe' | 'declined'
export const RSVPS: Rsvp[] = ['going', 'maybe', 'declined']

export interface GuildEvent {
  id: number
  name: string
  /** raid, dungeon, abyss, siege, rift, social, other; with the site's label and colour. */
  activity: string
  activityLabel: string
  color: string
  startsAt: number
  endsAt: number
  description: string | null
  /** Answers are taken until then (the start, or a deadline of the event's). */
  closesAt: number
  open: boolean
  roster: string
  /** Your answer; null before you give one. */
  status: Rsvp | null
  counts: Record<Rsvp, number>
  /** Members of the roster who have not answered. */
  unanswered: number
}

/** One member's answer, as their main: class (the site's name: templar, summoner...), gear score, combat power. */
export interface GuildAttendee {
  status: Rsvp
  name: string
  className: string | null
  gearScore: number | null
  combatPower: number | null
  answeredAt: number
}

export interface GuildEventDetail {
  event: GuildEvent
  responses: GuildAttendee[]
}

export interface GuildEventsState {
  /**
   * off: turned off; waiting: no character seen yet to ask with; notMember: none of them is on the
   * site's Aion roster; error: the site could not be reached (message says why).
   */
  state: 'off' | 'waiting' | 'loading' | 'ok' | 'notMember' | 'error'
  message: string | null
  member: { name: string; roster: string | null } | null
  events: GuildEvent[]
  /** Told of changes as they happen (the site's live connection); otherwise asked every few minutes. */
  live: boolean
  /** Popped up and closed without an answer: not popped up again this run. */
  dismissed: number[]
  at: number
}

export const NO_GUILD_EVENTS: GuildEventsState = { state: 'off', message: null, member: null, events: [], live: false, dismissed: [], at: 0 }

/** Open for answers and not answered yet. */
export const needsAnswer = (e: GuildEvent, now: number): boolean => e.open && e.status === null && e.closesAt > now

/** The one to pop up over the game: the soonest to close that needs an answer and was not closed. */
export function toPopUp(s: GuildEventsState, now: number): GuildEvent | null {
  return s.events.filter((e) => needsAnswer(e, now) && !s.dismissed.includes(e.id)).sort((a, b) => a.closesAt - b.closesAt)[0] ?? null
}
