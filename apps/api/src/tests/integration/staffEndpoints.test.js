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
        const staffUser = await User.findOne({ email: 'newstaff@test.com' }).select('+passwordResetToken +staffInvites');
        expect(staffUser).toBeTruthy();
        expect(staffUser.role).toBe('staff');
        expect(staffUser.staffOf.toString()).toBe(owner._id.toString());
        expect(staffUser.staffPermissions).toEqual(['calendar:self', 'clients:assigned']);
        // No level picked → Service provider: runs their own calendar from day one.
        expect(staffUser.staffTier).toBe('low');
        // The invite lives in staffInvites (one entry per email), not the
        // password-reset slot the member's own "Forgot password?" writes.
        expect(staffUser.staffInvites).toHaveLength(1);
        expect(staffUser.passwordResetToken).toBeFalsy();
        expect(res.body.data.inviteSentAt).toBeTruthy();
        expect(res.body.data.inviteExpiresAt).toBeTruthy();

        const linked = await TeamMember.findById(member._id);
        expect(linked.user.toString()).toBe(staffUser._id.toString());
        expect(sendStaffInviteEmail).toHaveBeenCalledTimes(1);
        expect(res.body.data.emailSent).toBe(true);
        expect(res.body.data.email).toBe('newstaff@test.com');
    });

    it('stores the level the owner picks at invite time (view-only stays view-only)', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner, { email: 'viewonly@test.com' });
        const res = await request(app)
            .post(`/api/team/${member._id}/invite`)
            .set(authHeader(owner))
            .send({ tier: 'basic' });
        expect(res.status).toBe(200);
        expect((await User.findOne({ email: 'viewonly@test.com' })).staffTier).toBe('basic');
    });

    it('reports emailSent:false when the mailer skips or fails', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner, { email: 'quiet@test.com' });
        sendStaffInviteEmail.mockResolvedValueOnce({ skipped: true }); // SMTP not configured
        const res = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
        expect(res.status).toBe(200);
        expect(res.body.data.emailSent).toBe(false);
        // The account is still created — a resend can reach them later.
        expect(await User.findOne({ email: 'quiet@test.com' })).toBeTruthy();
    });

    it('resends to a member who was invited but never signed in', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner, { email: 'twice@test.com' });
        await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
        // A minute later (an immediate double-tap is throttled — see staffInviteLifecycle).
        const u = await User.findOne({ email: 'twice@test.com' }).select('+staffInvites');
        u.staffInvites[0].sentAt = new Date(Date.now() - 2 * 60 * 1000);
        await u.save({ validateBeforeSave: false });
        const again = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
        expect(again.status).toBe(200);              // resend, not a rejection
        expect(again.body.data.emailSent).toBe(true);
        expect(sendStaffInviteEmail).toHaveBeenCalledTimes(2);
    });

    it('rejects a second invite once the member has actually logged in', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner, { email: 'active@test.com' });
        await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
        // Simulate them completing the invite and signing in.
        await User.updateOne({ email: 'active@test.com' }, { $set: { lastLoginAt: new Date() } });
        const again = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
        expect(again.status).toBe(400);
    });

    it('invites an email that already has a marketplace customer account', async () => {
        // The dual-app model allows one customer + one business account per email
        // ({email, accountType} unique index), and staff are frequently also
        // platform customers — so this must mint a separate business login, not
        // 409. A conflict with another BUSINESS account is still refused (see the
        // "another provider's team member" case below).
        const owner = await makeProvider();
        const other = await makeMember(owner, { name: 'Other' });
        const customer = await makeUser(); // owns a customer account on this email
        const res = await request(app)
            .post(`/api/team/${other._id}/invite`)
            .set(authHeader(owner))
            .send({ email: customer.email });
        expect(res.status).toBe(200);
        // A distinct business-side staff account was created; the customer untouched.
        const staff = await User.findOne({ email: customer.email, role: 'staff' });
        expect(staff).toBeTruthy();
        expect(String(staff._id)).not.toBe(String(customer._id));
        const stillCustomer = await User.findById(customer._id);
        expect(stillCustomer.role).toBe('customer');
        expect(stillCustomer.staffOf).toBeFalsy();
    });

    it('reuses an email whose only staff account is a fully-orphaned leftover', async () => {
        // A staff login detached (staffOf:null) with NO roster row anywhere is a
        // leftover from an older permanent removal — it belonged to no business but
        // kept the email occupied, 409'ing every re-invite. It's now deleted and a
        // clean account minted, so a removed person can be re-added on the same email.
        const owner = await makeProvider();
        const orphan = await makeUser({ email: 'boomerang@test.com', role: 'staff', staffOf: null, name: 'Boomerang' });
        const member = await makeMember(owner, { name: 'Boomerang', email: 'boomerang@test.com' });

        const res = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
        expect(res.status).toBe(200);

        // The stale orphan is gone; a fresh staff account was created and attached.
        expect(await User.findById(orphan._id)).toBeNull();
        const fresh = await User.findOne({ email: 'boomerang@test.com', role: 'staff' });
        expect(fresh).toBeTruthy();
        expect(String(fresh._id)).not.toBe(String(orphan._id));
        expect(fresh.staffOf.toString()).toBe(owner._id.toString());
        expect((await TeamMember.findById(member._id)).user.toString()).toBe(String(fresh._id));
    });

    it('still refuses an email that is active staff at another business', async () => {
        const owner = await makeProvider();
        const rival = await makeProvider();
        // A live staff account of a DIFFERENT business — not an orphan, so it stays blocked.
        const taken = await makeUser({ email: 'taken@test.com', role: 'staff', staffOf: rival._id });
        const member = await makeMember(owner, { name: 'New' });

        const res = await request(app)
            .post(`/api/team/${member._id}/invite`)
            .set(authHeader(owner))
            .send({ email: 'taken@test.com' });
        expect(res.status).toBe(409);
        // The other business's account is untouched.
        expect(await User.findById(taken._id)).toBeTruthy();
    });

    it("cannot invite another provider's team member", async () => {
        const owner = await makeProvider();
        const rival = await makeProvider();
        const member = await makeMember(owner, { email: 'mine@test.com' });
        const res = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(rival));
        expect(res.status).toBe(404);
    });
});

