/**
 * The admin suggestion email stamps when it was sent. Bookplus shows every time
 * of day in 24-hour form, in Namibia time (Africa/Windhoek, UTC+2) — not the
 * server's UTC and not an en-US "3:45 PM".
 */
jest.mock('../../utils/emailService', () => ({ sendRaw: jest.fn().mockResolvedValue(true) }));

const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { sendRaw } = require('../../utils/emailService');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => { jest.useRealTimers(); sendRaw.mockClear(); });

// Freeze only the clock the footer reads; leave every timer the app, supertest
// and the in-memory Mongo rely on running for real.
const freezeDate = (iso) => jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate',
        'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
});

const footerOf = () => {
    const html = sendRaw.mock.calls[0][0].html;
    return (html.match(/Submitted via Bookplus &bull; ([^<]+)</) || [])[1];
};

describe('POST /api/suggestions — sent-at footer', () => {
    it('reads 24-hour Namibia time', async () => {
        freezeDate('2026-09-25T13:45:00Z'); // 15:45 in Windhoek
        const res = await request(app)
            .post('/api/suggestions')
            .send({ message: 'Please add a dark calendar theme', category: 'Feature Request' });

        expect(res.status).toBe(200);
        expect(sendRaw).toHaveBeenCalledTimes(1);
        expect(footerOf()).toBe('25 September 2026, 15:45');
    });

    it('rolls over to the next Namibia day after 22:00 UTC, with no AM/PM', async () => {
        freezeDate('2026-09-25T22:05:00Z'); // 00:05 on the 26th in Windhoek
        await request(app)
            .post('/api/suggestions')
            .send({ message: 'Late-night idea for the waitlist' });

        const footer = footerOf();
        expect(footer).toBe('26 September 2026, 00:05');
        expect(footer).not.toMatch(/AM|PM/i);
    });
});
