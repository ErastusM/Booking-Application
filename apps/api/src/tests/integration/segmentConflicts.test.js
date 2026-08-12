/**
 * Multi-service segment conflicts.
 *
 * A multi-service booking splits across staff: each services[] entry has its own
 * teamMember and its own start/end, while the top-level teamMember is just the
 * first segment's performer. Every availability/conflict check used to look at
 * the top-level member and whole span only, so a member assigned ONLY a later
 * segment was invisible — a customer could be booked straight over them. These
 * pin that a segment performer is busy over their OWN segment, everywhere a
 * booking is validated, without falsely blocking a colleague who shares the
 * ticket.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Availability = require('../../models/Availability');
const { resolveBookingStaff } = require('../../utils/staffBooking');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => {
    const s = {};
    DAYS.forEach((d) => { s[d] = { enabled: true, slots: [{ start, end }] }; });
    return s;
};
const DATE = '2026-09-16';
const day = new Date(`${DATE}T00:00:00.000Z`);

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const svc = await makeService(provider._id, { duration: 30 });
    const alice = await TeamMember.create({ provider: provider._id, name: 'Alice' });
    const bob = await TeamMember.create({ provider: provider._id, name: 'Bob' });
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '20:00') });
    return { provider, customer, svc, alice, bob };
};

// One ticket, two staff: Alice 10:00–11:00, Bob 11:00–12:00. Top-level = Alice,
// so Bob is a SEGMENT-only performer — the case the old checks missed.
const makeStack = (ctx) => makeAppointment(ctx.customer._id, ctx.svc._id, ctx.provider._id, {
    teamMember: ctx.alice._id, status: 'confirmed', appointmentDate: day,
    startTime: '10:00', endTime: '12:00', totalPrice: 100,
    services: [
        { service: ctx.svc._id, name: 'A', price: 50, duration: 60, startTime: '10:00', endTime: '11:00', teamMember: ctx.alice._id },
        { service: ctx.svc._id, name: 'B', price: 50, duration: 60, startTime: '11:00', endTime: '12:00', teamMember: ctx.bob._id },
    ],
});

const tryBook = (ctx, member, startTime, endTime) => resolveBookingStaff({
    svc: ctx.svc, providerId: ctx.provider._id, appointmentDate: DATE, startTime, endTime,
    requestedTeamMember: member._id, requester: { role: 'customer', _id: ctx.customer._id },
});

const book = (ctx, member, startTime, endTime) => request(app)
    .post('/api/appointments').set(authHeader(ctx.customer))
    .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime, endTime, teamMember: member._id.toString() });

describe('a segment performer is busy over their own segment', () => {
    it('refuses booking the segment-only member during their segment', async () => {
        const ctx = await setup();
        await makeStack(ctx);
        // Bob works 11:00–12:00 as segment B though Alice is the ticket's top-level.
        expect((await tryBook(ctx, ctx.bob, '11:00', '11:30')).error).toMatch(/booked/i);
    });

    it('leaves the segment-only member free outside their segment', async () => {
        const ctx = await setup();
        await makeStack(ctx);
        expect((await tryBook(ctx, ctx.bob, '09:00', '09:30')).teamMember).toBeTruthy();
    });

    it('does not falsely block a colleague for the shared ticket span', async () => {
        const ctx = await setup();
        await makeStack(ctx);
        // Alice's segment ends at 11:00, so she is free at 11:00 even though the
        // ticket she leads runs to 12:00 — the per-segment point.
        expect((await tryBook(ctx, ctx.alice, '11:00', '11:30')).teamMember).toBeTruthy();
        // ...and busy inside her own segment.
        expect((await tryBook(ctx, ctx.alice, '10:30', '11:00')).error).toMatch(/booked/i);
    });
});

describe('the booking endpoints agree', () => {
    it('booked-slots reports the member\'s own segment, not the whole span', async () => {
        const ctx = await setup();
        await makeStack(ctx);
        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${ctx.provider._id}&date=${DATE}&teamMember=${ctx.bob._id}`);
        const appts = res.body.data.filter((b) => b.kind === 'appointment');
        expect(appts).toEqual([{ startTime: '11:00', endTime: '12:00', kind: 'appointment' }]);
    });

    it('refuses a customer booking the segment-only member during their segment', async () => {
        const ctx = await setup();
        await makeStack(ctx);
        expect((await book(ctx, ctx.bob, '11:00', '11:30')).status).toBe(400);
    });

    it('accepts a customer booking them outside it', async () => {
        const ctx = await setup();
        await makeStack(ctx);
        expect((await book(ctx, ctx.bob, '09:00', '09:30')).status).toBe(201);
    });

    it('refuses a reschedule onto a segment performer\'s busy time', async () => {
        const ctx = await setup();
        await makeStack(ctx);
        // A separate booking of Bob's, elsewhere, that we then try to move onto his segment.
        const other = await makeAppointment(ctx.customer._id, ctx.svc._id, ctx.provider._id, {
            teamMember: ctx.bob._id, status: 'confirmed', appointmentDate: day, startTime: '15:00', endTime: '15:30',
        });
        const res = await request(app)
            .put(`/api/appointments/${other._id}/reschedule`)
            .set(authHeader(ctx.customer))
            .send({ appointmentDate: DATE, startTime: '11:15' });
        expect(res.status).toBe(400);
    });
});
