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
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const BlockedTime = require('../../models/BlockedTime');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

// 2026-08-05 is a Wednesday — a weekday for every default schedule.
const DATE = '2026-08-05';

const book = (asUser, svc, { teamMember, startTime = '10:00', endTime = '10:30' } = {}) =>
    request(app)
        .post('/api/appointments')
        .set(authHeader(asUser))
        .send({ service: svc._id.toString(), appointmentDate: DATE, startTime, endTime, teamMember });

const setup = async () => {
    const owner = await makeProvider();
    const svc = await makeService(owner._id);
    const customer = await makeUser();
    const a = await TeamMember.create({ provider: owner._id, name: 'Alice' });
    const b = await TeamMember.create({ provider: owner._id, name: 'Bob' });
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
        expect(double.status).toBe(400);
    });

    it("staff hours: a member's own schedule wins over business hours", async () => {
        const { owner, svc, customer, a } = await setup();
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
        expect(third.status).toBe(400);
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
        const { owner, svc, a } = await setup();
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
        expect(statuses).toEqual([201, 400]);
    });
});
