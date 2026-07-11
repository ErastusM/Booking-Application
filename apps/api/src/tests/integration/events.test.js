/**
 * Product-analytics event pipe: batched ingestion is public + best-effort, and
 * the funnel summary is admin-only.
 */
const request = require('supertest');

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeAdmin, authHeader } = require('../helpers/factories');
const Event = require('../../models/Event');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

describe('POST /api/events (ingestion)', () => {
    test('accepts a batch anonymously and stores the events', async () => {
        const res = await request(app).post('/api/events').send({
            app: 'customer',
            sessionId: 'sess-1',
            events: [
                { name: 'page_view', path: '/', t: Date.now() },
                { name: 'provider_view', props: { providerId: 'abc' }, path: '/providers/abc' },
            ],
        });
        expect(res.status).toBe(204);

        const stored = await Event.find({ sessionId: 'sess-1' }).sort({ name: 1 });
        expect(stored).toHaveLength(2);
        expect(stored.map((e) => e.name).sort()).toEqual(['page_view', 'provider_view']);
        expect(stored.every((e) => e.app === 'customer')).toBe(true);
        expect(stored.every((e) => e.user == null)).toBe(true);
    });

    test('attributes events to the user when a token is sent', async () => {
        const user = await makeUser();
        const res = await request(app)
            .post('/api/events')
            .set(authHeader(user))
            .send({ app: 'customer', sessionId: 's2', events: [{ name: 'booking_confirm' }] });
        expect(res.status).toBe(204);

        const ev = await Event.findOne({ name: 'booking_confirm' });
        expect(String(ev.user)).toBe(String(user._id));
    });

    test('empty / malformed batches are acked without error', async () => {
        expect((await request(app).post('/api/events').send({})).status).toBe(204);
        expect((await request(app).post('/api/events').send({ events: [] })).status).toBe(204);
    });

    test('caps oversized batches and clips long names', async () => {
        const events = Array.from({ length: 50 }, (_, i) => ({ name: `e${i}` }));
        events.push({ name: 'x'.repeat(200) });
        await request(app).post('/api/events').send({ app: 'customer', sessionId: 'big', events });
        const stored = await Event.find({ sessionId: 'big' });
        expect(stored.length).toBeLessThanOrEqual(30); // MAX_BATCH
        expect(stored.every((e) => e.name.length <= 60)).toBe(true);
    });
});

describe('GET /api/events/summary (admin funnel)', () => {
    const seed = async () => {
        const rows = [
            ...Array.from({ length: 5 }, () => ({ name: 'provider_view', app: 'customer', sessionId: 's' })),
            ...Array.from({ length: 3 }, () => ({ name: 'booking_start', app: 'customer', sessionId: 's' })),
            ...Array.from({ length: 2 }, () => ({ name: 'booking_confirm', app: 'customer', sessionId: 's' })),
            { name: 'onboarding_step', app: 'business', props: { step: 'address' } },
            { name: 'onboarding_complete', app: 'business' },
        ];
        await Event.insertMany(rows);
    };

    test('requires admin', async () => {
        await seed();
        const guest = await request(app).get('/api/events/summary');
        expect(guest.status).toBe(401);

        const user = await makeUser();
        const nonAdmin = await request(app).get('/api/events/summary').set(authHeader(user));
        expect(nonAdmin.status).toBe(403);
    });

    test('returns totals and computed funnels for an admin', async () => {
        await seed();
        const admin = await makeAdmin();
        const res = await request(app).get('/api/events/summary?days=7').set(authHeader(admin));
        expect(res.status).toBe(200);
        expect(res.body.totals.provider_view).toBe(5);
        expect(res.body.funnels.booking.providerViews).toBe(5);
        expect(res.body.funnels.booking.bookingConfirms).toBe(2);
        // 3 starts / 5 views = 60%, 2 confirms / 3 starts ≈ 66.7%
        expect(res.body.funnels.booking.viewToStartRate).toBeCloseTo(60, 1);
        expect(res.body.funnels.onboarding.completes).toBe(1);
        expect(res.body.funnels.onboarding.byStep.address).toBe(1);
    });
});
