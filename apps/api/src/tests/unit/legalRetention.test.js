/**
 * The Privacy Policy quotes the retention periods; constants/retention.js is the
 * source the retention job enforces. This fails if one changes without the other.
 */
const fs = require('fs');
const path = require('path');
const { RETENTION } = require('../../constants/retention');

describe('Privacy Policy retention periods', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../../../packages/config/legal/privacy.mjs'), 'utf8');
    const field = (name) => {
        const m = src.match(new RegExp(`${name}:\\s*'([^']+)'`));
        return m ? m[1] : null;
    };

    it('match constants/retention.js', () => {
        expect(field('analyticsEvents')).toBe(`${RETENTION.ANALYTICS_EVENTS_DAYS} days`);
        expect(field('crashReports')).toBe(`${RETENTION.CLIENT_ERROR_LOG_DAYS} days in Sentry`);
        expect(RETENTION.NOTIFICATIONS_DAYS).toBe(365);
        expect(field('notifications')).toBe('12 months');
        expect(field('sessions')).toBe(`${RETENTION.SESSION_DAYS} days without use`);
        expect(field('staffInvites')).toBe(`${RETENTION.EXPIRED_INVITE_GRACE_DAYS} days after they expire`);
        expect(field('guestContact')).toMatch(new RegExp(`^${RETENTION.GUEST_CONTACT_MONTHS} months after`));
        expect(field('bookingRejections')).toBe(`${RETENTION.BOOKING_REJECTION_DAYS} days`);
        expect(field('unfinishedGoogleSignUps')).toBe(`${RETENTION.PENDING_SIGNUP_MINUTES} minutes`);
    });

    it('states no unverified-account deletion and no fixed accounting period (lawyer to confirm)', () => {
        expect(src).not.toMatch(/unverified/i);
        expect(src).not.toMatch(/5 years|five years/i);
        expect(src).toMatch(/Kept for as long as the law requires/);
    });
});
