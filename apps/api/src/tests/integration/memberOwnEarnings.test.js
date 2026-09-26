/**
 * A team member's Earnings screen is the owner's, scoped to them: the money
 * from the completed bookings THEY performed. Never a colleague's takings, the
 * owner's own, another business's, or unfinished bookings — and on a
 * multi-service ticket only their own segments count. No payroll anywhere.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

let seq = 0;
const makeStaff = async (provider, tier) => {
    seq += 1;
    const login = await makeUser({ role: 'staff', staffOf: provider._id, email: `earn-${seq}@test.com`, staffTier: tier });
    const member = await TeamMember.create({ provider: provider._id, name: `Earner ${seq}`, user: login._id, offersAllServices: true });
    return { login, member };
};
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d; };
const mine = (user, q = '') => request(app).get(`/api/earnings/mine${q}`).set(authHeader(user));

const setup = async () => {
    const provider = await makeProvider();
    const cut = await makeService(provider._id, { name: 'Cut', price: 100 });
    const colour = await makeService(provider._id, { name: 'Colour', price: 300 });
    const erastus = await makeStaff(provider, 'low');
    const sarah = await makeStaff(provider, 'low');
    const client = await makeUser({ name: 'Tomas Shikongo' });
    const secret = await makeUser({ name: 'Secret Client' });
    // Erastus: two completed (one his own price), one still confirmed.
    await makeAppointment(client._id, cut._id, provider._id, { status: 'completed', teamMember: erastus.member._id, totalPrice: 150, appointmentDate: daysAgo(2) });
    await makeAppointment(client._id, cut._id, provider._id, { status: 'completed', teamMember: erastus.member._id, totalPrice: 100, appointmentDate: daysAgo(3) });
    await makeAppointment(client._id, cut._id, provider._id, { status: 'confirmed', teamMember: erastus.member._id, totalPrice: 999, appointmentDate: daysAgo(1) });
    // Sarah's and the owner's takings — never his.
    await makeAppointment(secret._id, colour._id, provider._id, { status: 'completed', teamMember: sarah.member._id, totalPrice: 300, appointmentDate: daysAgo(2) });
    await makeAppointment(secret._id, colour._id, provider._id, { status: 'completed', totalPrice: 5000, appointmentDate: daysAgo(2) });
    // A multi-service ticket: Sarah is primary, Erastus did the Cut segment.
    await makeAppointment(client._id, colour._id, provider._id, {
        status: 'completed', teamMember: sarah.member._id, totalPrice: 420, appointmentDate: daysAgo(4),
        startTime: '10:00', endTime: '11:30',
        services: [
            { service: colour._id, name: 'Colour', price: 300, duration: 60, startTime: '10:00', endTime: '11:00', teamMember: sarah.member._id },
            { service: cut._id, name: 'Cut', price: 120, duration: 30, startTime: '11:00', endTime: '11:30', teamMember: erastus.member._id },
        ],
    });
    return { provider, erastus, sarah };
};

describe('GET /api/earnings/mine', () => {
    it("adds up only the member's own completed bookings — and only their segment of a shared ticket", async () => {
        const { erastus } = await setup();
        const res = await mine(erastus.login);
        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(d.totals.earned).toBe(150 + 100 + 120);
        expect(d.totals.completedCount).toBe(3);
        expect(d.totals.allTimeEarned).toBe(370);
        expect(d.byTeamMember).toEqual([]);
        expect(d.byService).toEqual([{ name: 'Cut', earned: 370, count: 3 }]);
        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain('Secret Client');
        expect(raw).not.toContain('5000');
        // The still-confirmed booking (999) isn't money yet.
        expect(d.recent.map((r) => r.amount).sort((x, y) => x - y)).toEqual([100, 120, 150]);
        expect(d.topClients.map((c) => c.name)).toEqual(['Tomas Shikongo']);
    });

    it('a colleague sees their own, never his', async () => {
        const { sarah } = await setup();
        const res = await mine(sarah.login);
        expect(res.status).toBe(200);
        // Her own Colour and her Colour segment of the shared ticket — not his Cut.
        expect(res.body.data.totals.earned).toBe(300 + 300);
        expect(res.body.data.recent.map((r) => r.amount)).toEqual([300, 300]);
        expect(res.body.data.byService).toEqual([{ name: 'Colour', earned: 600, count: 2 }]);
    });

    it('a Manager (whole-business report access) still gets only their own here', async () => {
        const { provider } = await setup();
        const hilda = await makeStaff(provider, 'high');
        const res = await mine(hilda.login);
        expect(res.status).toBe(200);
        expect(res.body.data.totals.earned).toBe(0);
        expect(res.body.data.recent).toEqual([]);
    });

    it('a View-only member reads their own too (it is their money, not a business report)', async () => {
        const { provider } = await setup();
        const viewer = await makeStaff(provider, 'basic');
        const res = await mine(viewer.login);
        expect(res.status).toBe(200);
        expect(res.body.data.totals.allTimeCount).toBe(0);
    });

    it('is refused to customers and owners (the owner has the business report)', async () => {
        const { provider } = await setup();
        const customer = await makeUser();
        expect((await mine(customer)).status).toBe(403);
        expect((await mine(provider)).status).toBe(403);
    });

    it("a Service provider still can't read the business report", async () => {
        const { erastus } = await setup();
        const res = await request(app).get('/api/earnings').set(authHeader(erastus.login));
        expect(res.status).toBe(403);
    });
});
