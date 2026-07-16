/**
 * Appointment copy rules. The service name is a MODIFIER, never the noun —
 * "Your “Seniors” appointment was moved", never "Your Seniors was moved".
 * These lock the phrasing that in-app, push and email all share.
 */
const { quoted, apptPhrase, ApptPhrase, theirApptPhrase, servicePhrase } = require('../../utils/apptCopy');

describe('appointment copy helpers', () => {
    test('names the service as a modifier of "appointment", in quotes', () => {
        expect(ApptPhrase('Kids')).toBe('Your “Kids” appointment');
        expect(apptPhrase('Seniors')).toBe('your “Seniors” appointment');
        expect(theirApptPhrase('Kids')).toBe('their “Kids” appointment');
        expect(servicePhrase('Kids')).toBe('the “Kids” service');
        expect(quoted('Kids')).toBe('“Kids”');
    });

    test('never renders the bare service name as the noun', () => {
        // The exact bug this module exists to prevent.
        const sentence = `${ApptPhrase('Seniors')} has been moved to Thu, Jul 16 at 16:00.`;
        expect(sentence).toBe('Your “Seniors” appointment has been moved to Thu, Jul 16 at 16:00.');
        expect(sentence).not.toMatch(/Your Seniors was moved/);
        expect(sentence).toMatch(/appointment/);
    });

    test('degrades gracefully when the service is unknown (deleted service)', () => {
        for (const empty of [undefined, null, '']) {
            expect(ApptPhrase(empty)).toBe('Your appointment');
            expect(apptPhrase(empty)).toBe('your appointment');
            expect(theirApptPhrase(empty)).toBe('their appointment');
            expect(servicePhrase(empty)).toBe('the service');
        }
        // No stray quotes / "undefined" leaking into user-facing copy.
        expect(ApptPhrase(undefined)).not.toMatch(/undefined|“”/);
    });

    test('multi-word and punctuated service names stay readable', () => {
        expect(ApptPhrase('Kids Cut & Style')).toBe('Your “Kids Cut & Style” appointment');
        expect(ApptPhrase('  Taper Fade  ')).toBe('Your “Taper Fade” appointment'); // trimmed
    });

    test('the status sentences share one structure', () => {
        const s = (verb) => `${ApptPhrase('Kids')} has been ${verb}.`;
        expect(s('confirmed')).toBe('Your “Kids” appointment has been confirmed.');
        expect(s('cancelled')).toBe('Your “Kids” appointment has been cancelled.');
        expect(s('completed')).toBe('Your “Kids” appointment has been completed.');
    });
});
