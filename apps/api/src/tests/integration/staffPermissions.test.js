/**
 * Staff permission flags, and the calendar-access setting built on them.
 *
 * `User.staffPermissions` existed since the invite flow shipped but nothing ever
 * read it — a staff member was pinned to their own column whatever the owner
 * granted, so a calendar-access setting had nothing to act on. These pin the
 * flag actually changing what the API returns, and pin the boundary that makes
 * it a permission rather than a preference: the holder can't grant it to
 * themselves.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

/**
 * A business with two staff, each holding one booking, plus a login for the
 * first. Returns everything a test needs to ask "what can Moses see?".
 */
const setup = async (permissions = []) => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const service = await makeService(provider._id);

    const moses = await TeamMember.create({ provider: provider._id, name: 'Moses Hamalwa', role: 'Barber' });
    const sarah = await TeamMember.create({ provider: provider._id, name: 'Sarah Nangolo', role: 'Stylist' });

    const mosesLogin = await makeUser({
        role: 'staff', staffOf: provider._id, email: 'moses@test.com', staffPermissions: permissions,
    });
    await TeamMember.updateOne({ _id: moses._id }, { $set: { user: mosesLogin._id } });

    const mine = await makeAppointment(customer._id, service._id, provider._id, { teamMember: moses._id, startTime: '10:00', endTime: '10:30' });
    const hers = await makeAppointment(customer._id, service._id, provider._id, { teamMember: sarah._id, startTime: '11:00', endTime: '11:30' });

    return { provider, moses, sarah, mosesLogin, mine, hers };
};

const listFor = (user) => request(app).get('/api/appointments?all=true').set(authHeader(user));

describe('calendar access — what a staff member sees', () => {
    it('narrows to their own bookings without calendar:all', async () => {
        const { mosesLogin, mine } = await setup(['calendar:self']);

        const res = await listFor(mosesLogin);

        expect(res.status).toBe(200);
        expect(res.body.data.map((a) => a._id)).toEqual([mine._id.toString()]);
    });

    it('shows the whole business with calendar:all', async () => {
        const { mosesLogin, mine, hers } = await setup(['calendar:all']);

        const res = await listFor(mosesLogin);

        expect(res.status).toBe(200);
        const ids = res.body.data.map((a) => a._id).sort();
        expect(ids).toEqual([mine._id.toString(), hers._id.toString()].sort());
    });

    it('never reaches another business, even holding calendar:all', async () => {
        const { mosesLogin } = await setup(['calendar:all']);
        // A completely separate business with its own booking.
        const other = await makeProvider();
        const otherCustomer = await makeUser();
        const otherService = await makeService(other._id);
        const otherAppt = await makeAppointment(otherCustomer._id, otherService._id, other._id);

        const res = await listFor(mosesLogin);

        expect(res.body.data.map((a) => a._id)).not.toContain(otherAppt._id.toString());
    });

    it('sees nothing once their roster link is severed', async () => {
        const { mosesLogin } = await setup(['calendar:all']);
        await User.updateOne({ _id: mosesLogin._id }, { $set: { staffOf: null } });
        const detached = await User.findById(mosesLogin._id);

        const res = await listFor(detached);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
    });

    it('leaves the owner seeing everything regardless of flags', async () => {
        const { provider, mine, hers } = await setup([]);

        const res = await listFor(provider);

        const ids = res.body.data.map((a) => a._id).sort();
        expect(ids).toEqual([mine._id.toString(), hers._id.toString()].sort());
    });
});

describe('setting permissions', () => {
    it('lets the owner grant calendar:all', async () => {
        const { provider, moses, mosesLogin } = await setup(['calendar:self']);

        const res = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(provider))
            .send({ permissions: ['calendar:all'] });

        expect(res.status).toBe(200);
        expect((await User.findById(mosesLogin._id)).staffPermissions).toEqual(['calendar:all']);
    });

    // The whole point of it being a permission and not a preference.
    it('does not let a staff member grant it to themselves', async () => {
        const { moses, mosesLogin } = await setup(['calendar:self']);

        const res = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(mosesLogin))
            .send({ permissions: ['calendar:all'] });

        expect(res.status).toBe(403);
        expect((await User.findById(mosesLogin._id)).staffPermissions).toEqual(['calendar:self']);
    });

    it('refuses another provider\'s team member', async () => {
        const { moses, mosesLogin } = await setup(['calendar:self']);
        const intruder = await makeProvider();

        const res = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(intruder))
            .send({ permissions: ['calendar:all'] });

        expect(res.status).toBe(404);
        expect((await User.findById(mosesLogin._id)).staffPermissions).toEqual(['calendar:self']);
    });

    // A typo must not sit in the database looking like a granted permission.
    it('rejects an unknown flag instead of storing it', async () => {
        const { provider, moses, mosesLogin } = await setup(['calendar:self']);

        const res = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(provider))
            .send({ permissions: ['calendar:all', 'earnings:everything'] });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/unknown permission/i);
        expect((await User.findById(mosesLogin._id)).staffPermissions).toEqual(['calendar:self']);
    });

    it('refuses a member who has no login yet', async () => {
        const { provider, sarah } = await setup([]);   // sarah was never invited

        const res = await request(app)
            .put(`/api/team/${sarah._id}/permissions`)
            .set(authHeader(provider))
            .send({ permissions: ['calendar:all'] });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/invite them first/i);
    });

    it('revoking calendar:all narrows the view again', async () => {
        const { provider, moses, mosesLogin, mine } = await setup(['calendar:all']);

        await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(provider))
            .send({ permissions: ['calendar:self'] });

        const refreshed = await User.findById(mosesLogin._id);
        const res = await listFor(refreshed);

        expect(res.body.data.map((a) => a._id)).toEqual([mine._id.toString()]);
    });
});
