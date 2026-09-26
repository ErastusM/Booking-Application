import { describe, it, expect } from 'vitest';
import { formatDuration } from '@bookplus/ui';

// One formatter for BOTH apps (packages/ui). The client's booking page used to
// print raw minutes — "3600 min" — for a service the owner's editor shows as
// "60 hr". These pin the wording the owner already sees in the service editor,
// so the two can't drift apart again.
describe('formatDuration — the service editor wording, shared with the customer app', () => {
    it('keeps minutes under an hour as minutes', () => {
        expect(formatDuration(5)).toBe('5 min');
        expect(formatDuration(30)).toBe('30 min');
        expect(formatDuration(45)).toBe('45 min');
    });

    it('whole hours read as hours', () => {
        expect(formatDuration(60)).toBe('1 hr');
        expect(formatDuration(120)).toBe('2 hr');
        expect(formatDuration(240)).toBe('4 hr');
    });

    it('hours and minutes together', () => {
        expect(formatDuration(75)).toBe('1 hr 15 min');
        expect(formatDuration(90)).toBe('1 hr 30 min');
        expect(formatDuration(150)).toBe('2 hr 30 min');
    });

    it('a very long service stays in hours, never "3600 min"', () => {
        expect(formatDuration(3600)).toBe('60 hr');
        expect(formatDuration(1470)).toBe('24 hr 30 min');
    });

    it('accepts numeric strings the API may hand back', () => {
        expect(formatDuration('90')).toBe('1 hr 30 min');
    });

    it('renders nothing for a missing or nonsense length', () => {
        expect(formatDuration(0)).toBe('');
        expect(formatDuration(null)).toBe('');
        expect(formatDuration(undefined)).toBe('');
        expect(formatDuration('abc')).toBe('');
        expect(formatDuration(-15)).toBe('');
    });
});