describe('staff self-service — /api/team/mine/services', () => {
    const makeStaff = async (owner, member) => {
        const staff = await makeUser({ role: 'staff', staffOf: owner._id });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: staff._id } });
        return staff;
    };

    it('lists the business menu plus the member’s own selection', async () => {
        const owner = await makeProvider();
        const trim = await makeService(owner._id, { name: 'Trim' });
        await makeService(owner._id, { name: 'Beard' });
        const member = await makeMember(owner, { services: [trim._id] });
        const staff = await makeStaff(owner, member);

        const res = await request(app).get('/api/team/mine/services').set(authHeader(staff));
        expect(res.status).toBe(200);
        expect(res.body.data.services).toHaveLength(2);
        expect(res.body.data.selected).toEqual([trim._id.toString()]);
    });

    it('lets the member set their OWN services', async () => {
        const owner = await makeProvider();
        const s1 = await makeService(owner._id);
        await makeService(owner._id);
        const member = await makeMember(owner);
        const staff = await makeStaff(owner, member);

        const res = await request(app).put('/api/team/mine/services')
            .set(authHeader(staff)).send({ services: [s1._id.toString()] });
        expect(res.status).toBe(200);
        expect((await TeamMember.findById(member._id)).services.map(String)).toEqual([s1._id.toString()]);
    });

    it('refuses a service that belongs to another business', async () => {
        const owner = await makeProvider();
        const rival = await makeProvider();
        const foreign = await makeService(rival._id);
        const member = await makeMember(owner);
        const staff = await makeStaff(owner, member);

        const res = await request(app).put('/api/team/mine/services')
            .set(authHeader(staff)).send({ services: [foreign._id.toString()] });
        expect(res.status).toBe(400);
        expect((await TeamMember.findById(member._id)).services).toHaveLength(0);
    });

    it('404s for a user with no staff profile (e.g. the owner)', async () => {
        const owner = await makeProvider();
        const res = await request(app).get('/api/team/mine/services').set(authHeader(owner));
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

    it('refuses an inverted range (start after end), naming the day', async () => {
        const owner = await makeProvider();
        const member = await makeMember(owner);
        const res = await request(app)
            .put(`/api/team/${member._id}/availability`)
            .set(authHeader(owner))
            .send({ schedule: { monday: { enabled: true, slots: [{ start: '19:00', end: '07:00' }] } } });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Monday/);
        expect(res.body.message).toMatch(/after the starting time/);
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
        // Anchor to local midday so the stored timestamp and the toISOString()
        // day string can't straddle a UTC midnight boundary (flakes when the
        // suite runs in the small hours in a non-UTC timezone).
        date.setHours(12, 0, 0, 0);
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

        // With a roster present, the list leads with a synthetic OWNER tile
        // (isOwner) — assert on the real staff by filtering it out, and confirm the
        // owner is present and first.
        const staffOnly = (res) => res.body.data.filter(s => !s.isOwner);

        const all = await request(app).get(`/api/providers/${owner._id}/staff`);
        expect(all.status).toBe(200);
        expect(all.body.data[0].isOwner).toBe(true); // owner leads
        expect(staffOnly(all).map(s => s.name).sort()).toEqual(['Anyone', 'Cutter']);
        expect(staffOnly(all).find(s => s.name === 'Anyone').email).toBeUndefined(); // contact hidden

        const forCut = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${cut._id}`);
        expect(staffOnly(forCut).map(s => s.name).sort()).toEqual(['Anyone', 'Cutter']);

        const forShave = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${shave._id}`);
        expect(staffOnly(forShave).map(s => s.name)).toEqual(['Anyone']);
        expect(staffOnly(forShave).find(s => s.name === 'Cutter')).toBeUndefined();
        void specialist;
    });
});

