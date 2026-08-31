// Pure helpers for the booking time-slot list.
//
// Rule: full 1-hour blocks are the anchor. By default only hourly starts are
// offered (:00), regardless of the service length — a completely free 5:00–6:00
// shows 5:00, not 5:30. A partial-hour start appears only when a booking (or the
// shift start) leaves leftover minutes AND the chosen service ends exactly on the
// next hour, so it consumes that leftover and re-aligns to the grid:
//   4:00–4:30 booked, 4:30–5:00 free, 5:00–6:00 free
//     30-min service → 4:30 (ends 5:00) and 5:00
//     1-hour service → 5:00 only (4:30 would end 5:30, off the hour)
//     1h30 service   → 4:30 (4:30–6:00) and 5:00
// A partial start never shifts a whole-hour booking off the hour. Starts must fit
// continuously inside the working block, not be in the past, and not overlap a
// booking. A genuinely-bookable hour that is fully taken keeps a single greyed
// pill so the waitlist still works.
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
 * @returns {{time:string, isBooked:boolean, isBlocked:boolean}[]}
 */
export const buildTimeSlots = ({ blocks, bookedRanges = [], duration, minStart = -1 }) => {
    const slots = [];
    const dur = duration || 60;

    blocks.forEach((block) => {
        // A start is usable when it's inside the block, the whole service fits,
        // and it isn't in the past.
        const usable = (start) =>
            start >= block.start && start + dur <= block.end && start >= minStart;

        // Partial-hour starts: the shift start and every busy-range end, but only
        // when the service starting there ends exactly on an hour. That is what
        // keeps a partial from shifting a whole-hour booking off the hour: a 1-hour
        // service ending mid-hour is rejected; a 30-min or 1h30 that lands on the
        // hour is kept.
        const partialStarts = new Set();
        const consider = (t) => {
            if (t % 60 !== 0 && (t + dur) % 60 === 0) partialStarts.add(t);
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
                const hits = bookedRanges.filter((b) => start < b.end && end > b.start);
                if (hits.length) {
                    occupied = true;
                    if (hits.some((h) => !NON_BOOKING_KINDS.has(h.kind))) hitRealBooking = true;
                    continue;
                }
                slots.push({ time: fmtMinutes(start), isBooked: false, isBlocked: false });
                anyFree = true;
            }
            // Fully-busy but genuinely-bookable hour → one greyed pill. If nothing
            // but blocked time caused it, mark it so the UI can say "Unavailable"
            // and skip the waitlist. Never show a pill for a past/unusable hour.
            if (!anyFree && occupied && usable(hourStart)) {
                slots.push({ time: fmtMinutes(hourStart), isBooked: true, isBlocked: !hitRealBooking });
            }
        }
    });

    return slots;
};
