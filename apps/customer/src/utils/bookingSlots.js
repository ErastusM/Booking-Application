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
