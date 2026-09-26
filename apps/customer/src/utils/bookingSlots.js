// Pure helpers for the booking time-slot list.
//
// Rule: full 1-hour blocks are the anchor — a completely free hour offers only its
// :00 (a free 5:00–6:00 shows 5:00, not 5:30), whatever the service length. A
// partial-hour start is created ONLY by a real boundary — the shift start or a
// booking's END — never an arbitrary mid-hour offset just because a short service
// could fit. A boundary is offered when the service fits there AND either it stays
// inside the leftover up to the next hour, or it ends exactly on an hour — so
// leftover minutes get used without a whole-hour booking sliding off the hour:
//   booking 9:00–9:15, 15-min service → 9:15 (fills the 9:15–10:00 leftover)
//   booking 4:00–4:30: 30-min → 4:30 (ends 5:00); 60-min → none (would end 5:30);
//                      1h30 → 4:30 (4:30–6:00)
// Starts must fit inside the working block, not be in the past, and not overlap a
// booking. A genuinely-bookable hour that is fully taken keeps a single greyed pill
// so the waitlist still works.
//
// All times are in minutes-from-midnight.

export const overlapsRange = (ranges, start, end) =>
    ranges.some((b) => start < b.end && end > b.start);

// Busy kinds that are NOT a bookable-but-taken slot: the customer can never take
// them, so they read "Unavailable" and offer no waitlist. Anything else (a real
// appointment, or a legacy range with no kind) is a booking.
const NON_BOOKING_KINDS = new Set(['blocked', 'break', 'off_shift', 'time_off']);

export const fmtMinutes = (mins) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * @param {Object}   args
 * @param {{start:number,end:number}[]} args.blocks       working blocks for the day
 * @param {{start:number,end:number,kind?:string}[]} args.bookedRanges  busy ranges.
 *        Kinds other than a real appointment — `blocked` (lunch, day off), `break`,
 *        `off_shift`, `time_off` (leave) — mark time the customer simply CAN'T book:
 *        an hour busy only because of those is "Unavailable", not "Taken", and
 *        offering its waitlist is meaningless (nobody cancels a lunch break or a
 *        leave the way they cancel a booking). A range with no `kind`, or an
 *        `appointment`, is a real booking whose waitlist is worth offering.
 * @param {number}   args.duration  service length in minutes
 * @param {number}   [args.minStart] earliest allowed start (e.g. "now" for today); -1 = none
 * @param {{start:number,end:number}[]} [args.openStarts] when the server knows
 *        exactly where the whole booking can START (the "any professional" view:
 *        a start must suit ONE person for the whole service), a start outside
 *        these inclusive ranges is taken even if its window looks free.
 * @returns {{time:string, isBooked:boolean, isBlocked:boolean, until?:string}[]}
 *        `until` (on a greyed "Unavailable" pill) is the time the service would
 *        run into when the start itself is free but the whole service doesn't fit
 *        before it — "15:00" for a 2 h service is not occupied, there is just not
 *        enough time before 16:00.
 */
export const buildTimeSlots = ({ blocks, bookedRanges = [], duration, minStart = -1, openStarts = null }) => {
    const slots = [];
    const dur = duration || 60;

    blocks.forEach((block) => {
        // A start is usable when it's inside the block, the whole service fits,
        // and it isn't in the past.
        const usable = (start) =>
            start >= block.start && start + dur <= block.end && start >= minStart;

        // Partial-hour starts come from real boundaries only — the shift start and
        // every busy-range END. A boundary is kept when the service either fits
        // inside the leftover up to the next hour (a 15-min service in a 9:15–10:00
        // gap), or ends exactly on an hour (a 1h30 that runs 4:30–6:00). A whole-
        // hour service that would end mid-hour (4:30 → 5:30) is dropped, so it stays
        // on the hour. No arbitrary mid-hour offsets are invented.
        const partialStarts = new Set();
        const consider = (t) => {
            if (t % 60 === 0) return;
            const gapEnd = (Math.floor(t / 60) + 1) * 60; // next hour boundary after t
            if (t + dur <= gapEnd || (t + dur) % 60 === 0) partialStarts.add(t);
        };
        consider(block.start);
        bookedRanges.forEach((b) => consider(b.end));

        const firstHour = Math.floor(block.start / 60) * 60;
        for (let hourStart = firstHour; hourStart < block.end; hourStart += 60) {
            let anyFree = false;
            let occupied = false;
            let hitRealBooking = false;
            // Candidate starts in this hour: the :00, plus any aligned leftover
            // starts that fall inside it — sorted so the list stays chronological.
            const candidates = [hourStart, ...[...partialStarts].filter((t) => t >= hourStart && t < hourStart + 60)]
                .sort((a, b) => a - b);
            for (const start of candidates) {
                if (!usable(start)) continue;
                const end = start + dur;
                // When the server lists the exact starts, a listed start is free:
                // it already accounts for everything busy, per person at THEIR
                // length (a faster colleague can finish before a block that the
                // menu length would run into), and an unlisted one is not.
                const open = openStarts ? openStarts.some((r) => start >= r.start && start <= r.end) : null;
                const hits = open ? [] : bookedRanges.filter((b) => start < b.end && end > b.start);
                const notOpen = open === false;
                if (hits.length || notOpen) {
                    occupied = true;
                    if (hits.some((h) => !NON_BOOKING_KINDS.has(h.kind)) || (notOpen && !hits.length)) hitRealBooking = true;
                    continue;
                }
                slots.push({ time: fmtMinutes(start), isBooked: false, isBlocked: false });
                anyFree = true;
            }
            // Fully-busy but genuinely-bookable hour → one greyed pill. If nothing
            // but blocked time caused it, mark it so the UI can say "Unavailable"
            // and skip the waitlist. Never show a pill for a past/unusable hour.
            if (!anyFree && occupied && usable(hourStart)) {
                const pill = { time: fmtMinutes(hourStart), isBooked: true, isBlocked: !hitRealBooking };
                // Free at the start, but the whole service runs into unavailable time.
                const hits = bookedRanges.filter((b) => hourStart < b.end && hourStart + dur > b.start);
                if (pill.isBlocked && hits.length && !hits.some((b) => b.start <= hourStart)) {
                    pill.until = fmtMinutes(Math.min(...hits.map((b) => b.start)));
                }
                slots.push(pill);
            }
        }
    });

    return slots;
};

