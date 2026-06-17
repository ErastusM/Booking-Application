// Pure helpers for the customer booking time-slot list.
//
// Rules (see BookAppointment):
//   1. Slots are hourly by default (08:00, 09:00, …).
//   2. A fully-free hour shows ONLY the hour start — even for a 30-min service.
//   3. A half-hour start (e.g. 08:30) is offered only when the first half of the
//      hour is booked, the remaining half is free, and the service is ≤ 30 min.
// Anything booked with no bookable start keeps a greyed pill so the waitlist
// still works; past times are dropped entirely.
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
 * @param {number}   args.duration  service length in minutes
 * @param {number}   [args.minStart] earliest allowed start (e.g. "now" for today); -1 = none
 * @returns {{time:string, isBooked:boolean}[]}
 */
export const buildTimeSlots = ({ blocks, bookedRanges = [], duration, minStart = -1 }) => {
    const slots = [];

    blocks.forEach((block) => {
        // Walk the block hour by hour. Each hour yields at most one start time.
        for (let hourStart = block.start; hourStart < block.end; hourStart += 60) {
            const hourFits = hourStart + duration <= block.end;
            const hourPast = hourStart < minStart;

            // (Rule 1 & 2) Hour start is free → offer just the hour start.
            if (hourFits && !hourPast && !overlapsRange(bookedRanges, hourStart, hourStart + duration)) {
                slots.push({ time: fmtMinutes(hourStart), isBooked: false });
                continue;
            }

            // (Rule 3) Otherwise offer the half-hour, but only when the first half
            // is booked, the remaining half is free, and the service is ≤ 30 min.
            const halfStart = hourStart + 30;
            const halfFits = halfStart + duration <= block.end;
            const halfPast = halfStart < minStart;
            if (
                duration <= 30 &&
                halfFits &&
                !halfPast &&
                overlapsRange(bookedRanges, hourStart, halfStart) &&
                !overlapsRange(bookedRanges, halfStart, halfStart + duration)
            ) {
                slots.push({ time: fmtMinutes(halfStart), isBooked: false });
                continue;
            }

            // No bookable start this hour. Keep a greyed pill (for the waitlist) when
            // the hour genuinely fits but is booked; never show a pill for past times.
            if (hourFits && !hourPast) {
                slots.push({ time: fmtMinutes(hourStart), isBooked: true });
            }
        }
    });

    return slots;
};
