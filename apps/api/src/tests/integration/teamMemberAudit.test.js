/**
 * Team-member audit regression tests.
 *
 * A multi-agent pass through the team-member feature surfaced a cluster of
 * booking-correctness and lifecycle bugs. Each block below pins one of the
 * confirmed findings so it can't come back:
 *
 *   #1  a staff member's self-calendar shows segments they perform
 *   #2  an existing booking's service buffers block an adjacent booking
 *   #4  a solo owner's reschedule inherits business hours like create does
 *   #5  a named member's slot feed reflects their weekly days off
 *   #6  inviting staff isn't blocked by a same-email CUSTOMER account
 *   #7  one login can't back two rows; archiving one keeps the other's access
 *   #8  deactivating a member blocks their login (reversibly)
 *   #10 overlapping weekly availability slots are refused
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => {
    const s = {};
    DAY_NAMES.forEach((d) => { s[d] = { enabled: true, slots: [{ start, end }] }; });
    return s;
};
// A date ~10 days out so it is always in the future when CI runs, and outside the
// 24h cancellation window for reschedules.
const soon = () => { const d = new Date(); d.setDate(d.getDate() + 10); return d; };
const DATEOBJ = soon();
const DATE = DATEOBJ.toISOString().slice(0, 10);
// Match how the server derives the weekday from the date string, so the disabled
// day lines up with what getBookedSlots / staffHoursReason compute.
const WEEKDAY = DAY_NAMES[new Date(DATE).getDay()];

// ── #6 invite is not blocked by a same-email customer account ────────────────
describe('#6 inviteTeamMember ignores a same-email marketplace customer account', () => {
    it('creates the staff login instead of 409-ing on the customer doc', async () => {
        const provider = await makeProvider();
        // The very common case: the staffer is already a platform customer.
        await makeUser({ email: 'shared@example.com', isVerified: true });
        const member = await TeamMember.create({ provider: provider._id, name: 'Sam', email: 'shared@example.com' });

        const res = await request(app)
            .post(`/api/team/${member._id}/invite`)
            .set(authHeader(provider))
            .send({});
        expect(res.status).toBe(200);
        // A separate BUSINESS-side staff account was minted (customer left intact).
        const staff = await User.findOne({ email: 'shared@example.com', role: 'staff' });
        expect(staff).toBeTruthy();
        expect(String(staff.staffOf)).toBe(String(provider._id));
        expect(await User.countDocuments({ email: 'shared@example.com' })).toBe(2);
    });
});

// ── #7 one login cannot back two roster rows; safe archive ───────────────────
describe('#7 duplicate roster rows sharing a login', () => {
    it('refuses inviting a login already active on another row', async () => {
        const provider = await makeProvider();
        const rowA = await TeamMember.create({ provider: provider._id, name: 'Dana', email: 'dana@example.com' });
        await request(app).post(`/api/team/${rowA._id}/invite`).set(authHeader(provider)).send({});
        const rowB = await TeamMember.create({ provider: provider._id, name: 'Dana2', email: 'dana@example.com' });

        const res = await request(app).post(`/api/team/${rowB._id}/invite`).set(authHeader(provider)).send({});
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already assigned/i);
    });

    it('archiving one of two rows sharing a login leaves the other active login intact', async () => {
        const provider = await makeProvider();
        const staff = await User.create({
            name: 'Lee', email: 'lee@example.com', password: 'Password1!', phone: '+15550009000',
            role: 'staff', staffOf: provider._id, isVerified: true, provider: 'local',
        });
        const rowA = await TeamMember.create({ provider: provider._id, name: 'Lee', user: staff._id, isActive: true });
        await TeamMember.create({ provider: provider._id, name: 'Lee dup', user: staff._id, isActive: true });

        const before = await User.findById(staff._id);
        await request(app).delete(`/api/team/${rowA._id}`).set(authHeader(provider));
        const after = await User.findById(staff._id);
        // The sibling row is still active, so the shared login must NOT be revoked.
        expect(String(after.staffOf)).toBe(String(provider._id));
        expect(after.tokenVersion).toBe(before.tokenVersion);
    });
});

// ── #8 deactivate blocks the login, reversibly ───────────────────────────────
describe('#8 deactivating a member blocks their login', () => {
    it('cuts access on isActive:false and restores it on isActive:true', async () => {
        const provider = await makeProvider();
        const staff = await User.create({
            name: 'Mel', email: 'mel@example.com', password: 'Password1!', phone: '+15550009100',
            role: 'staff', staffOf: provider._id, isVerified: true, provider: 'local',
        });
        const member = await TeamMember.create({ provider: provider._id, name: 'Mel', user: staff._id, isActive: true });
        const v0 = (await User.findById(staff._id)).tokenVersion;

        await request(app).put(`/api/team/${member._id}`).set(authHeader(provider)).send({ isActive: false });
        const off = await User.findById(staff._id);
        expect(off.isActive).toBe(false);
        expect(off.tokenVersion).toBe(v0 + 1);
        // Reversible: staffOf is kept so re-activation needs no re-invite.
        expect(String(off.staffOf)).toBe(String(provider._id));
        expect(off.deactivatedAt).toBeFalsy(); // suspended, not self-deactivated → no auto-reactivate on login

        await request(app).put(`/api/team/${member._id}`).set(authHeader(provider)).send({ isActive: true });
        expect((await User.findById(staff._id)).isActive).toBe(true);
    });
});

// ── #10 overlapping weekly availability is refused ───────────────────────────
describe('#10 updateTeamMemberAvailability rejects overlapping slots', () => {
    it('400s on two working periods that overlap', async () => {
        const provider = await makeProvider();
        const member = await TeamMember.create({ provider: provider._id, name: 'Nia' });
        const res = await request(app)
            .put(`/api/team/${member._id}/availability`)
            .set(authHeader(provider))
            .send({ schedule: { monday: { enabled: true, slots: [{ start: '09:00', end: '17:00' }, { start: '12:00', end: '18:00' }] } } });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/overlap/i);
    });

    it('still accepts separate, ordered periods', async () => {
        const provider = await makeProvider();
        const member = await TeamMember.create({ provider: provider._id, name: 'Nia2' });
        const res = await request(app)
            .put(`/api/team/${member._id}/availability`)
            .set(authHeader(provider))
            .send({ schedule: { monday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }] } } });
        expect(res.status).toBe(200);
    });
});

// ── #2 an existing booking's service buffers block an adjacent booking ───────
describe('#2 existing service buffers are enforced against the next booking', () => {
    const setup = async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const svc = await makeService(provider._id, { duration: 30, bufferBefore: 0, bufferAfter: 15 });
        const member = await TeamMember.create({ provider: provider._id, name: 'Pat' });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '20:00') });
        return { provider, customer, svc, member };
    };
    const book = (ctx, startTime, endTime) => request(app)
        .post('/api/appointments').set(authHeader(ctx.customer))
        .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime, endTime, teamMember: ctx.member._id.toString() });

    it('refuses a booking flush against an earlier booking\'s cleanup buffer', async () => {
        const ctx = await setup();
        expect((await book(ctx, '10:00', '10:30')).status).toBe(201);
        // 10:30 sits inside 10:00–10:30's 15-minute cleanup buffer.
        expect((await book(ctx, '10:30', '11:00')).status).toBe(400);
    });

    it('accepts a booking that clears the buffer', async () => {
        const ctx = await setup();
        expect((await book(ctx, '10:00', '10:30')).status).toBe(201);
        expect((await book(ctx, '10:45', '11:15')).status).toBe(201);
    });
});

// ── #4 a solo owner's reschedule inherits business hours like create ─────────
describe('#4 solo owner: reschedule matches create for after-hours slots', () => {
    const setupSolo = async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const svc = await makeService(provider._id, { duration: 30 });
        const member = await TeamMember.create({ provider: provider._id, name: 'Owner-staff' });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '20:00') });
        // A leftover custom weekly schedule narrower than business hours (09–17).
        await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: everyDay('09:00', '17:00') });
        return { provider, customer, svc, member };
    };

    it('lets the customer book an 18:00 slot AND reschedule it to another evening slot', async () => {
        const ctx = await setupSolo();
        const booked = await request(app).post('/api/appointments').set(authHeader(ctx.customer))
            .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime: '18:00', endTime: '18:30', teamMember: ctx.member._id.toString() });
        expect(booked.status).toBe(201);

        const res = await request(app).put(`/api/appointments/${booked.body.data._id}/reschedule`)
            .set(authHeader(ctx.customer)).send({ appointmentDate: DATE, startTime: '18:30' });
        expect(res.status).toBe(200);
    });
});

// ── #5 a named member's slot feed reflects their weekly days off ─────────────
describe('#5 named-member booked-slots honors weekly StaffAvailability', () => {
    it('marks the whole day off_shift on a weekday the member does not work', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        // Two bookable members so this is NOT a solo owner (whose weekly hours are ignored).
        const member = await TeamMember.create({ provider: provider._id, name: 'Rae' });
        await TeamMember.create({ provider: provider._id, name: 'Roy' });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '20:00') });
        // Disable exactly the weekday our DATE falls on.
        const schedule = everyDay('09:00', '17:00');
        schedule[WEEKDAY] = { enabled: false, slots: [] };
        await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule });

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=${member._id}`);
        expect(res.status).toBe(200);
        const off = res.body.data.filter((b) => b.kind === 'off_shift');
        expect(off.some((b) => b.startTime === '00:00' && b.endTime === '23:59')).toBe(true);
    });
});

// ── #1 a staff member's self-calendar includes segments they perform ─────────
describe('#1 staff self-calendar shows segment-only bookings', () => {
    it('includes a booking where the staffer is a services[] performer, not the top-level', async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const svc = await makeService(provider._id, { duration: 30 });
        const staff = await User.create({
            name: 'Sky', email: 'sky@example.com', password: 'Password1!', phone: '+15550009200',
            role: 'staff', staffOf: provider._id, isVerified: true, provider: 'local',
            staffPermissions: ['calendar:self', 'clients:assigned'],
        });
        const sky = await TeamMember.create({ provider: provider._id, name: 'Sky', user: staff._id });
        const lead = await TeamMember.create({ provider: provider._id, name: 'Lead' });
        // Top-level performer is Lead; Sky performs only the second segment.
        await makeAppointment(customer._id, svc._id, provider._id, {
            teamMember: lead._id, status: 'confirmed', appointmentDate: DATEOBJ,
            startTime: '10:00', endTime: '12:00', totalPrice: 100,
            services: [
                { service: svc._id, name: 'A', price: 50, duration: 60, startTime: '10:00', endTime: '11:00', teamMember: lead._id },
                { service: svc._id, name: 'B', price: 50, duration: 60, startTime: '11:00', endTime: '12:00', teamMember: sky._id },
            ],
        });

        const res = await request(app).get('/api/appointments').set(authHeader(staff));
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(1);
    });
});