describe('offersAllServices — a member’s services are their own and optional', () => {
    it('new members start with no services (offers nothing until set up)', async () => {
        const owner = await makeProvider();
        const res = await request(app).post('/api/team').set(authHeader(owner)).send({ name: 'New Hire', role: 'Cleaner', email: 'hire@test.com' });
        expect(res.status).toBe(201);
        expect(res.body.data.offersAllServices).toBe(false);
        expect(res.body.data.services || []).toEqual([]);
    });

    it('the public picker respects the flag: only-selected, offers-all, and offers-none', async () => {
        const owner = await makeProvider();
        const cut = await makeService(owner._id, { name: 'Cut' });
        const wash = await makeService(owner._id, { name: 'Car wash' });

        await makeMember(owner, { name: 'Vido', offersAllServices: true });                     // barber: everything
        await makeMember(owner, { name: 'Lazarus', offersAllServices: false, services: [wash._id] }); // only car wash
        await makeMember(owner, { name: 'Desk', offersAllServices: false, services: [] });        // nothing bookable

        const staffOnly = (res) => res.body.data.filter((s) => !s.isOwner);

        // A one-stop platform: the car washer must NOT show up for haircuts.
        const forCut = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${cut._id}`);
        expect(staffOnly(forCut).map((s) => s.name).sort()).toEqual(['Vido']);

        const forWash = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${wash._id}`);
        expect(staffOnly(forWash).map((s) => s.name).sort()).toEqual(['Lazarus', 'Vido']);

        // "Desk" (offers nothing) never appears for any service.
        expect(staffOnly(forCut).find((s) => s.name === 'Desk')).toBeUndefined();
        expect(staffOnly(forWash).find((s) => s.name === 'Desk')).toBeUndefined();
    });

    it('PUT /api/team/:id/services persists the flag and validates its type', async () => {
        const owner = await makeProvider();
        const wash = await makeService(owner._id, { name: 'Car wash' });
        const member = await makeMember(owner, { offersAllServices: true });

        const ok = await request(app)
            .put(`/api/team/${member._id}/services`)
            .set(authHeader(owner))
            .send({ services: [wash._id.toString()], offersAllServices: false });
        expect(ok.status).toBe(200);
        expect(ok.body.data.offersAllServices).toBe(false);
        expect(ok.body.data.services.map(String)).toEqual([wash._id.toString()]);
        expect((await TeamMember.findById(member._id)).offersAllServices).toBe(false);

        const bad = await request(app)
            .put(`/api/team/${member._id}/services`)
            .set(authHeader(owner))
            .send({ services: [], offersAllServices: 'yes' });
        expect(bad.status).toBe(400);
    });
});

