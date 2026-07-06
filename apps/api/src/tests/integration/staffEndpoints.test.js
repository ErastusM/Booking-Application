/**
 * Epic 2.2 — staff management + staff-aware booking endpoints
 * (DUAL_APP_SPEC.md §4.2): invite/link, per-staff availability, service
 * assignment, staff-scoped blocked times + booked slots, public staff listing.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendStaffInviteEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const TeamMember = require('../../models/TeamMember');
const BlockedTime = require('../../models/BlockedTime');
const Appointment = require('../../models/Appointment');
const { sendStaffInviteEmail } = require('../../utils/emailService');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

const makeMember = (provider, overrides = {}) =>
    TeamMember.create({ provider: provider._id, name: 'Chair One', ...overrides });

describe('POST /api/team/:id/invite', () => {
    it('creates a linked staff User and fires the invite email', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner, { email: 'newstaff@test.com' });

        const res = await request(app)
            .post(`/api/team/${member._id}/invite`)
            .set(authHeader(owner));

        expect(res.status).toBe(200);
        const staffUser = await User.findOne({ email: 'newstaff@test.com' }).select('+passwordResetToken');
        expect(staffUser).toBeTruthy();
        expect(staffUser.role).toBe('staff');
        expect(staffUser.staffOf.toString()).toBe(owner._id.toString());
        expect(staffUser.staffPermissions).toEqual(['calendar:self', 'clients:assigned']);
        expect(staffUser.passwordResetToken).toBeTruthy();

        const linked = await TeamMember.findById(member._id);
        expect(linked.user.toString()).toBe(staffUser._id.toString());
        expect(sendStaffInviteEmail).toHaveBeenCalledTimes(1);
    });

    it('rejects a second invite and an email owned by another account', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner, { email: 'twice@test.com' });
        await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
        const again = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
        expect(again.status).toBe(400);

        const other = await makeMember(owner, { name: 'Other' });
        const customer = await makeUser(); // takes an email
        const clash = await request(app)
            .post(`/api/team/${other._id}/invite`)
            .set(authHeader(owner))
            .send({ email: customer.email });
        expect(clash.status).toBe(409);
    });

    it("cannot invite another provider's team member", async () => {
        const owner = await makeProvider();
        const rival = await makeProvider();
        const member = await makeMember(owner, { email: 'mine@test.com' });
        const res = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(rival));
        expect(res.status).toBe(404);
    });
});

describe('PUT /api/team/:id/services', () => {
    it('assigns owned services and rejects foreign ones', async () => {
        const owner = await makeProvider();
        const rival = await makeProvider();
        const mine = await makeService(owner._id);
        const theirs = await makeService(rival._id);
        const member = await makeMember(owner);

        const ok = await request(app)
            .put(`/api/team/${member._id}/services`)
            .set(authHeader(owner))
            .send({ services: [mine._id.toString()] });
        expect(ok.status).toBe(200);
        expect(ok.body.data.services.map(String)).toEqual([mine._id.toString()]);

        const bad = await request(app)
            .put(`/api/team/${member._id}/services`)
            .set(authHeader(owner))
            .send({ services: [theirs._id.toString()] });
        expect(bad.status).toBe(400);
    });
});

describe('GET/PUT /api/team/:id/availability', () => {
    const schedule = { monday: { enabled: true, slots: [{ start: '09:00', end: '13:00' }] } };

    it('provider sets a schedule; absence returns null (inherit business hours)', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner);

        const before = await request(app).get(`/api/team/${member._id}/availability`).set(authHeader(owner));
        expect(before.status).toBe(200);
        expect(before.body.data).toBeNull();

        const put = await request(app)
            .put(`/api/team/${member._id}/availability`)
            .set(authHeader(owner))
            .send({ schedule });
        expect(put.status).toBe(200);
        expect(put.body.data.schedule.monday.slots[0].start).toBe('09:00');
    });

    it('staff-self can manage their own schedule; others cannot', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner);
        const staffUser = await makeUser({ role: 'staff', staffOf: owner._id });
        member.user = staffUser._id;
        await member.save();

        const own = await request(app)
            .put(`/api/team/${member._id}/availability`)
            .set(authHeader(staffUser))
            .send({ schedule });
        expect(own.status).toBe(200);

        const stranger = await makeUser({ role: 'staff', staffOf: (await makeProvider())._id });
        const denied = await request(app)
            .put(`/api/team/${member._id}/availability`)
            .set(authHeader(stranger))
            .send({ schedule });
        expect(denied.status).toBe(404);

        const customer = await makeUser();
        const deniedCustomer = await request(app)
            .get(`/api/team/${member._id}/availability`)
            .set(authHeader(customer));
        expect(deniedCustomer.status).toBe(404);
    });
});

describe('Blocked times — staff scope', () => {
    it('creates business-wide and staff-scoped blocks; list filters by scope', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner);

        const businessWide = await request(app)
            .post('/api/blocked-times')
            .set(authHeader(owner))
            .send({ date: '2026-08-03', startTime: '09:00', endTime: '10:00' });
        expect(businessWide.status).toBe(201);
        expect(businessWide.body.data.teamMember).toBeNull();

        const staffOnly = await request(app)
            .post('/api/blocked-times')
            .set(authHeader(owner))
            .send({ date: '2026-08-03', startTime: '11:00', endTime: '12:00', teamMember: member._id.toString() });
        expect(staffOnly.status).toBe(201);
        expect(staffOnly.body.data.teamMember.toString()).toBe(member._id.toString());

        const unknown = await request(app)
            .post('/api/blocked-times')
            .set(authHeader(owner))
            .send({ date: '2026-08-03', startTime: '13:00', endTime: '14:00', teamMember: owner._id.toString() });
        expect(unknown.status).toBe(400);

        const all = await request(app).get('/api/blocked-times').set(authHeader(owner));
        expect(all.body.data).toHaveLength(2);
        const staffList = await request(app)
            .get(`/api/blocked-times?teamMember=${member._id}`)
            .set(authHeader(owner));
        expect(staffList.body.data).toHaveLength(1);
        const bizList = await request(app)
            .get('/api/blocked-times?teamMember=business')
            .set(authHeader(owner));
        expect(bizList.body.data).toHaveLength(1);
        expect(bizList.body.data[0].teamMember).toBeNull();
    });
});

describe('GET /api/appointments/booked-slots?teamMember=', () => {
    it('segments busy times per staff member; provider-wide without the param', async () => {
        const owner = await makeProvider();
        const svc = await makeService(owner._id);
        const customer = await makeUser();
        const a = await makeMember(owner, { name: 'A' });
        const b = await makeMember(owner, { name: 'B' });

        const date = new Date();
        date.setDate(date.getDate() + 7);
        const mk = (teamMember, startTime, endTime) => Appointment.create({
            customer: customer._id, service: svc._id, provider: owner._id,
            appointmentDate: date, startTime, endTime, status: 'confirmed', teamMember,
            totalPrice: svc.price,
        });
        await mk(a._id, '10:00', '10:30');
        await mk(b._id, '10:00', '10:30');

        const day = date.toISOString().split('T')[0];
        const wide = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${owner._id}&date=${day}`)
            .set(authHeader(customer));
        expect(wide.body.data).toHaveLength(2);

        const onlyA = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${owner._id}&date=${day}&teamMember=${a._id}`)
            .set(authHeader(customer));
        expect(onlyA.body.data).toHaveLength(1);
        expect(onlyA.body.data[0].teamMember.toString()).toBe(a._id.toString());
    });
});

describe('GET /api/providers/:id/staff (public)', () => {
    it('lists active staff, filters by service, and hides contact details', async () => {
        const owner = await makeProvider();
        const cut = await makeService(owner._id, { name: 'Cut' });
        const shave = await makeService(owner._id, { name: 'Shave' });

        await makeMember(owner, { name: 'Anyone', email: 'hidden@test.com' });          // [] = all services
        const specialist = await makeMember(owner, { name: 'Cutter', services: [cut._id] });
        await makeMember(owner, { name: 'Gone', isActive: false });

        const all = await request(app).get(`/api/providers/${owner._id}/staff`);
        expect(all.status).toBe(200);
        expect(all.body.data.map(s => s.name).sort()).toEqual(['Anyone', 'Cutter']);
        expect(all.body.data[0].email).toBeUndefined();

        const forCut = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${cut._id}`);
        expect(forCut.body.data.map(s => s.name).sort()).toEqual(['Anyone', 'Cutter']);

        const forShave = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${shave._id}`);
        expect(forShave.body.data.map(s => s.name)).toEqual(['Anyone']);
        expect(forShave.body.data.find(s => s.name === 'Cutter')).toBeUndefined();
        void specialist;
    });
});

describe('Staff principal — login + profile (spec §4.2 auth)', () => {
    it('a staff user logs in and profile exposes staffOf + staffPermissions', async () => {
        const owner = await makeProvider();
        const staffUser = await makeUser({
            role: 'staff', staffOf: owner._id, staffPermissions: ['calendar:self'],
        });

        const login = await request(app)
            .post('/api/auth/login')
            .send({ email: staffUser.email, password: 'Password1!' });
        expect(login.status).toBe(200);

        const profile = await request(app).get('/api/auth/profile').set(authHeader(staffUser));
        expect(profile.status).toBe(200);
        expect(profile.body.data.role).toBe('staff');
        expect(profile.body.data.staffOf.toString()).toBe(owner._id.toString());
        expect(profile.body.data.staffPermissions).toEqual(['calendar:self']);
    });
});
