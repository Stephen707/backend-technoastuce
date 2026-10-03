import { createHmac } from 'node:crypto';

const DAY_MS = 24 * 3600 * 1000;

// "2026-10-01" (UTC).
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS));
}

// Every day from `from` to `to`, both included.
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

export function msUntilEndOfUtcDay(now: Date): number {
  const end = Date.parse(`${utcDay(now)}T00:00:00Z`) + DAY_MS;
  return end - now.getTime();
}

/**
 * Anonymous visitor id for one day: HMAC(secret, day | ip | user agent).
 * Used only to count a visitor once per content and day; neither the IP
 * nor the hash is stored in the database, and since the day is part of the
 * input, ids can't be linked from one day to the next.
 */
export function visitorHash(
  secret: string,
  day: string,
  ip: string | undefined,
  userAgent: string | undefined,
): string {
  return createHmac('sha256', secret)
    .update(`${day}|${ip ?? ''}|${userAgent ?? ''}`)
    .digest('base64url')
    .slice(0, 22);
}

const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|archiver|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|httpclient|okhttp|go-http-client|java\//i;

// Crawlers, link previews, monitors and scripts don't count as views.
export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || BOT_USER_AGENT.test(userAgent);
}
