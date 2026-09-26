/**
 * Epic 2.3 — per-staff availability resolution (DUAL_APP_SPEC.md §3.6).
 * Spec ACs: two staff can hold the same clock slot; a staff member's blocked
 * time removes only THAT staff member's slots; "any available" assigns the
 * earliest free performer; zero-staff businesses behave exactly as before.
 * Race coverage mirrors the existing concurrent-booking guard.
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
const { makeUser, makeProvider, makeService, authHeader, giveHours } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const BlockedTime = require('../../models/BlockedTime');
const Availability = require('../../models/Availability');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

// Bookings for a slot in the past are rejected (400), so a DATE of *today* makes
// this suite pass only when it happens to run before the fixture start time and
// fail later in the day; a past date fails outright. Use the next Wednesday
// strictly in the future — always ahead of "now", and still a weekday every
// default schedule enables. Built from local date parts to match the controller.
const nextFutureWednesday = () => {
    const d = new Date();
    d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7)); // 3 = Wednesday, always strictly future
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DATE = nextFutureWednesday();

const book = (asUser, svc, { teamMember, startTime = '10:00', endTime = '10:30' } = {}) =>
    request(app)
        .post('/api/appointments')
        .set(authHeader(asUser))
        .send({ service: svc._id.toString(), appointmentDate: DATE, startTime, endTime, teamMember });

// Alice and Bob work every day, all day, unless a test sets their hours itself
// ({ withHours: false }): a member with no hours of their own can't be booked.
const setup = async ({ withHours = true } = {}) => {
    const owner = await makeProvider();
    const svc = await makeService(owner._id);
    const customer = await makeUser();
    const a = await TeamMember.create({ provider: owner._id, name: 'Alice' });
    const b = await TeamMember.create({ provider: owner._id, name: 'Bob' });
    if (withHours) { await giveHours(a); await giveHours(b); }
    return { owner, svc, customer, a, b };
};

describe('Customer picks a staff member — validation', () => {
    it("rejects another business's member, inactive members, and non-performers", async () => {
        const { owner, svc, customer } = await setup();
        const rival = await makeProvider();
        const foreign = await TeamMember.create({ provider: rival._id, name: 'Foreign' });
        const inactive = await TeamMember.create({ provider: owner._id, name: 'Inactive', isActive: false });
        const otherSvc = await makeService(owner._id, { name: 'Other' });
        const restricted = await TeamMember.create({ provider: owner._id, name: 'Restricted', services: [otherSvc._id] });

        expect((await book(customer, svc, { teamMember: foreign._id })).status).toBe(400);
        expect((await book(customer, svc, { teamMember: inactive._id })).status).toBe(400);
        const nonPerformer = await book(customer, svc, { teamMember: restricted._id });
        expect(nonPerformer.status).toBe(400);
        expect(nonPerformer.body.message).toMatch(/does not offer/i);
    });

    it('two staff can hold the same clock slot; the same staff cannot', async () => {
        const { svc, customer, a, b } = await setup();
        expect((await book(customer, svc, { teamMember: a._id })).status).toBe(201);
        expect((await book(customer, svc, { teamMember: b._id })).status).toBe(201);
        const double = await book(customer, svc, { teamMember: a._id });
        expect(double.status).toBe(409);
    });

    it("staff hours: a member's own schedule wins over business hours", async () => {
        const { owner, svc, customer, a } = await setup({ withHours: false });
        // Alice only works Tuesdays — DATE is a Wednesday.
        await StaffAvailability.create({
            provider: owner._id, teamMember: a._id,
            schedule: { tuesday: { enabled: true, slots: [{ start: '09:00', end: '17:00' }] } },
        });
        const res = await book(customer, svc, { teamMember: a._id });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/working hours/i);
    });

    it("a staff member's block removes only that member's slots; business-wide blocks remove all", async () => {
        const { owner, svc, customer, a, b } = await setup();
        await BlockedTime.create({ provider: owner._id, teamMember: a._id, date: DATE, startTime: '10:00', endTime: '11:00' });

        expect((await book(customer, svc, { teamMember: a._id })).status).toBe(400);
        expect((await book(customer, svc, { teamMember: b._id })).status).toBe(201);

        await BlockedTime.create({ provider: owner._id, date: DATE, startTime: '14:00', endTime: '15:00' });
        expect((await book(customer, svc, { teamMember: a._id, startTime: '14:00', endTime: '14:30' })).status).toBe(400);
        expect((await book(customer, svc, { teamMember: b._id, startTime: '14:00', endTime: '14:30' })).status).toBe(400);
    });
});

describe('"Any available" resolution', () => {
    it('assigns the earliest free performer and cascades as staff fill up', async () => {
        const { svc, customer, a, b } = await setup();

        const first = await book(customer, svc);
        expect(first.status).toBe(201);
        expect(first.body.data.teamMember.toString()).toBe(a._id.toString());

        const second = await book(customer, svc);
        expect(second.status).toBe(201);
        expect(second.body.data.teamMember.toString()).toBe(b._id.toString());

        const third = await book(customer, svc);
        expect(third.status).toBe(409);
        expect(third.body.message).toMatch(/waiting list/i);
    });

    it('skips a non-performer and a blocked member', async () => {
        const { owner, svc, customer, a, b } = await setup();
        const otherSvc = await makeService(owner._id, { name: 'Other' });
        a.services = [otherSvc._id]; // Alice no longer performs svc
        await a.save();
        await BlockedTime.create({ provider: owner._id, teamMember: b._id, date: DATE, startTime: '10:00', endTime: '10:30' });

        const res = await book(customer, svc);
        expect(res.status).toBe(400); // Alice doesn't perform it, Bob is blocked
    });

    it('falls back to the owner column when no roster member performs the service', async () => {
        const { owner, svc, customer, a, b } = await setup();
        const otherSvc = await makeService(owner._id, { name: 'Other' });
        a.services = [otherSvc._id]; await a.save();
        b.services = [otherSvc._id]; await b.save();

        const res = await book(customer, svc);
        expect(res.status).toBe(201);
        expect(res.body.data.teamMember).toBeNull(); // the owner performs it
    });
});

describe('Back-compat + overrides', () => {
    it('zero-staff businesses book exactly as before (teamMember null)', async () => {
        const owner = await makeProvider();
        const svc = await makeService(owner._id);
        const customer = await makeUser();
        const res = await book(customer, svc);
        expect(res.status).toBe(201);
        expect(res.body.data.teamMember).toBeNull();
    });

    it("provider can book a member outside that member's hours (walk-in override)", async () => {
        const { owner, svc, a } = await setup({ withHours: false });
        await StaffAvailability.create({
            provider: owner._id, teamMember: a._id,
            schedule: { tuesday: { enabled: true, slots: [{ start: '09:00', end: '17:00' }] } },
        });
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(owner))
            .send({ service: svc._id.toString(), appointmentDate: DATE, startTime: '10:00', endTime: '10:30', walkInName: 'Walk In', teamMember: a._id.toString() });
        expect(res.status).toBe(201);
    });

    it('provider booking without a pick stays on the owner column even with staff present', async () => {
        const { owner, svc } = await setup();
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(owner))
            .send({ service: svc._id.toString(), appointmentDate: DATE, startTime: '10:00', endTime: '10:30', walkInName: 'Walk In' });
        expect(res.status).toBe(201);
        expect(res.body.data.teamMember).toBeNull();
    });
});

// The business's ONLY bookable team member works the business's hours when they
// have weekly hours of their own (#121: a leftover 09:00–17:00 must not cost an
// 08:00–19:00 shop its evenings). The owner's answer — a member with NO hours of
// their own can't be booked — doesn't change that; it only ends the fallback for
// a member with none. (Every other path: loneMember.test.js.)
describe('The only bookable member — business hours govern when they have hours of their own', () => {
    const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const everyDay = (start, end) => DAYS.reduce((s, d) => { s[d] = { enabled: true, slots: [{ start, end }] }; return s; }, {});

    // The shop is open 08:00–19:00; its one team member has a leftover 09:00–17:00.
    const soloSetup = async ({ hours = everyDay('09:00', '17:00') } = {}) => {
        const owner = await makeProvider();
        const svc = await makeService(owner._id);
        const customer = await makeUser();
        const solo = await TeamMember.create({ provider: owner._id, name: 'Only Member' });
        await Availability.create({ provider: owner._id, schedule: everyDay('08:00', '19:00') });
        if (hours) await StaffAvailability.create({ provider: owner._id, teamMember: solo._id, schedule: hours });
        return { owner, svc, customer, solo };
    };

    it('books an 18:00 slot — inside business hours, outside their own — any available', async () => {
        const { svc, customer, solo } = await soloSetup();
        const res = await book(customer, svc, { startTime: '18:00', endTime: '18:30' });
        expect(res.status).toBe(201);
        expect(res.body.data.teamMember.toString()).toBe(solo._id.toString());
    });

    it('books it when the customer requests the member by name too', async () => {
        const { svc, customer, solo } = await soloSetup();
        expect((await book(customer, svc, { teamMember: solo._id, startTime: '18:00', endTime: '18:30' })).status).toBe(201);
    });

    it('with NO hours of their own they are not bookable at all — by name or any available', async () => {
        const { svc, customer, solo } = await soloSetup({ hours: null });
        const named = await book(customer, svc, { teamMember: solo._id, startTime: '10:00', endTime: '10:30' });
        expect(named.status).toBe(400);
        expect(named.body.message).toMatch(/no working hours/i);
        const any = await book(customer, svc, { startTime: '10:00', endTime: '10:30' });
        expect(any.status).toBe(400);
        expect(any.body.message).toMatch(/waiting list/i);
    });

    it("enabled days with no times (the schema's defaults) are not hours of their own either", async () => {
        const { owner, svc, customer, solo } = await soloSetup({ hours: null });
        await StaffAvailability.create({ provider: owner._id, teamMember: solo._id }); // Mon–Fri on, no periods
        const named = await book(customer, svc, { teamMember: solo._id, startTime: '10:00', endTime: '10:30' });
        expect(named.status).toBe(400);
        expect(named.body.message).toMatch(/no working hours/i);
    });

    it('still refuses a genuine double-booking (the rule is hours-only)', async () => {
        const { svc, customer, solo } = await soloSetup();
        expect((await book(customer, svc, { startTime: '18:00', endTime: '18:30' })).status).toBe(201);
        // Second booking on the same member at the same time is a real clash, not hours.
        const clash = await book(customer, svc, { teamMember: solo._id, startTime: '18:00', endTime: '18:30' });
        expect(clash.status).toBe(409);
        expect(clash.body.message).toMatch(/already booked|waiting list/i);
    });

    it('still refuses approved leave (the rule is hours-only)', async () => {
        const { owner, svc, customer, solo } = await soloSetup();
        await request(app).post(`/api/team/${solo._id}/timeoff`).set(authHeader(owner))
            .send({ startDate: DATE, endDate: DATE, allDay: true });
        expect((await book(customer, svc, { startTime: '18:00', endTime: '18:30' })).status).toBe(400);
    });

    it('still refuses a slot outside the BUSINESS hours', async () => {
        const { svc, customer, solo } = await soloSetup();
        // 20:00 is past the shop's 19:00 close — business hours still gate it.
        expect((await book(customer, svc, { teamMember: solo._id, startTime: '20:00', endTime: '20:30' })).status).toBe(400);
    });

    it('a two-person roster: each works their own hours — a narrow-hours pair rejects outside them', async () => {
        const owner = await makeProvider();
        const svc = await makeService(owner._id);
        const customer = await makeUser();
        const m1 = await TeamMember.create({ provider: owner._id, name: 'One' });
        const m2 = await TeamMember.create({ provider: owner._id, name: 'Two' });
        await Availability.create({ provider: owner._id, schedule: everyDay('08:00', '19:00') });
        await StaffAvailability.create({ provider: owner._id, teamMember: m1._id, schedule: everyDay('09:00', '17:00') });
        await StaffAvailability.create({ provider: owner._id, teamMember: m2._id, schedule: everyDay('09:00', '17:00') });
        const res = await book(customer, svc, { startTime: '18:00', endTime: '18:30' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/waiting list/i);
    });
});

describe('Race guard (mirrors the existing concurrent-booking test)', () => {
    it('two concurrent bookings for the same staff member + slot: exactly one wins', async () => {
        const { svc, a } = await setup();
        const c1 = await makeUser();
        const c2 = await makeUser();
        const [r1, r2] = await Promise.all([
            book(c1, svc, { teamMember: a._id }),
            book(c2, svc, { teamMember: a._id }),
        ]);
        const statuses = [r1.status, r2.status].sort();
        expect(statuses).toEqual([201, 409]);
    });
});
