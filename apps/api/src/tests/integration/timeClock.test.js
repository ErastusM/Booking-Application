/**
 * Time clock / timesheets. Staff clock in/out (token-scoped self-service); the
 * owner reads a member's timesheet. Pins the lifecycle (no double clock-in, no
 * clock-out when not clocked in), the totals, and the owner scoping.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const TimeClock = require('../../models/TimeClock');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A provider + a staff member with a linked login, so myMember resolves.
const setup = async () => {
    const provider = await makeProvider();
    const staff = await makeUser({ role: 'staff', staffOf: provider._id, email: `staff-${Date.now()}@test.com` });
    const member = await TeamMember.create({ provider: provider._id, name: 'Moses', user: staff._id });
    return { provider, staff, member };
};

describe('time clock lifecycle (staff self)', () => {
    it('clocks in, refuses a second clock-in, clocks out, refuses a second clock-out', async () => {
        const { staff, member } = await setup();

        const in1 = await request(app).post('/api/timeclock/mine/in').set(authHeader(staff)).send({});
        expect(in1.status).toBe(201);
        expect(in1.body.data.clockOut).toBeNull();
        expect(in1.body.data.minutes).toBeNull(); // open = no duration yet

        const in2 = await request(app).post('/api/timeclock/mine/in').set(authHeader(staff)).send({});
        expect(in2.status).toBe(400);
        expect(in2.body.message).toMatch(/already clocked in/i);

        const out1 = await request(app).post('/api/timeclock/mine/out').set(authHeader(staff)).send({});
        expect(out1.status).toBe(200);
        expect(out1.body.data.clockOut).not.toBeNull();

        const out2 = await request(app).post('/api/timeclock/mine/out').set(authHeader(staff)).send({});
        expect(out2.status).toBe(400);
        expect(out2.body.message).toMatch(/not clocked in/i);

        // Exactly one entry recorded, and it's closed.
        expect(await TimeClock.countDocuments({ teamMember: member._id })).toBe(1);
        const status = await request(app).get('/api/timeclock/mine').set(authHeader(staff));
        expect(status.body.data.open).toBeNull();
        expect(status.body.data.entries).toHaveLength(1);
    });

    it('sums closed entries into totalMinutes and reports the open one separately', async () => {
        const { staff, member, provider } = await setup();
        const now = Date.now();
        // A closed 90-minute entry earlier today…
        await TimeClock.create({ provider: provider._id, teamMember: member._id, clockIn: new Date(now - 3 * 3600e3), clockOut: new Date(now - 3 * 3600e3 + 90 * 60e3) });
        // …and one still open now.
        await TimeClock.create({ provider: provider._id, teamMember: member._id, clockIn: new Date(now - 10 * 60e3), clockOut: null });

        const res = await request(app).get('/api/timeclock/mine').set(authHeader(staff));
        expect(res.status).toBe(200);
        expect(res.body.data.totalMinutes).toBe(90);      // open entry not counted
        expect(res.body.data.open).not.toBeNull();
        expect(res.body.data.entries).toHaveLength(2);
    });

    it('a provider (no staff profile) gets an empty timesheet, not an error', async () => {
        const provider = await makeProvider();
        const res = await request(app).get('/api/timeclock/mine').set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.entries).toHaveLength(0);
    });
});

describe('owner timesheet view — scoped to the caller business', () => {
    it("the owner reads a member's timesheet", async () => {
        const { provider, member } = await setup();
        const now = Date.now();
        await TimeClock.create({ provider: provider._id, teamMember: member._id, clockIn: new Date(now - 2 * 3600e3), clockOut: new Date(now - 3600e3) });
        const res = await request(app).get(`/api/timeclock/${member._id}`).set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.entries).toHaveLength(1);
        expect(res.body.data.totalMinutes).toBe(60);
    });

    it("cannot read a member of another business", async () => {
        const { member } = await setup();
        const other = await makeProvider();
        const res = await request(app).get(`/api/timeclock/${member._id}`).set(authHeader(other));
        expect(res.status).toBe(404);
    });
});
