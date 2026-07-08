// Pure helpers for the booking time-slot list.
//
// Rule: the slots follow the SELECTED SERVICE DURATION. Each working hour is
// divided into duration-sized starts, anchored at the hour:
//   • 60-min service → :00                     (08:00, 09:00, …)
//   • 30-min service → :00, :30                (08:00, 08:30, 09:00, …)
//   • 15-min service → :00, :15, :30, :45
//   • 10-min service → :00, :10, :20, :30, :40, :50
//   •  5-min service → :00, :05, :10, …
// A start is offered only when the whole service fits inside the working
// block, it isn't in the past, and it doesn't overlap an existing booking —
// so the day fills up efficiently with no overlaps. A genuinely-bookable hour
// that is fully taken keeps a single greyed pill so the waitlist still works.
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
    const step = duration > 0 ? duration : 30; // guard against a 0/undefined duration

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
