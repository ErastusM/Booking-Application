/**
 * Owner-side signal for turned-away bookings (phantom-slot post-mortem
 * follow-up): refused CUSTOMER bookings are recorded; a burst raises ONE bell
 * notification naming the dominant reason; the Overview endpoint reports the
 * 7-day count. Provider walk-ins (overrides) never count.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const Availability = require('../../models/Availability');
const BookingRejection = require('../../models/BookingRejection');
const Notification = require('../../models/Notification');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => {
    const s = {};
    DAYS.forEach((d) => { s[d] = { enabled: true, slots: [{ start, end }] }; });
    return s;
};
const DATE = '2026-09-16';

// Recording is fire-and-forget (it must never slow the rejection response), so
// tests poll for its effects instead of assuming they landed synchronously.
const waitFor = async (fn, timeoutMs = 3000) => {
    const start = Date.now();
    for (;;) {
        if (await fn()) return;
        if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
        await new Promise((r) => setTimeout(r, 25));
    }
};

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const svc = await makeService(provider._id, { duration: 30 });
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '18:00') });
    return { provider, customer, svc };
};

// 20:00 is past the 18:00 close → the business-hours gate refuses it.
const bookLate = (ctx, startTime = '20:00', endTime = '20:30') => request(app)
    .post('/api/appointments').set(authHeader(ctx.customer))
    .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime, endTime });

const alertCount = (providerId) => Notification.countDocuments({ user: providerId, type: 'system', message: /turned away/ });

describe('recording and the burst alert', () => {
    it('three refusals in the window raise exactly one alert naming the reason', async () => {
        const ctx = await setup();
        for (const t of [['20:00', '20:30'], ['19:00', '19:30'], ['18:30', '19:00']]) {
            expect((await bookLate(ctx, t[0], t[1])).status).toBe(400);
        }
        await waitFor(async () => (await BookingRejection.countDocuments({ provider: ctx.provider._id })) === 3);
        await waitFor(async () => (await alertCount(ctx.provider._id)) === 1);

        const alert = await Notification.findOne({ user: ctx.provider._id, type: 'system' });
        expect(alert.message).toMatch(/3 booking attempts were turned away/);
        expect(alert.message).toMatch(/outside your working hours/);
        expect(alert.link).toBe('/dashboard?tab=availability');
    });

    it('a fourth refusal does not raise a second alert (throttle)', async () => {
        const ctx = await setup();
        for (const t of [['20:00', '20:30'], ['19:00', '19:30'], ['18:30', '19:00']]) {
            await bookLate(ctx, t[0], t[1]);
        }
        await waitFor(async () => (await alertCount(ctx.provider._id)) === 1);

        await bookLate(ctx, '21:00', '21:30');
        await waitFor(async () => (await BookingRejection.countDocuments({ provider: ctx.provider._id })) === 4);
        expect(await alertCount(ctx.provider._id)).toBe(1);
    });

    it('below the threshold there is no alert', async () => {
        const ctx = await setup();
        await bookLate(ctx, '20:00', '20:30');
        await bookLate(ctx, '19:00', '19:30');
        await waitFor(async () => (await BookingRejection.countDocuments({ provider: ctx.provider._id })) === 2);
        expect(await alertCount(ctx.provider._id)).toBe(0);
    });

    it("a provider's own walk-in outside hours records nothing (override, not a refusal)", async () => {
        const ctx = await setup();
        const res = await request(app)
            .post('/api/appointments').set(authHeader(ctx.provider))
            .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime: '20:00', endTime: '20:30', walkInName: 'Walk In' });
        expect(res.status).toBe(201);
        // Give any (wrong) fire-and-forget write a beat to land before asserting none did.
        await new Promise((r) => setTimeout(r, 150));
        expect(await BookingRejection.countDocuments({ provider: ctx.provider._id })).toBe(0);
    });
});

describe('GET /api/appointments/rejections-summary', () => {
    it('reports the 7-day count and dominant reason to the owner', async () => {
        const ctx = await setup();
        for (const t of [['20:00', '20:30'], ['19:00', '19:30'], ['18:30', '19:00']]) {
            await bookLate(ctx, t[0], t[1]);
        }
        await waitFor(async () => (await BookingRejection.countDocuments({ provider: ctx.provider._id })) === 3);

        const res = await request(app).get('/api/appointments/rejections-summary').set(authHeader(ctx.provider));
        expect(res.status).toBe(200);
        expect(res.body.data.count).toBe(3);
        expect(res.body.data.topLabel).toBe('outside your working hours');
        expect(res.body.data.topCount).toBe(3);
    });

    it('is provider-only', async () => {
        const { customer } = await setup();
        const res = await request(app).get('/api/appointments/rejections-summary').set(authHeader(customer));
        expect(res.status).toBe(403);
    });
});