describe('GET /api/appointments — staff sees ONLY their own column', () => {
    it('scopes a staff principal to their TeamMember; never the whole platform', async () => {
        const owner = await makeProvider();
        const otherOwner = await makeProvider();
        const svc = await makeService(owner._id);
        const otherSvc = await makeService(otherOwner._id);
        const customer = await makeUser();

        const mine = await makeMember(owner, { name: 'Mine' });
        const colleague = await makeMember(owner, { name: 'Colleague' });
        const staffUser = await makeUser({ role: 'staff', staffOf: owner._id });
        mine.user = staffUser._id;
        await mine.save();

        const date = new Date(); date.setDate(date.getDate() + 3);
        const mk = (provider, service, teamMember, startTime) => Appointment.create({
            customer: customer._id, service: service._id, provider: provider._id,
            appointmentDate: date, startTime, endTime: '23:59', status: 'confirmed',
            teamMember, totalPrice: 50,
        });
        await mk(owner, svc, mine._id, '09:00');       // theirs
        await mk(owner, svc, colleague._id, '10:00');  // same business, other staff
        await mk(owner, svc, null, '11:00');           // owner column
        await mk(otherOwner, otherSvc, null, '12:00'); // another business entirely

        const res = await request(app).get('/api/appointments').set(authHeader(staffUser));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].startTime).toBe('09:00');

        // A staff user with no linked roster row sees nothing (not everything).
        const orphan = await makeUser({ role: 'staff', staffOf: owner._id });
        const empty = await request(app).get('/api/appointments').set(authHeader(orphan));
        expect(empty.body.data).toHaveLength(0);
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

describe('a team member must have a job title and an email', () => {
    const add = (owner, body) => request(app).post('/api/team').set(authHeader(owner)).send(body);

    it('refuses a member with no job title', async () => {
        const owner = await makeProvider();
        const res = await add(owner, { name: 'No Title', email: 'nt@test.com' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/job title is required/i);
    });

    it('refuses a member with no email', async () => {
        const owner = await makeProvider();
        const res = await add(owner, { name: 'No Email', role: 'Cleaner' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/email is required/i);
    });

    it('refuses a malformed email', async () => {
        const owner = await makeProvider();
        const res = await add(owner, { name: 'Bad Email', role: 'Cleaner', email: 'not-an-email' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/valid email/i);
    });

    it('no longer silently defaults the job title to "Staff"', async () => {
        // The title is what clients see when picking a professional; a meaningless
        // default used to be written whenever the owner left it blank.
        const owner = await makeProvider();
        const res = await add(owner, { name: 'Real Title', role: 'Cleaner', email: 'rt@test.com' });
        expect(res.status).toBe(201);
        expect(res.body.data.role).toBe('Cleaner');
        expect(await TeamMember.countDocuments({ provider: owner._id, role: 'Staff' })).toBe(0);
    });

    it('an edit cannot clear the job title or the email', async () => {
        const owner = await makeProvider();
        const created = await add(owner, { name: 'Keep', role: 'Cleaner', email: 'keep@test.com' });
        const id = created.body.data._id;
        const noRole = await request(app).put(`/api/team/${id}`).set(authHeader(owner)).send({ role: '   ' });
        expect(noRole.status).toBe(400);
        const noEmail = await request(app).put(`/api/team/${id}`).set(authHeader(owner)).send({ email: '' });
        expect(noEmail.status).toBe(400);
        // A partial edit that omits them is still fine.
        const ok = await request(app).put(`/api/team/${id}`).set(authHeader(owner)).send({ phone: '+264810000000' });
        expect(ok.status).toBe(200);
        const row = await TeamMember.findById(id);
        expect(row.role).toBe('Cleaner');
        expect(row.email).toBe('keep@test.com');
    });
});
