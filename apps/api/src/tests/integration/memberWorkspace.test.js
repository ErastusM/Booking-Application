/**
 * A team member's workspace reads what applies to THEM: their own blocked time
 * (plus business-wide closures), their business's waiting list when their access
 * includes it, and a staff account is never booked as a client.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const TeamMember = require('../../models/TeamMember');
const BlockedTime = require('../../models/BlockedTime');
const WaitingList = require('../../models/WaitingList');
const Appointment = require('../../models/Appointment');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

let seq = 0;
const staff = async (provider, tier, extra = {}) => {
    seq += 1;
    const login = await makeUser({ role: 'staff', staffOf: provider._id, staffTier: tier, email: `m${seq}@test.com` });
    const member = await TeamMember.create({ provider: provider._id, name: `Member ${seq}`, user: login._id, ...extra });
    return { login, member };
};

describe('GET /api/blocked-times for a team member', () => {
    test('a Low member sees their own blocks and business-wide closures only', async () => {
        const owner = await makeProvider();
        const { login, member } = await staff(owner, 'low');
        const { member: colleague } = await staff(owner, 'low');
        await BlockedTime.create([
            { provider: owner._id, teamMember: member._id, date: '2030-01-07', startTime: '09:00', endTime: '10:00', reason: 'mine' },
            { provider: owner._id, teamMember: colleague._id, date: '2030-01-07', startTime: '09:00', endTime: '10:00', reason: 'colleague' },
            { provider: owner._id, teamMember: null, ownerOnly: true, date: '2030-01-07', startTime: '12:00', endTime: '13:00', reason: 'owner lunch' },
            { provider: owner._id, teamMember: null, date: '2030-01-08', startTime: '00:00', endTime: '23:59', reason: 'public holiday' },
        ]);
        const res = await request(app).get('/api/blocked-times').set(authHeader(login));
        expect(res.status).toBe(200);
        expect(res.body.data.map((b) => b.reason).sort()).toEqual(['mine', 'public holiday']);
    });

    test('a Basic member can read too, but only managers can change blocks', async () => {
        const owner = await makeProvider();
        const { login } = await staff(owner, null);
        expect((await request(app).get('/api/blocked-times').set(authHeader(login))).status).toBe(200);
        const write = await request(app).post('/api/blocked-times').set(authHeader(login))
            .send({ date: '2030-01-07', startTime: '09:00', endTime: '10:00' });
        expect(write.status).toBe(403);
    });

    test('a Medium member (sees everyone) still gets every block of the business', async () => {
        const owner = await makeProvider();
        const { login } = await staff(owner, 'medium');
        const { member: colleague } = await staff(owner, 'low');
        await BlockedTime.create([
            { provider: owner._id, teamMember: colleague._id, date: '2030-01-07', startTime: '09:00', endTime: '10:00', reason: 'colleague' },
            { provider: owner._id, teamMember: null, ownerOnly: true, date: '2030-01-07', startTime: '12:00', endTime: '13:00', reason: 'owner lunch' },
        ]);
        const res = await request(app).get('/api/blocked-times').set(authHeader(login));
        expect(res.body.data).toHaveLength(2);
    });
});

describe('GET /api/waitinglist/provider for a team member', () => {
    test('a member with waitlist access sees their own business’s list', async () => {
        const owner = await makeProvider();
        const other = await makeProvider();
        const svc = await makeService(owner._id);
        const otherSvc = await makeService(other._id);
        const client = await makeUser();
        await WaitingList.create([
            { service: svc._id, provider: owner._id, customer: client._id, appointmentDate: new Date('2030-01-07'), startTime: '09:00', endTime: '10:00', position: 1, status: 'waiting' },
            { service: otherSvc._id, provider: other._id, customer: client._id, appointmentDate: new Date('2030-01-07'), startTime: '09:00', endTime: '10:00', position: 1, status: 'waiting' },
        ]);
        const { login } = await staff(owner, 'low'); // Low includes waitlist:manage
        const res = await request(app).get('/api/waitinglist/provider').set(authHeader(login));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(String(res.body.data[0].provider)).toBe(String(owner._id));
    });

    test('a Basic member (no waitlist access) is refused', async () => {
        const owner = await makeProvider();
        const { login } = await staff(owner, null);
        expect((await request(app).get('/api/waitinglist/provider').set(authHeader(login))).status).toBe(403);
    });
});

describe('GET /api/services/my-services for a team member', () => {
    test('any member can read the business catalogue, but not change it', async () => {
        const owner = await makeProvider();
        await makeService(owner._id, { name: 'Haircut' });
        const { login } = await staff(owner, null); // Basic
        const res = await request(app).get('/api/services/my-services').set(authHeader(login));
        expect(res.status).toBe(200);
        expect(res.body.data.map((s) => s.name)).toContain('Haircut');
        const write = await request(app).post('/api/services/my-services').set(authHeader(login))
            .send({ name: 'Sneaky', description: 'x', price: 1, duration: 10 });
        expect(write.status).toBe(403);
    });
});

describe('POST /api/appointments by a team member', () => {
    const soon = () => {
        const d = new Date(); d.setDate(d.getDate() + 3);
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
    };

    test('without a walk-in name it is refused, never booked as the member', async () => {
        const owner = await makeProvider();
        const svc = await makeService(owner._id);
        const { login } = await staff(owner, 'low');
        const res = await request(app).post('/api/appointments').set(authHeader(login))
            .send({ service: svc._id.toString(), appointmentDate: soon(), startTime: '10:00', endTime: '10:30' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('staff_booking_not_allowed');
        expect(await Appointment.countDocuments({})).toBe(0);
    });

    test('a walk-in still books into their own column', async () => {
        const owner = await makeProvider();
        const svc = await makeService(owner._id);
        const { login, member } = await staff(owner, 'low', { offersAllServices: true });
        const res = await request(app).post('/api/appointments').set(authHeader(login))
            .send({ service: svc._id.toString(), appointmentDate: soon(), startTime: '10:00', endTime: '10:30', walkInName: 'Selma Kapolo' });
        expect(res.status).toBe(201);
        expect(String(res.body.data.teamMember?._id || res.body.data.teamMember)).toBe(String(member._id));
        expect(res.body.data.customer).toBeFalsy();
    });
});
