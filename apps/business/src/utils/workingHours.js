// A week of working hours as the Working Hours screens edit it — the business's
// (the owner's Availability tab), a team member's own (the same screen since
// #231) and the owner's view of a member's hours on their Team card.
//
// Each day is { enabled, slots: [{ start, end }, …] }: one period, or two for a
// split day (08:00–12:00 and 14:00–18:00, with a break between). The server
// holds both kinds of hours to the same rules (utils/weeklyHours on the API);
// these mirror them so a mistake is caught on screen, naming the day, before
// anything is sent.

export const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
// "+ Add a break / second period": at most two periods a day on these screens.
export const MAX_PERIODS = 2;
export const DEFAULT_PERIOD = { start: '09:00', end: '17:00' };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
export const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
export const capDay = (d) => (d ? d.charAt(0).toUpperCase() + d.slice(1) : d);
const isPeriod = (s) => !!s && HHMM.test(String(s.start)) && HHMM.test(String(s.end)) && toMin(s.end) > toMin(s.start);

/** A day's periods as { start, end } only, in time order. */
export const sortedPeriods = (slots) => (Array.isArray(slots) ? slots : [])
    .filter((s) => s && s.start !== undefined && s.end !== undefined)
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => toMin(a.start) - toMin(b.start));

// Sorted periods that touch or overlap, joined into one.
const joinTouching = (periods) => periods.reduce((out, p) => {
    const last = out[out.length - 1];
    if (last && toMin(p.start) <= toMin(last.end)) {
        if (toMin(p.end) > toMin(last.end)) last.end = p.end;
    } else out.push({ ...p });
    return out;
}, []);

/** The week with each day's periods in time order — what gets saved. */
export const sortedWeek = (week) => Object.fromEntries(Object.entries(week || {})
    .map(([day, cfg]) => [day, { enabled: !!cfg?.enabled, slots: sortedPeriods(cfg?.slots) }]));

/**
 * A stored week (from the API) in the editor's shape: every day present, each
 * with at least one period to show. A day switched on with no usable period is
 * shown switched OFF — that is how bookings read it (closed), so the screen
 * says the same and saving never quietly opens it. Periods that touch or
 * overlap (08:00–12:00 + 12:00–18:00, saved before these screens refused it)
 * show as the one period bookings read them as, so the week saves again as is.
 */
export const editableWeek = (raw) => Object.fromEntries(WEEK_DAYS.map((d) => {
    const periods = joinTouching(sortedPeriods(raw?.[d]?.slots).filter(isPeriod));
    const enabled = !!raw?.[d]?.enabled && periods.length > 0;
    return [d, { enabled, slots: periods.length ? periods : [{ ...DEFAULT_PERIOD }] }];
}));

/**
 * The first problem with a week, as a sentence naming the day (and the period,
 * when it's the second), or null. `words` are the screen's own: the business's
 * hours "open" and "close", a member's "start" and "end".
 */
export const weekProblem = (week, { words = ['opening', 'closing'] } = {}) => {
    const [openW, closeW] = words;
    for (const day of WEEK_DAYS) {
        const cfg = week?.[day];
        if (!cfg?.enabled) continue;
        const label = capDay(day);
        const slots = Array.isArray(cfg.slots) ? cfg.slots : [];
        if (!slots.length) return `${label}: set the ${openW} and ${closeW} time, or switch the day off.`;
        for (let i = 0; i < slots.length; i += 1) {
            const which = slots.length > 1 ? ` of the ${i === 0 ? 'first' : 'second'} period` : '';
            if (!HHMM.test(String(slots[i]?.start)) || !HHMM.test(String(slots[i]?.end))) return `${label}: set the ${openW} and ${closeW} time${which}.`;
            if (toMin(slots[i].end) <= toMin(slots[i].start)) return `${label}: the ${closeW} time${which} must be after the ${openW} time.`;
        }
        const sorted = sortedPeriods(slots);
        for (let i = 1; i < sorted.length; i += 1) {
            if (toMin(sorted[i].start) <= toMin(sorted[i - 1].end)) {
                return `${label}: the two periods overlap — the second must start after ${sorted[i - 1].end}, leaving a break between them.`;
            }
        }
    }
    return null;
};

/**
 * The period "+ Add a break / second period" adds after `first`: a lunch break
 * — the first period ends at 12:00 and the second starts at 13:00 — when the
 * first period spans lunchtime; otherwise an hour that starts an hour after
 * the first ends. null when there's no room left in the day.
 */
export const secondPeriodFor = (first) => {
    if (!isPeriod(first)) return null;
    const s = toMin(first.start); const e = toMin(first.end);
    if (s < 12 * 60 && e > 13 * 60) return { first: { start: first.start, end: '12:00' }, second: { start: '13:00', end: first.end } };
    const start = e + 60;
    const end = Math.min(start + 60, 23 * 60 + 59);
    if (end <= start) return null;
    return { first: { start: first.start, end: first.end }, second: { start: hhmm(start), end: hhmm(end) } };
};
