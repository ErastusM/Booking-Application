/**
 * Permission tiers — Phase 2a: the Medium tier turns on the resource-management
 * capabilities that scope by business, via a single staffOf remap:
 *   clients:view / clients:edit  (client records, /api/crm)
 *   calendar:manage              (the whole business's blocked time, /api/blocked-times)
 *   forms:manage                 (form templates, /api/forms)
 *
 * The load-bearing property is cross-tenant isolation: a Medium staff member
 * acts on THEIR EMPLOYER's records (req.user.staffOf), never their own id and
 * never another business. A Basic/Low member (lacking the capability) is refused
 * at the route — except that a Low member may block time in their OWN lane
 * (calendar:block:self; see blockedTimeOwnLane.test.js), never business-wide.
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
    const login = await makeUser({ role: 'staff', staffOf: provider._id, email: `staff-${tier}-${seq}@test.com`, staffTier: tier });
    await TeamMember.create({ provider: provider._id, name: `Staff ${tier} ${seq}`, role: 'Reception', user: login._id });
    return login;
};

// Assign an extra completed booking for `customer` to this staff login's roster
// row. Since Epic 2.4's assigned-client scoping, THAT is what makes someone a
// staff member's client — an unassigned booking sits in the owner's column.
const assignClientTo = async (staffLogin, provider, customer, service) => {
    const member = await TeamMember.findOne({ user: staffLogin._id, provider: provider._id });
    await makeAppointment(customer._id, service._id, provider._id, { status: 'completed', teamMember: member._id });
    return member;
};

// A business with one registered client (a customer who has a booking).
const makeBusinessWithClient = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const service = await makeService(provider._id);
    await makeAppointment(customer._id, service._id, provider._id, { status: 'completed' });
    return { provider, customer, service };
};

describe('clients:view / clients:edit — CRM', () => {
    it('a Medium staff member lists the clients ASSIGNED to them', async () => {
        const { provider, customer, service } = await makeBusinessWithClient();
        const medium = await makeStaff(provider, 'medium');
        await assignClientTo(medium, provider, customer, service);
        const res = await request(app).get('/api/crm/clients').set(authHeader(medium));
        expect(res.status).toBe(200);
        const ids = res.body.data.map((c) => String(c.customer._id));
        expect(ids).toContain(String(customer._id));
    });

    it('a Medium staff member does NOT see a client they were never assigned', async () => {
        // The whole-business client list is the OWNER's view alone — no tier
        // widens a staff principal to it (DUAL_APP_SPEC §2b / §4.2, Epic 2.4 AC).
        // Before assigned-scoping, Medium saw every client of the business.
        const { provider, customer } = await makeBusinessWithClient(); // booking is unassigned
        const medium = await makeStaff(provider, 'medium');
        const res = await request(app).get('/api/crm/clients').set(authHeader(medium));
        expect(res.status).toBe(200);
        expect(res.body.data.map((c) => String(c.customer._id))).not.toContain(String(customer._id));
    });

    it('a Low staff member may OPEN the CRM but sees only their assigned clients', async () => {
        // Opening /clients is the Basic-baseline clients:assigned, so every staff
        // member reaches it (Epic 2.4 AC: an invited staff sees their assigned
        // clients). The SCOPE, not the gate, is what protects everyone else's.
        const { provider, customer } = await makeBusinessWithClient();
        const low = await makeStaff(provider, 'low');
        const res = await request(app).get('/api/crm/clients').set(authHeader(low));
        expect(res.status).toBe(200);
        expect(res.body.data.map((c) => String(c.customer._id))).not.toContain(String(customer._id));
    });

    it('never surfaces another business\'s clients (staffOf scope)', async () => {
        const { customer } = await makeBusinessWithClient(); // business A + its client
        const businessB = await makeProvider();
        const mediumOfB = await makeStaff(businessB, 'medium');
        const res = await request(app).get('/api/crm/clients').set(authHeader(mediumOfB));
        expect(res.status).toBe(200);
        // B has no bookings → no clients, and A's client must not leak in.
        expect(res.body.data.map((c) => String(c.customer._id))).not.toContain(String(customer._id));
    });

    it('a Medium member writes a client note onto the BUSINESS record (not their own id)', async () => {
        const { provider, customer, service } = await makeBusinessWithClient();
        const medium = await makeStaff(provider, 'medium');
        await assignClientTo(medium, provider, customer, service); // must be THEIR client
        const res = await request(app)
            .put(`/api/crm/clients/${customer._id}/notes`)
            .set(authHeader(medium))
            .send({ internalNotes: 'VIP — offer the window chair.' });
        expect(res.status).toBe(200);
        expect(String(res.body.data.provider)).toBe(String(provider._id)); // keyed to the employer
        expect(String(res.body.data.provider)).not.toBe(String(medium._id));
    });

    it('a Low member cannot write a client note (no clients:edit)', async () => {
        const { provider, customer } = await makeBusinessWithClient();
        const low = await makeStaff(provider, 'low');
        const res = await request(app)
            .put(`/api/crm/clients/${customer._id}/notes`)
            .set(authHeader(low))
            .send({ internalNotes: 'nope' });
        expect(res.status).toBe(403);
    });

    it('a Medium member cannot note a stranger who never booked the business', async () => {
        const { provider } = await makeBusinessWithClient();
        const medium = await makeStaff(provider, 'medium');
        const stranger = await makeUser();
        const res = await request(app)
            .put(`/api/crm/clients/${stranger._id}/notes`)
            .set(authHeader(medium))
            .send({ internalNotes: 'should 404' });
        expect(res.status).toBe(404);
    });
});

describe('calendar:manage — blocked time', () => {
    it('a Medium member creates a block keyed to the business, and lists it', async () => {
        const { provider } = await makeBusinessWithClient();
        const medium = await makeStaff(provider, 'medium');
        const create = await request(app)
            .post('/api/blocked-times')
            .set(authHeader(medium))
            .send({ date: '2027-01-04', startTime: '12:00', endTime: '13:00', reason: 'Lunch' });
        expect(create.status).toBe(201);
        expect(String(create.body.data.provider)).toBe(String(provider._id));

        const list = await request(app).get('/api/blocked-times').set(authHeader(medium));
        expect(list.status).toBe(200);
        expect(list.body.data.some((b) => b.reason === 'Lunch')).toBe(true);
    });

    // A Low member now holds calendar:block:self (their own lane only), so this
    // pins the part of the old rule that still stands: no business-wide block.
    it('a Low member cannot block time for the whole business', async () => {
        const { provider } = await makeBusinessWithClient();
        const low = await makeStaff(provider, 'low');
        const res = await request(app)
            .post('/api/blocked-times')
            .set(authHeader(low))
            .send({ date: '2027-01-04', startTime: '12:00', endTime: '13:00' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('own_lane_only');
    });
});

describe('forms:manage — templates', () => {
    it('a Medium member creates a template keyed to the business', async () => {
        const { provider } = await makeBusinessWithClient();
        const medium = await makeStaff(provider, 'medium');
        const res = await request(app)
            .post('/api/forms/templates')
            .set(authHeader(medium))
            .send({ title: 'Intake', kind: 'intake', fields: [{ label: 'Allergies', type: 'text' }] });
        expect(res.status).toBe(201);
        expect(String(res.body.data.provider)).toBe(String(provider._id));
    });

    it('a Low member cannot manage templates', async () => {
        const { provider } = await makeBusinessWithClient();
        const low = await makeStaff(provider, 'low');
        const res = await request(app)
            .post('/api/forms/templates')
            .set(authHeader(low))
            .send({ title: 'Nope' });
        expect(res.status).toBe(403);
    });

    it("a Medium member of another business cannot edit this business's template", async () => {
        const { provider } = await makeBusinessWithClient();
        const owner = provider;
        // Owner creates a template.
        const created = await request(app)
            .post('/api/forms/templates')
            .set(authHeader(owner))
            .send({ title: 'A-owned', kind: 'intake', fields: [] });
        expect(created.status).toBe(201);
        const templateId = created.body.data._id;

        const businessB = await makeProvider();
        const mediumOfB = await makeStaff(businessB, 'medium');
        const res = await request(app)
            .put(`/api/forms/templates/${templateId}`)
            .set(authHeader(mediumOfB))
            .send({ title: 'hijacked' });
        expect(res.status).toBe(403);
    });
});
