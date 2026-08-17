/**
 * Staff-aware "any professional" slot view.
 *
 * With no member picked, booked-slots used to return business hours minus every
 * booking in the building — advertising hours nobody works (the booking was then
 * refused with "no staff available") and greying hours where one member was
 * booked but a colleague was free. Passing the service id now makes the server
 * union the availability of everyone who performs it. These pin that the view
 * and the booking validator agree: a slot is shown open iff booking it succeeds.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const Shift = require('../../models/Shift');
const BlockedTime = require('../../models/BlockedTime');

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
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
// Is [s,e) covered as busy by any entry of the given kinds?
const busyAt = (data, kinds, s, e) => data.some((b) => kinds.includes(b.kind) && mins(b.startTime) < e && mins(b.endTime) > s);

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const svc = await makeService(provider._id, { duration: 30 });
    // Business open 08:00–19:00; both stylists' weekly pattern ends at 17:00.
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
    const alice = await TeamMember.create({ provider: provider._id, name: 'Alice' });
    const bob = await TeamMember.create({ provider: provider._id, name: 'Bob' });
    await StaffAvailability.create({ provider: provider._id, teamMember: alice._id, schedule: everyDay('09:00', '17:00') });
    await StaffAvailability.create({ provider: provider._id, teamMember: bob._id, schedule: everyDay('09:00', '17:00') });
    return { provider, customer, svc, alice, bob };
};

const slots = (ctx) => request(app)
    .get(`/api/appointments/booked-slots?providerId=${ctx.provider._id}&date=${DATE}&service=${ctx.svc._id}`)
    .then((res) => res.body.data);

const bookAny = (ctx, startTime, endTime) => request(app)
    .post('/api/appointments').set(authHeader(ctx.customer))
    .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime, endTime });

describe('hours come from the staff who actually work them', () => {
    it('marks hours nobody works as unavailable — and booking there is refused', async () => {
        const ctx = await setup();
        const data = await slots(ctx);
        // 17:00–19:00 is inside business hours but past both weekly patterns.
        expect(busyAt(data, ['off_shift'], mins('17:00'), mins('19:00'))).toBe(true);
        // The rostered morning is open.
        expect(busyAt(data, ['off_shift', 'appointment'], mins('10:00'), mins('10:30'))).toBe(false);
        expect((await bookAny(ctx, '18:00', '18:30')).status).toBe(400);
    });

    it("a member's shift opens the evening for the whole view — and booking succeeds", async () => {
        const ctx = await setup();
        await Shift.create({ provider: ctx.provider._id, teamMember: ctx.bob._id, date: DATE, slots: [{ start: '12:00', end: '20:00' }] });
        const data = await slots(ctx);
        // Bob covers 17:00–19:00 now (capped at business close for "any").
        expect(busyAt(data, ['off_shift', 'appointment'], mins('17:00'), mins('19:00'))).toBe(false);
        expect((await bookAny(ctx, '18:00', '18:30')).status).toBe(201);
    });
});

describe('one member booked does not grey the hour a colleague can take', () => {
    it('stays open while a colleague is free, goes busy when everyone is taken', async () => {
        const ctx = await setup();
        await makeAppointment(ctx.customer._id, ctx.svc._id, ctx.provider._id, {
            teamMember: ctx.alice._id, status: 'confirmed', appointmentDate: day, startTime: '10:00', endTime: '11:00',
        });
        let data = await slots(ctx);
        expect(busyAt(data, ['appointment'], mins('10:00'), mins('11:00'))).toBe(false); // Bob is free
        expect((await bookAny(ctx, '10:00', '10:30')).status).toBe(201);                 // lands on Bob

        await makeAppointment(ctx.customer._id, ctx.svc._id, ctx.provider._id, {
            teamMember: ctx.bob._id, status: 'confirmed', appointmentDate: day, startTime: '10:30', endTime: '11:00',
        });
        data = await slots(ctx);
        // 10:30–11:00 now has Alice's booking AND Bob's — genuinely taken → waitlist kind.
        expect(busyAt(data, ['appointment'], mins('10:30'), mins('11:00'))).toBe(true);
        const full = await bookAny(ctx, '10:30', '11:00');
        expect(full.status).toBe(400);
        expect(full.body.message).toMatch(/waiting list/i);
    });
});

describe('leave and blocked time', () => {
    it("one member's approved leave leaves the day open via the colleague; everyone's closes it", async () => {
        const ctx = await setup();
        await request(app).post(`/api/team/${ctx.alice._id}/timeoff`).set(authHeader(ctx.provider))
            .send({ startDate: DATE, endDate: DATE, allDay: true });
        let data = await slots(ctx);
        expect(busyAt(data, ['off_shift', 'appointment'], mins('10:00'), mins('10:30'))).toBe(false);

        await request(app).post(`/api/team/${ctx.bob._id}/timeoff`).set(authHeader(ctx.provider))
            .send({ startDate: DATE, endDate: DATE, allDay: true });
        data = await slots(ctx);
        expect(busyAt(data, ['off_shift'], mins('10:00'), mins('10:30'))).toBe(true);
        expect(busyAt(data, ['appointment'], mins('09:00'), mins('17:00'))).toBe(false); // nobody to wait for
        expect((await bookAny(ctx, '10:00', '10:30')).status).toBe(400);
    });

    it("a member's own block defers to the colleague; a business-wide block closes the window", async () => {
        const ctx = await setup();
        await BlockedTime.create({ provider: ctx.provider._id, teamMember: ctx.alice._id, date: DATE, startTime: '10:00', endTime: '11:00' });
        let data = await slots(ctx);
        expect(busyAt(data, ['off_shift', 'blocked'], mins('10:00'), mins('11:00'))).toBe(false);
        expect((await bookAny(ctx, '10:00', '10:30')).status).toBe(201); // Bob takes it

        await BlockedTime.create({ provider: ctx.provider._id, date: DATE, startTime: '12:00', endTime: '13:00' });
        data = await slots(ctx);
        expect(busyAt(data, ['blocked'], mins('12:00'), mins('13:00'))).toBe(true);
        // Closed-for-everyone is "Unavailable", never "Taken" — no waitlist bait.
        expect(busyAt(data, ['appointment'], mins('12:00'), mins('13:00'))).toBe(false);
    });
});

describe('fallbacks stay exactly as before', () => {
    it('owner-fallback (nobody performs the service) keeps the legacy provider-wide view', async () => {
        const ctx = await setup();
        const otherSvc = await makeService(ctx.provider._id, { name: 'Other' });
        await TeamMember.updateMany({ provider: ctx.provider._id }, { $set: { services: [otherSvc._id] } });
        // An owner-column booking greys its span, exactly like before.
        await makeAppointment(ctx.customer._id, ctx.svc._id, ctx.provider._id, {
            status: 'confirmed', appointmentDate: day, startTime: '10:00', endTime: '11:00',
        });
        const data = await slots(ctx);
        expect(busyAt(data, ['appointment'], mins('10:00'), mins('11:00'))).toBe(true);
        expect(data.some((b) => b.kind === 'off_shift')).toBe(false); // legacy view has no union entries
    });

    it("solo owner: business hours govern — their narrow weekly pattern doesn't close the evening (#121 parity)", async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const svc = await makeService(provider._id, { duration: 30 });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const solo = await TeamMember.create({ provider: provider._id, name: 'Owner Themself' });
        await StaffAvailability.create({ provider: provider._id, teamMember: solo._id, schedule: everyDay('09:00', '17:00') });

        const data = await slots({ provider, svc });
        expect(busyAt(data, ['off_shift', 'appointment'], mins('08:00'), mins('19:00'))).toBe(false);
        expect((await bookAny({ customer, svc }, '18:00', '18:30')).status).toBe(201);
    });
});
