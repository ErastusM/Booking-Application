/**
 * Most handlers answer a failure with res.status(500) themselves instead of
 * next(err), so the error handler's alert never fired for them. Every 5xx
 * answer is now reported once (method and path, never the query string); a 4xx
 * is not.
 */
const request = require('supertest');

jest.mock('../../utils/alerts', () => ({ sendAlert: jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Service = require('../../models/Service');
const { sendAlert } = require('../../utils/alerts');

beforeAll(async () => { await testDb.connect(); });
afterAll(async () => { await testDb.closeDatabase(); });
afterEach(() => { jest.restoreAllMocks(); sendAlert.mockClear(); });

const settle = () => new Promise((r) => setImmediate(r));

describe('server error alerts', () => {
    it('a handler that answers 500 itself is reported once, without the query string', async () => {
        jest.spyOn(Service, 'find').mockImplementation(() => { throw new Error('database went away'); });
        const res = await request(app).get('/api/services?token=secret-in-query');
        expect(res.status).toBe(500);
        await settle();
        expect(sendAlert).toHaveBeenCalledTimes(1);
        expect(sendAlert.mock.calls[0][0]).toBe('500 on GET /api/services');
        expect(JSON.stringify(sendAlert.mock.calls)).not.toContain('secret-in-query');
    });

    it('a 4xx is not reported', async () => {
        expect((await request(app).get('/api/no-such-route')).status).toBe(404);
        expect((await request(app).get('/api/users')).status).toBe(401);
        await settle();
        expect(sendAlert).not.toHaveBeenCalled();
    });
});
