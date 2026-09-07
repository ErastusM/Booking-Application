/**
 * Re-audit batch D — performance (behaviour-preserving):
 *   D1/D2. resolveBookingStaff's "any available" pick looped isMemberFree over every
 *          performer, ~6 sequential queries each under the booking lock (HIGH N+1).
 *          It now batch-loads the day once and evaluates members in memory
 *          (firstFreePerformer). These tests pin the BEHAVIOUR: it still picks the
 *          earliest free performer, honours approved leave, and rejects when all
 *          performers are busy.
 *   D3.    getMyConversations no longer loads the whole inbox with four joins per
 *          message; it aggregates the latest message per appointment first. Output
 *          must be unchanged: one row per conversation, latest message, unread count.
 *   D4.    getMyClients dropped an unused join + hydration (lean projection); the
 *          per-client roll-up (registered + walk-in) must be unchanged.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService, makeUser, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const TimeOff = require('../../models/TimeOff');

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
const ymd = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const soon = () => { const d = new Date(); d.setDate(d.getDate() + 21); return ymd(d); };

// A shop with two bookable performers (Alice earlier-created than Bob), both on a
// full weekly schedule and both performing every service.
const twoMemberShop = async () => {
    const provider = await makeProvider();
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
    const svc = await makeService(provider._id, { price: 50, duration: 30 });
    const alice = await TeamMember.create({ provider: provider._id, name: 'Alice', isActive: true });
    const bob = await TeamMember.create({ provider: provider._id, name: 'Bob', isActive: true });
    await StaffAvailability.create({ provider: provider._id, teamMember: alice._id, schedule: everyDay('08:00', '19:00') });
    await StaffAvailability.create({ provider: provider._id, teamMember: bob._id, schedule: everyDay('08:00', '19:00') });
    return { provider, svc, alice, bob };
};

describe('D1 — any-available picks the free performer, then rejects when all are busy', () => {
    it('lands on the free member and 400s once every performer is booked', async () => {
        const { provider, svc, alice, bob } = await twoMemberShop();
        const date = soon();

        // Occupy Alice at 10:00 (provider books her explicitly).
        const a = await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: date,
            startTime: '10:00', endTime: '10:30', walkInName: 'A', teamMember: alice._id.toString(),
        });
        expect(a.status).toBe(201);

        // Customer, no pick, 10:00 → must resolve to Bob (Alice busy).
        const c1 = await request(app).post('/api/appointments').set(authHeader(await makeUser())).send({
            service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30',
        });
        expect(c1.status).toBe(201);
        expect(String(c1.body.data.teamMember)).toBe(String(bob._id));

        // Now both busy at 10:00 → next any-available is refused.
        const c2 = await request(app).post('/api/appointments').set(authHeader(await makeUser())).send({
            service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30',
        });
        expect(c2.status).toBe(400);
    });
});

describe('D2 — any-available skips a performer on approved leave', () => {
    it('does not resolve to a member who is on approved all-day leave', async () => {
        const { provider, svc, alice, bob } = await twoMemberShop();
        const date = soon();
        // Alice is the earliest-created (would be picked first) but is on leave.
        await TimeOff.create({
            provider: provider._id, teamMember: alice._id, status: 'approved',
            startDate: date, endDate: date, allDay: true,
        });

        const c = await request(app).post('/api/appointments').set(authHeader(await makeUser())).send({
            service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30',
        });
        expect(c.status).toBe(201);
        expect(String(c.body.data.teamMember)).toBe(String(bob._id)); // not Alice
    });
});

describe('D3 — getMyConversations returns one latest-message row per conversation', () => {
    it('bounds the fetch but preserves the conversation list', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const client = await makeUser();
        // Two separate appointments (two conversations) between the same pair.
        const mk = async (startTime, endTime) => {
            const appt = await request(app).post('/api/appointments').set(authHeader(client)).send({
                service: svc._id.toString(), appointmentDate: soon(), startTime, endTime,
            });
            return appt.body.data._id;
        };
        const a1 = await mk('10:00', '10:30');
        const a2 = await mk('11:00', '11:30');
        // Two messages on a1 (client → provider), one on a2; latest on a1 is "second".
        await request(app).post(`/api/messages/${a1}`).set(authHeader(client)).send({ content: 'first' });
        await request(app).post(`/api/messages/${a1}`).set(authHeader(client)).send({ content: 'second' });
        await request(app).post(`/api/messages/${a2}`).set(authHeader(client)).send({ content: 'only' });

        const res = await request(app).get('/api/messages/conversations').set(authHeader(provider));
        expect(res.status).toBe(200);
        const convos = res.body.data;
        expect(convos.length).toBe(2); // one row per appointment, not per message
        const byAppt = Object.fromEntries(convos.map(c => [String(c.appointment._id), c]));
        expect(byAppt[a1].lastMessage.content).toBe('second'); // the LATEST message
        expect(byAppt[a2].lastMessage.content).toBe('only');
        expect(byAppt[a1].unread).toBe(2); // provider hasn't read a1's two messages
    });
});

describe('D4 — getMyClients roll-up survives the lean projection', () => {
    it('aggregates registered and walk-in clients with visits and spend', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 40 });
        const client = await makeUser({ name: 'Registered Rita' });
        // Registered client: two completed visits.
        for (let i = 0; i < 2; i++) {
            const b = await request(app).post('/api/appointments').set(authHeader(client)).send({
                service: svc._id.toString(), appointmentDate: soon(), startTime: `1${i}:00`, endTime: `1${i}:30`,
            });
            await request(app).put(`/api/appointments/${b.body.data._id}/status`).set(authHeader(provider)).send({ status: 'completed' });
        }
        // Walk-in logged by the provider.
        await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: soon(), startTime: '15:00', endTime: '15:30', walkInName: 'Walk-in Wendy',
        });

        const res = await request(app).get('/api/crm/clients').set(authHeader(provider));
        expect(res.status).toBe(200);
        const clients = res.body.data;
        const rita = clients.find(c => c.customer.name === 'Registered Rita');
        const wendy = clients.find(c => c.customer.name === 'Walk-in Wendy');
        expect(rita).toBeTruthy();
        expect(rita.visits).toBe(2);
        expect(rita.totalSpend).toBe(80);     // two completed × 40
        expect(wendy).toBeTruthy();
        expect(wendy.isWalkIn).toBe(true);
    });
});
