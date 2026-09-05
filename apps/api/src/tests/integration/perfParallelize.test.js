/**
 * Perf: latency batch — the read endpoints that fanned out into many sequential
 * DB round-trips were rewritten to issue the independent queries concurrently
 * (Promise.all), and the /messages conversations N+1 (a countDocuments per
 * conversation) was replaced with one grouped aggregate.
 *
 * These are behaviour-preserving refactors, so the assertions here pin the
 * OUTPUT — the numbers must be exactly what the sequential versions produced.
 * The admin revenue list/detail, earnings and CRM endpoints already have their
 * own suites; this covers the two with the least existing coverage:
 *   A. GET /api/analytics        (admin dashboard rollup — was 13 sequential)
 *   B. GET /api/messages/conversations  (per-conversation unread — was an N+1)
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeAdmin, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const Message = require('../../models/Message');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('A — GET /api/analytics (admin rollup, parallelized)', () => {
    it('returns correct appointment, status, user and popular-service rollups', async () => {
        const admin = await makeAdmin();
        const provider = await makeProvider();
        const cut = await makeService(provider._id, { name: 'Cut' });
        const colour = await makeService(provider._id, { name: 'Colour' });
        const alice = await makeUser();
        const bob = await makeUser();

        await makeAppointment(alice._id, cut._id, provider._id, { status: 'completed' });
        await makeAppointment(bob._id, cut._id, provider._id, { status: 'completed' });
        await makeAppointment(alice._id, colour._id, provider._id, { status: 'pending' });

        const res = await request(app).get('/api/analytics').set(authHeader(admin));
        expect(res.status).toBe(200);
        const d = res.body.data;

        expect(d.appointments.total).toBe(3);
        const byStatus = d.appointments.byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {});
        expect(byStatus.completed).toBe(2);
        expect(byStatus.pending).toBe(1);

        // Non-admin users: admin + provider + alice + bob → 3 non-admin (admin excluded).
        expect(d.users.total).toBe(3);
        expect(d.users.providers).toBe(1);
        expect(d.users.customers).toBe(2);

        // Popular services by booking count: Cut (2) ahead of Colour (1).
        expect(d.popularServices[0]).toMatchObject({ name: 'Cut', count: 2 });
        expect(d.popularServices.find((s) => s.name === 'Colour').count).toBe(1);

        // 30-day zero-filled series is always a full 30 buckets.
        expect(d.bookingsOverTime).toHaveLength(30);
        expect(d.newUsersOverTime).toHaveLength(30);
    });

    it('is admin-only', async () => {
        const provider = await makeProvider();
        const res = await request(app).get('/api/analytics').set(authHeader(provider));
        expect(res.status).toBe(403);
    });
});

describe('B — GET /api/messages/conversations (unread count, de-N+1ed)', () => {
    it('reports the right per-conversation unread count for the reader', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const alice = await makeUser();
        const bob = await makeUser();
        const apptA = await makeAppointment(alice._id, svc._id, provider._id, {});
        const apptB = await makeAppointment(bob._id, svc._id, provider._id, {});

        // Conversation A: two messages from alice → provider, both unread by provider.
        await Message.create({ sender: alice._id, recipient: provider._id, appointment: apptA._id, content: 'hi' });
        await Message.create({ sender: alice._id, recipient: provider._id, appointment: apptA._id, content: 'you there?' });
        // Conversation B: one message from bob → provider, already read by provider.
        await Message.create({ sender: bob._id, recipient: provider._id, appointment: apptB._id, content: 'thanks', readBy: [provider._id] });
        // A message the provider SENT (recipient alice) must never count as the provider's unread.
        await Message.create({ sender: provider._id, recipient: alice._id, appointment: apptA._id, content: 'on my way' });

        const res = await request(app).get('/api/messages/conversations').set(authHeader(provider));
        expect(res.status).toBe(200);

        const byAppt = {};
        for (const c of res.body.data) byAppt[String(c.appointment._id)] = c.unread;

        expect(byAppt[String(apptA._id)]).toBe(2); // two unread inbound
        expect(byAppt[String(apptB._id)]).toBe(0); // already read
    });

    it('counts only the current reader\'s unread, not the other party\'s', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const alice = await makeUser();
        const appt = await makeAppointment(alice._id, svc._id, provider._id, {});

        // provider → alice, unread by alice. From the PROVIDER's inbox this is 0.
        await Message.create({ sender: provider._id, recipient: alice._id, appointment: appt._id, content: 'reminder' });

        const provRes = await request(app).get('/api/messages/conversations').set(authHeader(provider));
        expect(provRes.body.data[0].unread).toBe(0);

        const aliceRes = await request(app).get('/api/messages/conversations').set(authHeader(alice));
        expect(aliceRes.body.data[0].unread).toBe(1);
    });
});
