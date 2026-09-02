/**
 * Per-member price/duration overrides.
 *
 * A team member inherits the business's Service price/duration unless they set
 * their own (TeamMember.serviceOverrides) — Erastus N$170, John N$200 for the
 * same service. The override must drive the recorded price AND the length the
 * booking window is validated against.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');

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

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const svc = await makeService(provider._id, { price: 100, duration: 60 });
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
    const alice = await TeamMember.create({ provider: provider._id, name: 'Alice' });
    await StaffAvailability.create({ provider: provider._id, teamMember: alice._id, schedule: everyDay('08:00', '19:00') });
    return { provider, customer, svc, alice };
};

const book = (ctx, member, startTime, endTime) => request(app)
    .post('/api/appointments').set(authHeader(ctx.customer))
    .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime, endTime, teamMember: member._id.toString() });

const setPricing = (ctx, member, serviceOverrides) => request(app)
    .put(`/api/team/${member._id}/pricing`).set(authHeader(ctx.provider))
    .send({ serviceOverrides });

describe('per-member price/duration overrides', () => {
    it('a member override drives the booked price and the allowed length', async () => {
        const ctx = await setup();
        const r = await setPricing(ctx, ctx.alice, [{ service: ctx.svc._id.toString(), price: 170, duration: 45 }]);
        expect(r.status).toBe(200);

        const booked = await book(ctx, ctx.alice, '09:00', '09:45'); // the member's 45 min
        expect(booked.status).toBe(201);
        expect(booked.body.data.totalPrice).toBe(170);
    });

    it("rejects the business default length once the member has their own duration", async () => {
        const ctx = await setup();
        await setPricing(ctx, ctx.alice, [{ service: ctx.svc._id.toString(), duration: 45 }]);
        // 60 min is the business default, but the member does this in 45 — booking
        // the longer window would under-reserve nothing but must not be accepted as
        // "matching the service length" for this member.
        const booked = await book(ctx, ctx.alice, '09:00', '10:00');
        expect(booked.status).toBe(400);
    });

    it('inherits the business price and duration when the member has no override', async () => {
        const ctx = await setup();
        const booked = await book(ctx, ctx.alice, '09:00', '10:00'); // default 60 min
        expect(booked.status).toBe(201);
        expect(booked.body.data.totalPrice).toBe(100);
    });

    it('rejects an override for a service the business does not own', async () => {
        const ctx = await setup();
        const other = await makeProvider();
        const foreignSvc = await makeService(other._id, { price: 50, duration: 30 });
        const r = await setPricing(ctx, ctx.alice, [{ service: foreignSvc._id.toString(), price: 10 }]);
        expect(r.status).toBe(400);
    });

    it('a blank override row is dropped (pure inherit), not stored', async () => {
        const ctx = await setup();
        const r = await setPricing(ctx, ctx.alice, [{ service: ctx.svc._id.toString(), price: '', duration: '' }]);
        expect(r.status).toBe(200);
        const fresh = await TeamMember.findById(ctx.alice._id).lean();
        expect(fresh.serviceOverrides).toHaveLength(0);
    });
});
