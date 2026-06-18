import { buildTimeSlots } from './bookingSlots';

// Helpers to keep the cases readable (minutes-from-midnight).
const H = (h, m = 0) => h * 60 + m;
const times = (slots) => slots.map((s) => s.time);

describe('buildTimeSlots', () => {
    test('the spec example: first half booked, rest free, 30-min service → 4:30 + 5:00', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],      // 4:00–6:00 working
            bookedRanges: [{ start: H(4), end: H(4, 30) }], // 4:00–4:30 booked
            duration: 30,
        });
        expect(times(slots)).toEqual(['04:30', '05:00']);
        expect(slots.every((s) => !s.isBooked)).toBe(true);
    });

    test('a fully-free hour shows only the hour start, even for a 30-min service', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [],
            duration: 30,
        });
        expect(times(slots)).toEqual(['04:00', '05:00']); // no 04:30 / 05:30
    });

    test('hourly by default (4:00, 5:00, 6:00, 7:00) for a 60-min service', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(8) }],
            bookedRanges: [],
            duration: 60,
        });
        expect(times(slots)).toEqual(['04:00', '05:00', '06:00', '07:00']);
    });

    test('no half-hour slot when the service is longer than 30 min', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [{ start: H(4), end: H(4, 30) }],
            duration: 45,
        });
        // 4:00 can't fit (overlaps booking) and 4:30 is disallowed for >30 min,
        // so the hour stays as a greyed (booked) pill; 5:00 is free.
        expect(times(slots)).toEqual(['04:00', '05:00']);
        expect(slots[0].isBooked).toBe(true);
        expect(slots[1].isBooked).toBe(false);
    });

    test('first half free, second half booked → still the hour start, not 4:30', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [{ start: H(4, 30), end: H(5) }], // 4:30–5:00 booked
            duration: 30,
        });
        expect(times(slots)).toEqual(['04:00', '05:00']);
        expect(slots[0].isBooked).toBe(false);
    });

    test('a fully-booked hour keeps a greyed pill so the waitlist still works', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [{ start: H(4), end: H(5) }], // whole 4:00–5:00 booked
            duration: 30,
        });
        expect(times(slots)).toEqual(['04:00', '05:00']);
        expect(slots[0].isBooked).toBe(true);  // 4:00 booked (waitlistable)
        expect(slots[1].isBooked).toBe(false); // 5:00 free
    });

    test('past hours are dropped entirely (not shown as booked)', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [],
            duration: 30,
            minStart: H(5), // "now" is 5:00
        });
        expect(times(slots)).toEqual(['05:00']);
    });

    test('honours multiple working blocks (split shift)', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(9), end: H(11) }, { start: H(13), end: H(15) }],
            bookedRanges: [],
            duration: 60,
        });
        expect(times(slots)).toEqual(['09:00', '10:00', '13:00', '14:00']);
    });

    // The same rule must apply to every short service (5/10/15/20/25/30 min):
    // hourly by default, half-hour only when the first half is booked.
    test.each([5, 10, 15, 20, 25, 30])('free hour shows only the hour start for a %i-min service', (duration) => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [],
            duration,
        });
        expect(times(slots)).toEqual(['04:00', '05:00']); // never 04:15 / 04:30 / 05:30
    });

    test.each([5, 10, 15, 20, 25, 30])('first half booked → offers 04:30 for a %i-min service', (duration) => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [{ start: H(4), end: H(4, 30) }], // 4:00–4:30 booked
            duration,
        });
        expect(times(slots)).toEqual(['04:30', '05:00']);
        expect(slots.every((s) => !s.isBooked)).toBe(true);
    });
});