// ── Moving a booking whose parts are done by different people ───────────────
// A multi-service ticket (Hilda 14:00–15:00, then Erastus 15:00–16:00) moves as
// one: every part shifts by the same amount, and each part must be clear in ITS
// person's time — which is how the server checks the move. Sizing the whole
// ticket against the first person's time offered starts where Erastus's part
// ran into his booking, and hid starts that were free for both.

const toMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const DAY_MINUTES = 24 * 60;

/**
 * The parts of a booking, each as { lane, offset, length, only? } relative to
 * its start. `lane` is a member id or 'owner'. The whole span is always checked
 * against the booking's own person's hours, blocks and leave (`only` = those
 * kinds — the server checks them over the whole booking); each segment against
 * everything in its person's time; any stretch of the span past its segments is
 * the booking's own person's.
 * @param {{startTime:string, endTime:string, lane:string,
 *          segments?: {lane:string, startTime:string, endTime:string}[]}} booking
 */
export const bookingParts = ({ startTime, endTime, lane, segments }) => {
    const t0 = toMinutes(startTime);
    const t1 = toMinutes(endTime);
    if (!Array.isArray(segments) || !segments.length) return [{ lane, offset: 0, length: t1 - t0 }];
    const parts = [{ lane, offset: 0, length: t1 - t0, only: NON_BOOKING_KINDS }];
    const segs = segments
        .map((g) => ({ lane: g.lane, s: toMinutes(g.startTime), e: toMinutes(g.endTime) }))
        .filter((g) => g.e > g.s)
        .sort((a, b) => a.s - b.s);
    let cursor = t0;
    segs.forEach((g) => {
        parts.push({ lane: g.lane, offset: g.s - t0, length: g.e - g.s });
        if (g.s > cursor) parts.push({ lane, offset: cursor - t0, length: Math.min(g.s, t1) - cursor });
        cursor = Math.max(cursor, g.e);
    });
    if (cursor < t1) parts.push({ lane, offset: cursor - t0, length: t1 - cursor });
    return parts.filter((p) => p.length > 0);
};

/**
 * Where the booking can START so no part touches anything busy in its person's
 * time: inclusive minute ranges, the `openStarts` buildTimeSlots understands.
 * A start S puts a part at [S + offset, S + offset + length), which overlaps a
 * busy [x, y) exactly when x - offset - length < S < y - offset.
 * @param {ReturnType<typeof bookingParts>} parts
 * @param {Record<string, {start:number,end:number,kind?:string}[]>} busyByLane
 */
export const partsOpenStarts = (parts, busyByLane) => {
    const closed = [];
    parts.forEach(({ lane, offset, length, only }) => {
        (busyByLane[lane] || []).forEach((b) => {
            if (only && !only.has(b.kind)) return;
            closed.push([b.start - offset - length + 1, b.end - offset - 1]);
        });
    });
    closed.sort((a, b) => a[0] - b[0]);
    const open = [];
    let from = 0;
    closed.forEach(([a, b]) => {
        if (b < a) return;
        if (a > from) open.push({ start: from, end: Math.min(a - 1, DAY_MINUTES - 1) });
        from = Math.max(from, b + 1);
    });
    if (from <= DAY_MINUTES - 1) open.push({ start: from, end: DAY_MINUTES - 1 });
    return open.filter((r) => r.end >= r.start);
};
