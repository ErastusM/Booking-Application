/**
 * A service length in minutes, the way the business app has always written it
 * in the service editor: "45 min", "1 hr", "2 hr 30 min", "60 hr".
 *
 * One helper for both apps, so a client never sees "3600 min" where the owner
 * sees "60 hr" for the same service. Anything that isn't a positive number of
 * minutes renders as an empty string (the caller decides what to show instead).
 */
export function formatDuration(minutes: number | string | null | undefined): string {
    const n = Math.round(Number(minutes));
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 60) return `${n} min`;
    const h = Math.floor(n / 60);
    const r = n % 60;
    return r ? `${h} hr ${r} min` : `${h} hr`;
}
