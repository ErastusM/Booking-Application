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

    test('a partly-booked hour breaks down on the service grid — a 45-min service fills 04:45', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [{ start: H(4), end: H(4, 30) }],
            duration: 45,
        });
        // 4:00 overlaps the booking; the next 45-min grid start (4:45) is free and fits.
        expect(times(slots)).toEqual(['04:45', '05:00']);
        expect(slots.every((s) => !s.isBooked)).toBe(true);
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

    // ── The breakdown only kicks in once an hour is partially occupied ──
    // A free hour always shows just the hour start, whatever the service length.
    test.each([5, 10, 15, 20, 25, 30])('free hour shows only the hour start for a %i-min service', (duration) => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [],
            duration,
        });
        expect(times(slots)).toEqual(['04:00', '05:00']); // never 04:15 / 04:30 / 05:30
    });

    // Once 4:00–4:30 is booked, the rest of the hour fills on the service's own grid
    // (anchored at the hour start) so every free minute can be used.
    test.each([
        [5,  ['04:30', '04:35', '04:40', '04:45', '04:50', '04:55', '05:00']],
        [10, ['04:30', '04:40', '04:50', '05:00']],
        [15, ['04:30', '04:45', '05:00']],
        [20, ['04:40', '05:00']],
        [25, ['04:50', '05:00']],
        [30, ['04:30', '05:00']],
    ])('first half booked → %i-min service fills the rest of the hour on its grid', (duration, expected) => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(6) }],
            bookedRanges: [{ start: H(4), end: H(4, 30) }], // 4:00–4:30 booked
            duration,
        });
        expect(times(slots)).toEqual(expected);
        expect(slots.every((s) => !s.isBooked)).toBe(true);
    });

    // ── The user's worked examples ──
    test('book 4:00–4:15, then a 15-min service may start at 4:15, 4:30, 4:45', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(5) }],
            bookedRanges: [{ start: H(4), end: H(4, 15) }],
            duration: 15,
        });
        expect(times(slots)).toEqual(['04:15', '04:30', '04:45']);
    });

    test('book 4:00–4:30, then a 30-min service may start at 4:30', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(5) }],
            bookedRanges: [{ start: H(4), end: H(4, 30) }],
            duration: 30,
        });
        expect(times(slots)).toEqual(['04:30']);
    });

    // Never invent arbitrary intervals: a 20-min booking does not let a 15-min
    // service start at 4:20 — starts stay on the :00/:15/:30/:45 grid.
    test('a 20-min booking does not create an off-grid 4:20 start for a 15-min service', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(4), end: H(5) }],
            bookedRanges: [{ start: H(4), end: H(4, 20) }], // 4:00–4:20 booked
            duration: 15,
        });
        expect(times(slots)).toEqual(['04:30', '04:45']); // not 04:20
    });
});
