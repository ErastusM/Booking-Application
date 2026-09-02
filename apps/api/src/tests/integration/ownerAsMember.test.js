/**
 * Owner-as-member: once a business has a roster, the OWNER is offered to
 * customers as a bookable professional ("you") alongside staff. The owner has no
 * TeamMember row — their column is the unassigned one (teamMember:null) — so the
 * public staff list synthesizes an 'owner' entry and the booking flow maps it to
 * null. Solo businesses (no staff) keep the owner-implicit flow with no tile.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');

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
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const busyAt = (data, kinds, s, e) => data.some((b) => kinds.includes(b.kind) && mins(b.startTime) < e && mins(b.endTime) > s);

const staffList = (provider) => request(app).get(`/api/providers/${provider._id}/staff`).then((r) => r.body.data);
const ownerSlots = (provider) => request(app)
    .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=owner`).then((r) => r.body.data);
const memberSlots = (provider, member) => request(app)
    .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=${member._id}`).then((r) => r.body.data);
const bookOwner = (customer, svc, startTime, endTime) => request(app)
    .post('/api/appointments').set(authHeader(customer))
    .send({ service: svc._id.toString(), appointmentDate: DATE, startTime, endTime, teamMember: 'owner' });

const setup = async () => {
    const provider = await makeProvider({ name: 'Stark' });
    const customer = await makeUser();
    const svc = await makeService(provider._id, { price: 100, duration: 60 });
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
    const alice = await TeamMember.create({ provider: provider._id, name: 'Alice' });
    await StaffAvailability.create({ provider: provider._id, teamMember: alice._id, schedule: everyDay('08:00', '19:00') });
    return { provider, customer, svc, alice };
};

describe('owner as a bookable professional', () => {
    it('appears FIRST in the staff list once a roster exists', async () => {
        const ctx = await setup();
        const list = await staffList(ctx.provider);
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({ _id: 'owner', isOwner: true, name: 'Stark' });
        expect(list[1].name).toBe('Alice');
    });

    it('a solo business (no staff) shows no owner tile', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        expect(await staffList(provider)).toHaveLength(0);
    });

    it('books the owner (stored unassigned) at the business price', async () => {
        const ctx = await setup();
        const booked = await bookOwner(ctx.customer, ctx.svc, '10:00', '11:00');
        expect(booked.status).toBe(201);
        expect(booked.body.data.teamMember == null).toBe(true); // owner column = unassigned
        expect(booked.body.data.totalPrice).toBe(100);
    });

    it("the owner's slots reflect the owner's OWN bookings, not a staff member's", async () => {
        const ctx = await setup();
        // Book Alice 10:00–11:00.
        await request(app).post('/api/appointments').set(authHeader(ctx.customer))
            .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime: '10:00', endTime: '11:00', teamMember: ctx.alice._id.toString() });

        // The owner is still free then — Alice's booking is not the owner's.
        expect(busyAt(await ownerSlots(ctx.provider), ['appointment'], mins('10:00'), mins('11:00'))).toBe(false);
        expect((await bookOwner(ctx.customer, ctx.svc, '10:00', '11:00')).status).toBe(201);

        // Now the owner IS booked then; a second owner booking is refused, but Alice's slot view is unaffected.
        expect(busyAt(await ownerSlots(ctx.provider), ['appointment'], mins('10:00'), mins('11:00'))).toBe(true);
        expect(busyAt(await memberSlots(ctx.provider, ctx.alice), ['appointment'], mins('11:00'), mins('12:00'))).toBe(false);
    });
});
