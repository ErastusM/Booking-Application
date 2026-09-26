import { describe, it, expect } from 'vitest';
import { buildTimeSlots } from './bookingSlots';

// Minutes-from-midnight helpers so the cases read like a clock.
const H = (h, m = 0) => h * 60 + m;
const free = (slots) => slots.filter((s) => !s.isBooked).map((s) => s.time);
const times = (slots) => slots.map((s) => s.time);

describe('buildTimeSlots — full-hour anchoring', () => {
    it('a completely free hour offers only its :00, whatever the duration', () => {
        // Rule 2: 5:00–6:00 free → show 5:00, not 5:30.
        const blocks = [{ start: H(5), end: H(6) }];
        expect(free(buildTimeSlots({ blocks, duration: 30 }))).toEqual(['05:00']);
        expect(free(buildTimeSlots({ blocks, duration: 15 }))).toEqual(['05:00']);
    });

    it('a free day stays hourly, plus the shift start — no scattered :30s', () => {
        // The reported bug: an 08:30 shift with a 30-min service listed every :30.
        const slots = free(buildTimeSlots({ blocks: [{ start: H(8, 30), end: H(18) }], duration: 30 }));
        expect(slots).toContain('08:30'); // earliest available (shift start, ends 09:00)
        expect(slots).toContain('09:00');
        expect(slots).toContain('10:00');
        expect(slots).not.toContain('09:30'); // no mid-hour scatter
        expect(slots).not.toContain('10:30');
        // Exactly one non-hour start (the 08:30 shift start).
        expect(slots.filter((t) => !t.endsWith(':00'))).toEqual(['08:30']);
    });
});

describe('buildTimeSlots — leftover after a booking', () => {
    // 4:00–4:30 booked, 4:30–5:00 free, 5:00–6:00 free.
    const blocks = [{ start: H(4), end: H(6) }];
    const booked = [{ start: H(4), end: H(4, 30) }];

    it('30-min service uses the leftover: 4:30 and 5:00', () => {
        expect(free(buildTimeSlots({ blocks, bookedRanges: booked, duration: 30 })))
            .toEqual(['04:30', '05:00']);
    });

    it('1-hour service will not take the leftover: 5:00 only, never 4:30', () => {
        const slots = free(buildTimeSlots({ blocks, bookedRanges: booked, duration: 60 }));
        expect(slots).toContain('05:00');
        expect(slots).not.toContain('04:30'); // 4:30 would end 5:30 — off the hour
    });

    it('1h30 service can take the leftover: 4:30 (4:30–6:00)', () => {
        const slots = free(buildTimeSlots({ blocks, bookedRanges: booked, duration: 90 }));
        expect(slots).toContain('04:30');
    });
});

describe('buildTimeSlots — a booking refines its own hour (any duration)', () => {
    it('15-min service: a 09:00–09:15 booking exposes 09:15, then hourly', () => {
        const slots = free(buildTimeSlots({
            blocks: [{ start: H(9), end: H(17) }],
            bookedRanges: [{ start: H(9), end: H(9, 15) }],
            duration: 15,
        }));
        expect(slots.slice(0, 3)).toEqual(['09:15', '10:00', '11:00']);
        expect(slots).not.toContain('09:30'); // no invented mid-hour offsets
        expect(slots).not.toContain('09:45');
    });

    it('20-min booking, 15-min service: start comes from the real boundary (09:20)', () => {
        const slots = free(buildTimeSlots({
            blocks: [{ start: H(9), end: H(17) }],
            bookedRanges: [{ start: H(9), end: H(9, 20) }],
            duration: 15,
        }));
        expect(slots.slice(0, 2)).toEqual(['09:20', '10:00']);
    });

    it('a leftover too small for the service is not offered', () => {
        // 09:00–09:45 booked leaves 15 min; a 30-min service cannot use it.
        const slots = free(buildTimeSlots({
            blocks: [{ start: H(9), end: H(17) }],
            bookedRanges: [{ start: H(9), end: H(9, 45) }],
            duration: 30,
        }));
        expect(slots).not.toContain('09:45');
        expect(slots[0]).toBe('10:00');
    });
});

describe('buildTimeSlots — waitlist pill', () => {
    it('a genuinely-bookable hour that is fully taken keeps one greyed pill', () => {
        const slots = buildTimeSlots({
            blocks: [{ start: H(5), end: H(6) }],
            bookedRanges: [{ start: H(5), end: H(6) }],
            duration: 30,
        });
        expect(times(slots)).toEqual(['05:00']);
        expect(slots[0].isBooked).toBe(true);
    });
});

