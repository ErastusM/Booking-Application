// Pure helpers for the customer booking time-slot list.
//
// Rules (see BookAppointment / the booking flow):
//   1. Slots are hourly by default (08:00, 09:00, …).
//   2. A fully-free hour shows ONLY the hour start — even for a short service.
//      This keeps the list clean: a free hour never explodes into a wall of pills.
//   3. Once an hour is partially booked, the *remaining* free time inside that hour
//      is broken into slots the size of the selected service duration, anchored at
//      the hour start (08:00, 08:00+d, 08:00+2d, …). We never invent arbitrary
//      intervals — every start is a whole multiple of the duration from the hour
//      start, so a 15-min service can only ever start at :00/:15/:30/:45, a 10-min
//      service at :00/:10/:20/…, etc. This lets the day fill up efficiently without
//      overlapping bookings.
//
// A genuinely-bookable hour that is fully taken keeps a single greyed pill so the
// waitlist still works; past times are dropped entirely.
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
 * @param {number}   args.duration  service length in minutes (also the breakdown grid)
 * @param {number}   [args.minStart] earliest allowed start (e.g. "now" for today); -1 = none
 * @returns {{time:string, isBooked:boolean}[]}
 */
export const buildTimeSlots = ({ blocks, bookedRanges = [], duration, minStart = -1 }) => {
    const slots = [];
    const step = duration > 0 ? duration : 30; // guard against a 0/undefined duration

    blocks.forEach((block) => {
        // A start is usable when the whole service fits in the block and isn't in the past.
        const usable = (start) => start + duration <= block.end && start >= minStart;

        // Walk the block hour by hour.
        for (let hourStart = block.start; hourStart < block.end; hourStart += 60) {
            const hourEnd = Math.min(hourStart + 60, block.end);
            const hourOccupied = overlapsRange(bookedRanges, hourStart, hourEnd);

            // (Rule 1 & 2) Nothing booked in this hour → keep it clean: just the hour
            // start, provided the service still fits and the time isn't in the past.
            if (!hourOccupied) {
                if (usable(hourStart)) {
                    slots.push({ time: fmtMinutes(hourStart), isBooked: false });
                }
                continue;
            }

            // (Rule 3) The hour is partially (or fully) booked → offer every free,
            // duration-sized start within it, anchored at the hour start.
            let offered = false;
            for (let start = hourStart; start < hourStart + 60 && start < block.end; start += step) {
                if (usable(start) && !overlapsRange(bookedRanges, start, start + duration)) {
                    slots.push({ time: fmtMinutes(start), isBooked: false });
                    offered = true;
                }
            }

            // Nothing bookable but the hour genuinely fits a service → greyed pill so
            // the waitlist still works. Never show a pill for a past hour.
            if (!offered && usable(hourStart)) {
                slots.push({ time: fmtMinutes(hourStart), isBooked: true });
            }
        }
    });

    return slots;
};
