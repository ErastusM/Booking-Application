import { describe, expect, it } from 'vitest';
import { inviteStatus, relativeSent, resendCooldownLeft } from './inviteStatus';

const NOW = new Date('2026-09-26T12:00:00Z').getTime();
const ago = (ms) => new Date(NOW - ms).toISOString();
const ahead = (ms) => new Date(NOW + ms).toISOString();

describe('inviteStatus', () => {
    it('active while any time is left', () => {
        const s = inviteStatus({ sentAt: ago(5 * 60000), expiresAt: ahead(86400000) }, NOW);
        expect(s.kind).toBe('active');
        expect(s.sent).toBe('5 min ago');
        expect(s.until).toBeTruthy();
    });
    it('expired once the 7 days are up', () => {
        expect(inviteStatus({ sentAt: ago(8 * 86400000), expiresAt: ago(86400000) }, NOW).kind).toBe('expired');
    });
    it('none without timing (no invite yet)', () => {
        expect(inviteStatus({}, NOW).kind).toBe('none');
        expect(inviteStatus({ sentAt: null, expiresAt: null }, NOW).kind).toBe('none');
    });
});

describe('relativeSent', () => {
    it.each([
        [10 * 1000, 'just now'], [3 * 60000, '3 min ago'], [2 * 3600000, '2 h ago'],
        [26 * 3600000, 'yesterday'], [3 * 86400000, '3 days ago'],
    ])('%i ms ago → %s', (ms, out) => expect(relativeSent(ago(ms), NOW)).toBe(out));
});

describe('resendCooldownLeft', () => {
    it('counts down 60s after a send', () => {
        expect(resendCooldownLeft(ago(0), NOW)).toBe(60);
        expect(resendCooldownLeft(ago(45 * 1000), NOW)).toBe(15);
        expect(resendCooldownLeft(ago(60 * 1000), NOW)).toBe(0);
        expect(resendCooldownLeft(null, NOW)).toBe(0);
    });
});
