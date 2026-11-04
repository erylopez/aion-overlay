// Words for the guild events (shared/guildEvents.ts), shared by the popup and the Guild Events page.
import { plural, t } from '@/lib/i18n.ts'
import type { Rsvp } from '@shared/guildEvents.ts'

/** "Responses close in about 45 minutes.", in hours past 90 minutes; "Responses are closed." after. */
export function closesIn(at: number, now: number): string {
  const min = Math.round((at - now) / 60_000)
  if (min <= 0) return t('Responses are closed.')
  if (min < 90) return plural(min, 'Responses close in about {n} minute.', 'Responses close in about {n} minutes.')
  const h = Math.round(min / 60)
  if (h < 48) return plural(h, 'Responses close in about {n} hour.', 'Responses close in about {n} hours.')
  return plural(Math.round(h / 24), 'Responses close in {n} day.', 'Responses close in {n} days.')
}

/** Your answer, as its pill says it. */
export const RSVP_LABEL: Record<Rsvp, string> = { going: 'Signed up', maybe: 'Maybe', declined: 'Not going' }
/** Its pill's colours. */
export const RSVP_CLASS: Record<Rsvp, string> = {
  going: 'bg-green/15 text-green',
  maybe: 'bg-yellow/15 text-yellow',
  declined: 'bg-red/15 text-red',
}
