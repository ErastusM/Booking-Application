// Pure helpers for the booking time-slot list.
//
// Rule: appointments start ON THE HOUR — a 1-hour grid (08:00, 09:00, 10:00 …)
// regardless of how long the selected service is. An hour is offered as a start
// only when the whole service still fits inside the working block, it isn't in
// the past, and it doesn't overlap an existing booking. A genuinely-bookable
// hour that is fully taken keeps a single greyed pill so the waitlist still works.
// (The service duration still sets how long the booking blocks — it just no
// longer subdivides the grid.)
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
 * @param {number}   args.duration  service length in minutes (also the slot grid)
 * @param {number}   [args.minStart] earliest allowed start (e.g. "now" for today); -1 = none
 * @returns {{time:string, isBooked:boolean, isBlocked:boolean}[]}
 */
export const buildTimeSlots = ({ blocks, bookedRanges = [], duration, minStart = -1 }) => {
    const slots = [];
    const step = 60; // appointments start on the hour — a fixed 1-hour grid

    blocks.forEach((block) => {
        // A start is usable when it's inside the block, the whole service fits,
        // and it isn't in the past.
        const usable = (start) =>
            start >= block.start && start + duration <= block.end && start >= minStart;

        // Walk each clock hour and offer every duration-sized start anchored at
        // the hour (:00, :00+d, :00+2d, …). Starts that overlap an existing
        // booking or fall in the past are dropped.
        const firstHour = Math.floor(block.start / 60) * 60;
        for (let hourStart = firstHour; hourStart < block.end; hourStart += 60) {
            let anyFree = false;
            let occupied = false;
            let hitRealBooking = false;
            for (let start = hourStart; start < hourStart + 60 && start < block.end; start += step) {
                if (!usable(start)) continue;
                const end = start + duration;
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
