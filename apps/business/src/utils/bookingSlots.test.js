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
