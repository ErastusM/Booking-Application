import { describe, it, expect } from 'vitest';
import { fmtHM, fmtHMRange, fmtClock } from './time';

// Minutes-from-midnight so the cases read like a clock.
const H = (h, m = 0) => h * 60 + m;

describe('fmtHM — 24-hour labels', () => {
    it('prints HH:mm with a leading zero, never AM/PM', () => {
        expect(fmtHM(H(9, 30))).toBe('09:30');
        expect(fmtHM(H(14))).toBe('14:00');
        expect(fmtHM(H(0))).toBe('00:00');
        expect(fmtHM(H(12))).toBe('12:00');
        expect(fmtHM(H(23, 45))).toBe('23:45');
    });

    it('wraps at midnight, so a booking ending at 24:00 reads 00:00', () => {
        expect(fmtHM(H(24))).toBe('00:00');
        expect(fmtHM(H(25, 15))).toBe('01:15');
    });

    it('never throws on junk — falls back to 00:00', () => {
        expect(fmtHM(undefined)).toBe('00:00');
        expect(fmtHM('abc')).toBe('00:00');
    });
});

describe('fmtHMRange', () => {
    it('joins start and end with an en dash', () => {
        expect(fmtHMRange(H(14), H(15))).toBe('14:00 – 15:00');
        expect(fmtHMRange(H(23), H(24))).toBe('23:00 – 00:00');
    });
});

describe('fmtClock — a timestamp as local HH:mm', () => {
    it('reads the local wall clock in 24-hour form', () => {
        expect(fmtClock(new Date(2026, 8, 25, 14, 5))).toBe('14:05');
        expect(fmtClock(new Date(2026, 8, 25, 9, 0))).toBe('09:00');
        expect(fmtClock(new Date(2026, 8, 25, 0, 30))).toBe('00:30');
    });

    it('accepts an ISO string or epoch ms', () => {
        const d = new Date(2026, 8, 25, 16, 45);
        expect(fmtClock(d.toISOString())).toBe('16:45');
        expect(fmtClock(d.getTime())).toBe('16:45');
    });

    it('returns empty text for a missing or invalid timestamp', () => {
        expect(fmtClock(null)).toBe('');
        expect(fmtClock('')).toBe('');
        expect(fmtClock('not a date')).toBe('');
    });
});
