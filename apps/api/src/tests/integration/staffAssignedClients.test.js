/**
 * Staff see only their ASSIGNED clients (DUAL_APP_SPEC §2b "/clients …
 * staff(assigned)", §4.2 "for calendar/clients, to their own assignments",
 * Epic 2.4 AC "an invited staff … sees only their calendar + assigned clients").
 *
 * `clients:assigned` used to be a descriptive no-op, so a staff member saw
 * either NOTHING (no clients:view) or the business's WHOLE client list (Medium
 * tier). Both were wrong: the whole-business view belongs to the owner alone.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Appointment = require('../../models/Appointment');
const TeamMember = require('../../models/TeamMember');
const { makeProvider, makeUser, makeService, makeAppointment, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// An owner with two staff, each holding one client of their own.
const setup = async ({ tier = null, permissions = ['calendar:self', 'clients:assigned'] } = {}) => {
    const provider = await makeProvider();
    const svc = await makeService(provider._id);

    const mineUser = await makeUser({ role: 'staff', staffOf: provider._id, staffTier: tier, staffPermissions: permissions });
    const mine = await TeamMember.create({ provider: provider._id, name: 'Mine', user: mineUser._id });
    const other = await TeamMember.create({ provider: provider._id, name: 'Other' });

    const myClient = await makeUser({ name: 'My Client' });
    const theirClient = await makeUser({ name: 'Their Client' });
    await makeAppointment(myClient._id, svc._id, provider._id, { status: 'completed', teamMember: mine._id });
    await makeAppointment(theirClient._id, svc._id, provider._id, { status: 'completed', teamMember: other._id });

    return { provider, svc, mineUser, mine, other, myClient, theirClient };
};

const list = (actor) => request(app).get('/api/crm/clients').set(authHeader(actor));

describe('staff client list is assignment-scoped', () => {
    it('a freshly invited staff member (default perms, no tier) sees their assigned client', async () => {
        // The Epic 2.4 AC. Previously this 403'd — the default invite grants
        // clients:assigned, which was a no-op, and clients:view is Medium+.
        const { mineUser } = await setup();
        const res = await list(mineUser);
        expect(res.status).toBe(200);
        expect(res.body.data.map((c) => c.customer.name)).toEqual(['My Client']);
    });

    it("does NOT show a colleague's client", async () => {
        const { mineUser } = await setup();
        const names = (await list(mineUser)).body.data.map((c) => c.customer.name);
        expect(names).not.toContain('Their Client');
    });

    it('a Medium-tier staff member holding clients:view is STILL assignment-scoped', async () => {
        // The whole-business client list is the owner's view alone — no tier or
        // flag widens a staff principal to it.
        const { mineUser } = await setup({ tier: 'medium', permissions: [] });
        const res = await list(mineUser);
        expect(res.status).toBe(200);
        expect(res.body.data.map((c) => c.customer.name)).toEqual(['My Client']);
    });

    it('the OWNER still sees every client of the business', async () => {
        const { provider } = await setup();
        const names = (await list(provider)).body.data.map((c) => c.customer.name).sort();
        expect(names).toEqual(['My Client', 'Their Client']);
    });

    it('attributes a multi-service segment the staff member performed', async () => {
        // Mirrors the calendar's memberInvolvedFilter: a colleague may be primary
        // while this member runs one segment — that still makes them their client.
        const { provider, svc, mineUser, mine, other } = await setup();
        const segClient = await makeUser({ name: 'Segment Client' });
        await Appointment.create({
            customer: segClient._id, service: svc._id, provider: provider._id, teamMember: other._id,
            appointmentDate: new Date(Date.now() + 3 * 864e5), startTime: '09:00', endTime: '10:00',
            totalPrice: 80, status: 'completed',
            services: [{ service: svc._id, teamMember: mine._id, startTime: '09:00', endTime: '09:30' }],
        });
        const names = (await list(mineUser)).body.data.map((c) => c.customer.name);
        expect(names).toContain('Segment Client');
    });

    it('a staff account with no roster row gets an empty list, not an error', async () => {
        const provider = await makeProvider();
        const stray = await makeUser({ role: 'staff', staffOf: provider._id });
        const res = await list(stray);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
    });
});

describe("staff cannot open or annotate a colleague's client", () => {
    it('404s on the detail of a client they do not serve', async () => {
        const { mineUser, theirClient } = await setup();
        const res = await request(app).get(`/api/crm/clients/${theirClient._id}`).set(authHeader(mineUser));
        expect(res.status).toBe(404);
    });

    it('opens the detail of a client they DO serve', async () => {
        const { mineUser, myClient } = await setup();
        const res = await request(app).get(`/api/crm/clients/${myClient._id}`).set(authHeader(mineUser));
        expect(res.status).toBe(200);
        expect(res.body.data.appointments.length).toBeGreaterThan(0);
    });

    it("refuses to write a CRM note about a colleague's client", async () => {
        // clients:edit is Medium+, so give the tier — assignment must still bind.
        const { mineUser, theirClient } = await setup({ tier: 'medium', permissions: [] });
        const res = await request(app)
            .put(`/api/crm/clients/${theirClient._id}/notes`)
            .set(authHeader(mineUser))
            .send({ notes: 'should not stick' });
        expect(res.status).toBe(404);
    });

    it('allows a note about their own client', async () => {
        const { mineUser, myClient } = await setup({ tier: 'medium', permissions: [] });
        const res = await request(app)
            .put(`/api/crm/clients/${myClient._id}/notes`)
            .set(authHeader(mineUser))
            .send({ notes: 'allergic to peanuts' });
        expect(res.status).toBe(200);
        expect(res.body.data.notes).toBe('allergic to peanuts');
    });
});