// ── Which hours the times come from (owner's report: the times in New
// Appointment didn't match the hours they had set) ──────────────────────────
import { periodsToBlocks, dayNameOf, scheduleBlocksFor, hoursNote } from './bookingSlots';

const WEEK = {
    monday: { enabled: true, slots: [{ start: '08:30', end: '18:00' }] },
    saturday: { enabled: true, slots: [{ start: '09:00', end: '14:00' }] },
    friday: { enabled: true, slots: [{ start: '08:30', end: '12:00' }, { start: '14:00', end: '18:00' }] },
    sunday: { enabled: false, slots: [{ start: '09:00', end: '17:00' }] },
};

describe('the day\'s hours', () => {
    it('reads the date\'s own weekday (Sunday = 0), whatever the time zone', () => {
        expect(dayNameOf('2026-09-26')).toBe('saturday');
        expect(dayNameOf('2026-09-27')).toBe('sunday');
        expect(dayNameOf('2026-09-28')).toBe('monday');
    });

    it('Saturday is Saturday\'s hours, Sunday switched off is closed, no schedule is unknown', () => {
        expect(scheduleBlocksFor(WEEK, '2026-09-26')).toEqual([{ start: 540, end: 840 }]);
        expect(scheduleBlocksFor(WEEK, '2026-09-27')).toEqual([]);
        expect(scheduleBlocksFor(null, '2026-09-26')).toBeNull();
    });

    it('keeps both periods of a split day, sorted, and drops inverted or half-set ones', () => {
        expect(scheduleBlocksFor(WEEK, '2026-10-02')).toEqual([{ start: 510, end: 720 }, { start: 840, end: 1080 }]);
        expect(periodsToBlocks([{ start: '14:00', end: '09:00' }, { start: '10:00' }, { start: '00:15', end: '00:45' }]))
            .toEqual([{ start: 15, end: 45 }]);
    });

    it('the report: Saturday 09:00–14:00 at 12:30, 45-min service → only 13:00, and the note says why', () => {
        const blocks = scheduleBlocksFor(WEEK, '2026-09-26');
        const minStart = 12 * 60 + 30;
        const slots = buildTimeSlots({ blocks, duration: 45, minStart });
        expect(slots.map((s) => s.time)).toEqual(['13:00']);
        const note = hoursNote({ blocks, duration: 45, slots, minStart, day: 'saturday' });
        expect(note).toContain('Working hours on Saturday: 09:00–14:00.');
        expect(note).toContain('the last start leaves room for the 45 min service');
        expect(note).toContain('Earlier times today have passed.');
    });

    it('explains a :30 opening that a longer service can\'t start at (hourly by design)', () => {
        const blocks = scheduleBlocksFor(WEEK, '2026-09-28');
        const slots = buildTimeSlots({ blocks, duration: 45 });
        expect(slots[0].time).toBe('09:00');
        expect(hoursNote({ blocks, duration: 45, slots, day: 'monday' }))
            .toContain('an opening at 08:30 is only offered when the service ends by 09:00');
        // A service that ends by 09:00 gets the opening itself — and no such note.
        const short = buildTimeSlots({ blocks, duration: 20 });
        expect(short[0].time).toBe('08:30');
        expect(hoursNote({ blocks, duration: 20, slots: short, day: 'monday' })).not.toContain('only offered');
    });

    it('names whose hours and where they come from', () => {
        const blocks = [{ start: 510, end: 1020 }];
        expect(hoursNote({ blocks, duration: 60, whose: 'Erastus’s', day: 'monday', source: 'weekly' }))
            .toMatch(/^Erastus’s hours on Monday: 08:30–17:00\. /);
        expect(hoursNote({ blocks, duration: 60, whose: 'Your', day: 'monday', source: 'business' }))
            .toMatch(/^Your hours on Monday: 08:30–17:00 \(the business’s hours\)\. /);
        expect(hoursNote({ blocks, duration: 90, slots: buildTimeSlots({ blocks, duration: 90 }), whose: 'John’s', day: 'monday', source: 'shift' }))
            .toContain('(shift). Times start on the hour, and the last start leaves room for the 1h 30min service.');
    });
});
