/**
 * The waiting list books the person who actually does the service, at THEIR price.
 *
 * It used to promote every "owner / anyone" waiter onto the owner's column at
 * the service's price — so a client waiting on a driver's own trip was booked
 * with the OWNER at the driver's price, the same leak the booking page had.
 * Joining now names the professional the client picked (validated like a
 * booking), and promotion applies the booking's performer rules.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { futureDate } = require('../helpers/dates');
const { makeProvider, makeUser, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');
const WaitingList = require('../../models/WaitingList');
const { promoteFromWaitingList } = require('../../utils/waitingListHelper');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => Object.fromEntries(DAYS.map((d) => [d, { enabled: true, slots: [{ start, end }] }]));
const DATE = futureDate(1);
const DAY = new Date(`${DATE}T00:00:00.000Z`);

const setup = async () => {
    const owner = await makeProvider({ name: 'Vido Barber' });
    await Availability.create({ provider: owner._id, schedule: everyDay('06:00', '22:00') });
    const trim = await makeService(owner._id, { name: 'Trim', price: 70, duration: 60 });
    // Only Erastus does trips; the row's price is his.
    const trip = await makeService(owner._id, { name: 'Airport run', price: 900, duration: 60, ownerPerforms: false });
    const erastus = await TeamMember.create({
        provider: owner._id, name: 'Erastus', offersAllServices: false, services: [trip._id, trim._id],
        serviceOverrides: [{ service: trim._id, price: 95, duration: null }],
    });
    const john = await TeamMember.create({ provider: owner._id, name: 'John', offersAllServices: false, services: [trim._id] });
    await StaffAvailability.create({ provider: owner._id, teamMember: erastus._id, schedule: everyDay('06:00', '22:00') });
    await StaffAvailability.create({ provider: owner._id, teamMember: john._id, schedule: everyDay('06:00', '22:00') });
    const customer = await makeUser({ name: 'Ndapewa Client' });
    return { owner, trim, trip, erastus, john, customer };
};
const wait = (ctx, svc, teamMember = null) => WaitingList.create({
    service: svc._id, provider: ctx.owner._id, customer: ctx.customer._id, teamMember,
    appointmentDate: DAY, startTime: '10:00', endTime: '11:00', position: 1, status: 'waiting',
});
const promote = (svc) => promoteFromWaitingList(svc._id, DAY, '10:00', '11:00');
const promoted = (ctx) => Appointment.findOne({ customer: ctx.customer._id }).lean();

describe('promotion from the waiting list', () => {
    it('an "owner / anyone" waiter for a team-only service is booked with the member who does it, at their price', async () => {
        const ctx = await setup();
        await wait(ctx, ctx.trip, null);
        await promote(ctx.trip);
        const appt = await promoted(ctx);
        expect(String(appt.teamMember)).toBe(String(ctx.erastus._id));
        expect(appt.totalPrice).toBe(900);
    });

    it('…and not at all when that member is busy — the client keeps their place', async () => {
        const ctx = await setup();
        const other = await makeUser({ name: 'Other Client' });
        await Appointment.create({
            customer: other._id, provider: ctx.owner._id, service: ctx.trip._id, teamMember: ctx.erastus._id,
            appointmentDate: DAY, startTime: '10:00', endTime: '11:00', status: 'confirmed', totalPrice: 900,
        });
        await wait(ctx, ctx.trip, null);
        await promote(ctx.trip);
        expect(await promoted(ctx)).toBeNull();
        expect((await WaitingList.findOne({ customer: ctx.customer._id })).status).toBe('waiting');
        expect(await Appointment.countDocuments({ teamMember: null })).toBe(0); // never the owner
    });

    it('the owner\'s own service still promotes onto the owner, at the owner\'s price', async () => {
        const ctx = await setup();
        await wait(ctx, ctx.trim, null);
        await promote(ctx.trim);
        const appt = await promoted(ctx);
        expect(appt.teamMember).toBeNull();
        expect(appt.totalPrice).toBe(70);
    });

    it('a waiter on a named member is booked at that member\'s own price', async () => {
        const ctx = await setup();
        await wait(ctx, ctx.trim, ctx.erastus._id);
        await promote(ctx.trim);
        const appt = await promoted(ctx);
        expect(String(appt.teamMember)).toBe(String(ctx.erastus._id));
        expect(appt.totalPrice).toBe(95);
    });

    it('a named member who no longer does the service is not booked for it', async () => {
        const ctx = await setup();
        await wait(ctx, ctx.trip, ctx.john._id);
        await promote(ctx.trip);
        expect(await promoted(ctx)).toBeNull();
        expect((await WaitingList.findOne({ customer: ctx.customer._id })).status).toBe('waiting');
    });
});

describe('joining the waiting list', () => {
    // The 10:00 slot is taken with everyone, so it can be waited on.
    const fill = async (ctx) => {
        const other = await makeUser({ name: 'Other Client' });
        for (const teamMember of [null, ctx.erastus._id, ctx.john._id]) {
            await Appointment.create({
                customer: other._id, provider: ctx.owner._id, service: ctx.trim._id, teamMember,
                appointmentDate: DAY, startTime: '10:00', endTime: '11:00', status: 'confirmed', totalPrice: 70,
            });
        }
    };
    const join = (ctx, svc, teamMember) => request(app).post('/api/waitinglist').set(authHeader(ctx.customer))
        .send({ service: String(svc._id), appointmentDate: DATE, startTime: '10:00', endTime: '11:00', ...(teamMember ? { teamMember: String(teamMember) } : {}) });

    it('records the professional the client picked', async () => {
        const ctx = await setup();
        await fill(ctx);
        const res = await join(ctx, ctx.trip, ctx.erastus._id);
        expect(res.status).toBe(201);
        expect(String((await WaitingList.findOne({ customer: ctx.customer._id })).teamMember)).toBe(String(ctx.erastus._id));
    });

    it('refuses a professional who doesn\'t do the service, or isn\'t at this business', async () => {
        const ctx = await setup();
        await fill(ctx);
        expect((await join(ctx, ctx.trip, ctx.john._id)).status).toBe(400);
        const elsewhere = await TeamMember.create({ provider: (await makeProvider())._id, name: 'Stranger', offersAllServices: true });
        expect((await join(ctx, ctx.trip, elsewhere._id)).status).toBe(400);
        expect(await WaitingList.countDocuments({ customer: ctx.customer._id })).toBe(0);
    });

    it('refuses to wait on the owner / anyone for a service nobody performs', async () => {
        const ctx = await setup();
        await fill(ctx);
        await TeamMember.updateOne({ _id: ctx.erastus._id }, { $set: { services: [ctx.trim._id] } });
        expect((await join(ctx, ctx.trip, null)).status).toBe(400);
        expect((await join(ctx, ctx.trip, 'owner')).status).toBe(400);
    });
});
