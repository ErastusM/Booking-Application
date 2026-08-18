/**
 * POST /api/team/:id/handover — move a member's upcoming book to a colleague.
 *
 * Built for the "clients booked the wrong person" recovery: every upcoming
 * pending/confirmed booking moves to the target unless it would double-book
 * them (those are skipped and reported, never force-stacked). Multi-service
 * tickets flip only the source member's segments. Past/cancelled bookings and
 * other members' work never move.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Appointment = require('../../models/Appointment');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DATE = '2026-09-16';
const day = new Date(`${DATE}T00:00:00.000Z`);

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const svc = await makeService(provider._id, { duration: 30 });
    const erastus = await TeamMember.create({ provider: provider._id, name: 'Erastus' });
    const stark = await TeamMember.create({ provider: provider._id, name: 'Stark' });
    return { provider, customer, svc, erastus, stark };
};

const bookFor = (ctx, member, startTime, endTime, overrides = {}) => makeAppointment(
    ctx.customer._id, ctx.svc._id, ctx.provider._id,
    { teamMember: member._id, status: 'confirmed', appointmentDate: day, startTime, endTime, ...overrides },
);

const handover = (ctx, fromId, toId) => request(app)
    .post(`/api/team/${fromId}/handover`).set(authHeader(ctx.provider))
    .send({ to: toId });

describe('moving the book', () => {
    it('moves every upcoming booking to the target', async () => {
        const ctx = await setup();
        const a = await bookFor(ctx, ctx.erastus, '10:00', '10:30');
        const b = await bookFor(ctx, ctx.erastus, '14:00', '14:30', { status: 'pending' });

        const res = await handover(ctx, ctx.erastus._id, ctx.stark._id.toString());
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ moved: 2, total: 2 });
        expect(res.body.data.skipped).toHaveLength(0);

        expect(String((await Appointment.findById(a._id)).teamMember)).toBe(String(ctx.stark._id));
        expect(String((await Appointment.findById(b._id)).teamMember)).toBe(String(ctx.stark._id));
    });

    it('skips (and reports) a booking that would double-book the target', async () => {
        const ctx = await setup();
        await bookFor(ctx, ctx.stark, '10:00', '10:30'); // Stark's own client
        const clashing = await bookFor(ctx, ctx.erastus, '10:15', '10:45');
        const clean = await bookFor(ctx, ctx.erastus, '12:00', '12:30');

        const res = await handover(ctx, ctx.erastus._id, ctx.stark._id.toString());
        expect(res.body.data).toMatchObject({ moved: 1, total: 2 });
        expect(res.body.data.skipped).toEqual([
            expect.objectContaining({ date: DATE, startTime: '10:15', reason: 'conflict' }),
        ]);

        // The clash stays where it was; the clean one moved.
        expect(String((await Appointment.findById(clashing._id)).teamMember)).toBe(String(ctx.erastus._id));
        expect(String((await Appointment.findById(clean._id)).teamMember)).toBe(String(ctx.stark._id));
    });

    it('a moved booking blocks later ones in the same run (no self-stacking)', async () => {
        const ctx = await setup();
        // Two of Erastus's bookings overlap each other (created before segment
        // checks, or via owner override). Only one can land on Stark.
        await bookFor(ctx, ctx.erastus, '10:00', '10:30');
        await bookFor(ctx, ctx.erastus, '10:00', '10:30');

        const res = await handover(ctx, ctx.erastus._id, ctx.stark._id.toString());
        expect(res.body.data.moved).toBe(1);
        expect(res.body.data.skipped).toHaveLength(1);
    });

    it('flips only the source segments of a multi-service ticket; top-level follows the first segment', async () => {
        const ctx = await setup();
        const third = await TeamMember.create({ provider: ctx.provider._id, name: 'Colleague' });
        const stack = await makeAppointment(ctx.customer._id, ctx.svc._id, ctx.provider._id, {
            teamMember: ctx.erastus._id, status: 'confirmed', appointmentDate: day,
            startTime: '10:00', endTime: '12:00', totalPrice: 100,
            services: [
                { service: ctx.svc._id, name: 'A', price: 50, duration: 60, startTime: '10:00', endTime: '11:00', teamMember: ctx.erastus._id },
                { service: ctx.svc._id, name: 'B', price: 50, duration: 60, startTime: '11:00', endTime: '12:00', teamMember: third._id },
            ],
        });

        const res = await handover(ctx, ctx.erastus._id, ctx.stark._id.toString());
        expect(res.body.data.moved).toBe(1);

        const after = await Appointment.findById(stack._id);
        expect(String(after.services[0].teamMember)).toBe(String(ctx.stark._id));
        expect(String(after.services[1].teamMember)).toBe(String(third._id)); // untouched
        expect(String(after.teamMember)).toBe(String(ctx.stark._id));
    });

    it('leaves past and cancelled bookings alone', async () => {
        const ctx = await setup();
        const past = await bookFor(ctx, ctx.erastus, '10:00', '10:30', { appointmentDate: new Date('2026-08-01T00:00:00.000Z') });
        const cancelled = await bookFor(ctx, ctx.erastus, '11:00', '11:30', { status: 'cancelled' });

        const res = await handover(ctx, ctx.erastus._id, ctx.stark._id.toString());
        expect(res.body.data).toMatchObject({ moved: 0, total: 0 });

        expect(String((await Appointment.findById(past._id)).teamMember)).toBe(String(ctx.erastus._id));
        expect(String((await Appointment.findById(cancelled._id)).teamMember)).toBe(String(ctx.erastus._id));
    });
});

describe('authorization and validation', () => {
    it("404s on another provider's member", async () => {
        const ctx = await setup();
        const other = await makeProvider();
        const theirMember = await TeamMember.create({ provider: other._id, name: 'Theirs' });
        expect((await handover(ctx, theirMember._id, ctx.stark._id.toString())).status).toBe(404);
    });

    it('400s on an inactive or unknown target', async () => {
        const ctx = await setup();
        await TeamMember.updateOne({ _id: ctx.stark._id }, { isActive: false });
        expect((await handover(ctx, ctx.erastus._id, ctx.stark._id.toString())).status).toBe(400);
    });

    it('400s on handing over to the same member', async () => {
        const ctx = await setup();
        expect((await handover(ctx, ctx.erastus._id, ctx.erastus._id.toString())).status).toBe(400);
    });

    it('is provider-only', async () => {
        const ctx = await setup();
        const res = await request(app)
            .post(`/api/team/${ctx.erastus._id}/handover`).set(authHeader(ctx.customer))
            .send({ to: ctx.stark._id.toString() });
        expect(res.status).toBe(403);
    });
});
