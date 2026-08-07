/**
 * Pure unit tests for the shared appointment-instant helper. No DB — these run
 * anywhere. They pin the Africa/Windhoek (UTC+2) semantics that the past-slot,
 * cancellation-window, and reminder checks all depend on.
 */
const { realStartMs, NAMIBIA_OFFSET_MIN } = require('../../utils/appointmentTime');

describe('realStartMs', () => {
    it('interprets startTime as Windhoek (UTC+2) local wall-clock', () => {
        // 10:00 local on 2026-08-12 is 08:00 UTC.
        const ms = realStartMs('2026-08-12', '10:00');
        expect(new Date(ms).toISOString()).toBe('2026-08-12T08:00:00.000Z');
    });

    it('is independent of the appointmentDate object time-of-day (uses the UTC calendar day)', () => {
        const fromString = realStartMs('2026-08-12', '09:30');
        const fromDate = realStartMs(new Date('2026-08-12T00:00:00.000Z'), '09:30');
        expect(fromDate).toBe(fromString);
        expect(new Date(fromString).toISOString()).toBe('2026-08-12T07:30:00.000Z');
    });

    it('offset is exactly 2 hours behind the naive UTC wall-clock', () => {
        const naiveUtc = Date.UTC(2026, 7, 12, 15, 0); // 15:00 as if UTC
        expect(realStartMs('2026-08-12', '15:00')).toBe(naiveUtc - NAMIBIA_OFFSET_MIN * 60 * 1000);
    });

    it('returns NaN for an invalid date so callers can fall back to other validation', () => {
        expect(Number.isNaN(realStartMs('not-a-date', '10:00'))).toBe(true);
    });

    it('treats a missing startTime as midnight', () => {
        expect(new Date(realStartMs('2026-08-12', undefined)).toISOString()).toBe('2026-08-11T22:00:00.000Z');
    });
});
