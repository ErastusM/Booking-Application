// Pure helpers for the booking time-slot list.
//
// Rule: start times are spaced by the SERVICE LENGTH, anchored at each hour —
// a 15-min service is bookable at :00/:15/:30/:45, a 30-min at :00/:30, a 60-min
// hourly — for EVERY booking surface, including the provider's manual walk-in /
// book-a-client flow and reschedule (matches the customer app). A start is
// offered only when the whole service fits inside the working block, it isn't in
// the past, and it doesn't overlap an existing booking, so the day fills at the
// service's own size (booking one 15-min slot no longer swallows the whole hour).
// A genuinely-bookable hour that is fully taken keeps a single greyed pill so the
// waitlist still works.
//
// All times are in minutes-from-midnight.

export const overlapsRange = (ranges, start, end) =>
    ranges.some((b) => start < b.end && end > b.start);

export const fmtMinutes = (mins) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * @param {Object}   args
 * @param {{start:number,end:number}[]} args.blocks       working blocks for the day
 * @param {{start:number,end:number}[]} args.bookedRanges  already-booked ranges
 * @param {number}   args.duration  service length in minutes (also the slot grid)
 * @param {number}   [args.minStart] earliest allowed start (e.g. "now" for today); -1 = none
 * @returns {{time:string, isBooked:boolean}[]}
 */
export const buildTimeSlots = ({ blocks, bookedRanges = [], duration, minStart = -1 }) => {
    const slots = [];
    // Start grid = the service length, anchored at each hour (:00, :00+d, :00+2d…).
    // A 15-min service is bookable at :00/:15/:30/:45, a 30-min at :00/:30, a
    // 60-min hourly — so short services fill the day at their own size instead of
    // one booking swallowing the whole hour. Floored so a missing/zero duration
    // can't spin the loop.
    const step = Math.max(5, duration || 60);

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
            for (let start = hourStart; start < hourStart + 60 && start < block.end; start += step) {
                if (!usable(start)) continue;
                if (overlapsRange(bookedRanges, start, start + duration)) { occupied = true; continue; }
                slots.push({ time: fmtMinutes(start), isBooked: false });
                anyFree = true;
            }
            // Fully-taken but genuinely-bookable hour → one greyed pill so the
            // waitlist still works. Never show a pill for a past/unusable hour.
            if (!anyFree && occupied && usable(hourStart)) {
                slots.push({ time: fmtMinutes(hourStart), isBooked: true });
            }
        }
    });

    return slots;
};
