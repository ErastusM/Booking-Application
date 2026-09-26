/**
 * One check for a week of working hours — the business's Working Hours
 * (Availability) and a team member's own weekly hours (StaffAvailability, and
 * each week of a rotation) are the same shape and are held to the same rules:
 *
 *   - a day switched on has at least one period;
 *   - every time is HH:mm, 24-hour;
 *   - each period ends after it starts;
 *   - periods don't overlap or touch (a split day — 08:00–12:00 and 14:00–18:00
 *     — is two periods with a break between them; 08:00–12:00 + 12:00–18:00 is
 *     one period, and is refused as two, as the Working Hours screens refuse it.
 *     Rows saved before this rule are read as one period everywhere —
 *     staffBooking.withinPeriods).
 *
 * Messages name the day, so the screen can say exactly what to fix. A day's
 * periods are saved in time order (sortedWeek), so they read back exactly as the
 * Working Hours screen shows them.
 */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_PERIODS = 6;
const toMins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const cap = (d) => d.charAt(0).toUpperCase() + d.slice(1);

// The business says "opening/closing"; a member's hours say "starting/ending".
const WORDS = {
    business: {
        missing: 'set the opening and closing time, or switch the day off.',
        inverted: (s) => `the closing time (${s.end}) must be after the opening time (${s.start}).`,
        overlap: 'two opening periods overlap — the second must start after the first closes, leaving a break between them.',
    },
    member: {
        missing: 'set the starting and ending time, or switch the day off.',
        inverted: (s) => `the ending time (${s.end}) must be after the starting time (${s.start}). Swap them if they're reversed.`,
        overlap: 'two working periods overlap. Please make them separate, non-overlapping times, with a break between them.',
    },
};

/**
 * The first problem with a week, as a sentence naming the day, or null.
 * `strictDays`: refuse keys that aren't a weekday (the business's form); a
 * member's week ignores them (the schema drops them anyway).
 */
function weekError(schedule, { kind = 'business', strictDays = kind === 'business' } = {}) {
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return 'schedule is required';
    const words = WORDS[kind] || WORDS.business;
    for (const [day, cfg] of Object.entries(schedule)) {
        if (!DAYS.includes(day)) {
            if (strictDays) return `Unknown day "${day}"`;
            continue;
        }
        if (!cfg?.enabled) continue;
        const label = cap(day);
        if (cfg.slots !== undefined && !Array.isArray(cfg.slots)) return `${label}: ${words.missing}`;
        const slots = Array.isArray(cfg.slots) ? cfg.slots : [];
        if (!slots.length) return `${label}: ${words.missing}`;
        if (slots.length > MAX_PERIODS) return `${label}: at most ${MAX_PERIODS} periods a day.`;
        for (const slot of slots) {
            if (!HHMM.test(String(slot?.start)) || !HHMM.test(String(slot?.end))) {
                return `${label}: times must be HH:mm, 24-hour (e.g. 08:30).`;
            }
            if (toMins(slot.end) <= toMins(slot.start)) return `${label}: ${words.inverted(slot)}`;
        }
        const sorted = [...slots].sort((a, b) => toMins(a.start) - toMins(b.start));
        for (let i = 1; i < sorted.length; i += 1) {
            // Touching (12:00 → 12:00) counts: two periods need a break between them.
            if (toMins(sorted[i].start) <= toMins(sorted[i - 1].end)) return `${label}: ${words.overlap}`;
        }
    }
    return null;
}

/** The week with each day's periods in time order ({ start, end } only). Call after weekError. */
function sortedWeek(schedule) {
    const out = {};
    Object.entries(schedule || {}).forEach(([day, cfg]) => {
        if (!DAYS.includes(day)) return;
        out[day] = {
            enabled: !!cfg?.enabled,
            slots: (Array.isArray(cfg?.slots) ? cfg.slots : [])
                .filter((s) => s && s.start !== undefined && s.end !== undefined)
                .map((s) => ({ start: s.start, end: s.end }))
                .sort((a, b) => toMins(a.start) - toMins(b.start)),
        };
    });
    return out;
}

module.exports = { weekError, sortedWeek, DAYS, MAX_PERIODS };
