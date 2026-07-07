/**
 * GET /api/providers/search — availability-first search. A provider only
 * appears when someone (staff column or owner) genuinely has an opening:
 * business hours minus bookings minus blocked time, staff-union semantics,
 * ?time= floor, ?q= narrowing by service or business name.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService } = require('../helpers/factories');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');
const BlockedTime = require('../../models/BlockedTime');
const TeamMember = require('../../models/TeamMember');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

// 2026-08-05 is a Wednesday — enabled in every default schedule, in the future.
const DATE = '2026-08-05';

const search = (params) => request(app).get('/api/providers/search').query(params);

const hours = (provider, day = 'wednesday', slots = [{ start: '09:00', end: '17:00' }], enabled = true) =>
    Availability.create({ provider: provider._id, schedule: { [day]: { enabled, slots } } });

const appt = async (provider, customer, service, startTime, endTime, teamMember) =>
    Appointment.create({
        customer: customer._id, service: service._id, provider: provider._id,
        appointmentDate: new Date(DATE), startTime, endTime, totalPrice: 50,
        status: 'confirmed', teamMember,
    });

describe('validation', () => {
    it('requires a well-formed date and time', async () => {
        expect((await search({})).status).toBe(400);
        expect((await search({ date: 'tomorrow' })).status).toBe(400);
        expect((await search({ date: DATE, time: '9am' })).status).toBe(400);
    });

    it('rejects past dates', async () => {
        expect((await search({ date: '2020-01-01' })).status).toBe(400);
    });
});

describe('single-column (no roster) providers', () => {
    it('returns real openings and absorbs existing bookings', async () => {
        const p = await makeProvider();
        const svc = await makeService(p._id);
        const customer = await makeUser();
        await hours(p);
        await appt(p, customer, svc, '09:00', '09:30');

        const res = await search({ date: DATE });
        expect(res.status).toBe(200);
        const hit = res.body.data.find(r => r.provider === p._id.toString());
        expect(hit).toBeDefined();
        expect(hit.openings[0]).toBe('09:30'); // 09:00 is taken
    });

    it('falls back to 08:00–20:00 when no hours were ever published', async () => {
        const p = await makeProvider();
        await makeService(p._id);

        const res = await search({ date: DATE });
        const hit = res.body.data.find(r => r.provider === p._id.toString());
        expect(hit.openings[0]).toBe('08:00');
    });

    it('excludes providers closed that weekday', async () => {
        const p = await makeProvider();
        await makeService(p._id);
        await hours(p, 'wednesday', [], false);

        const res = await search({ date: DATE });
        expect(res.body.data.find(r => r.provider === p._id.toString())).toBeUndefined();
    });
});

describe('staffed providers — union semantics', () => {
    it('a slot stays open while ANY staff column is free; business-wide blocks close it', async () => {
        const p = await makeProvider();
        const svc = await makeService(p._id);
        const customer = await makeUser();
        await hours(p, 'wednesday', [{ start: '10:00', end: '12:00' }]);
        const a = await TeamMember.create({ provider: p._id, name: 'Alice' });
        await TeamMember.create({ provider: p._id, name: 'Bob' });
        await appt(p, customer, svc, '10:00', '10:30', a._id); // Alice busy, Bob free

        let res = await search({ date: DATE });
        let hit = res.body.data.find(r => r.provider === p._id.toString());
        expect(hit.openings).toContain('10:00'); // Bob covers it

        await BlockedTime.create({ provider: p._id, date: DATE, startTime: '10:00', endTime: '11:00' });
        res = await search({ date: DATE });
        hit = res.body.data.find(r => r.provider === p._id.toString());
        expect(hit.openings[0]).toBe('11:00'); // business-wide block hits every column
    });

    it('vanishes entirely when every column is blocked all day', async () => {
        const p = await makeProvider();
        await makeService(p._id);
        await hours(p, 'wednesday', [{ start: '10:00', end: '11:00' }]);
        const a = await TeamMember.create({ provider: p._id, name: 'Alice' });
        await BlockedTime.create({ provider: p._id, teamMember: a._id, date: DATE, startTime: '10:00', endTime: '11:00' });

        const res = await search({ date: DATE });
        expect(res.body.data.find(r => r.provider === p._id.toString())).toBeUndefined();
    });
});

describe('filters and ordering', () => {
    it('?time= floors the openings', async () => {
        const p = await makeProvider();
        await makeService(p._id);
        await hours(p);

        const res = await search({ date: DATE, time: '15:00' });
        const hit = res.body.data.find(r => r.provider === p._id.toString());
        expect(hit.openings[0]).toBe('15:00');
        hit.openings.forEach(t => expect(t >= '15:00').toBe(true));
    });

    it('?q= matches service name or business name and excludes the rest', async () => {
        const barber = await makeProvider({ name: 'Fade Factory' });
        await makeService(barber._id, { name: 'Skin fade' });
        const spa = await makeProvider({ name: 'Calm Spa' });
        await makeService(spa._id, { name: 'Deep tissue massage' });
        await hours(barber); await hours(spa);

        const res = await search({ date: DATE, q: 'fade' });
        const ids = res.body.data.map(r => r.provider);
        expect(ids).toContain(barber._id.toString());
        expect(ids).not.toContain(spa._id.toString());
    });

    it('sorts by earliest opening', async () => {
        const early = await makeProvider();
        await makeService(early._id);
        await hours(early, 'wednesday', [{ start: '08:00', end: '12:00' }]);
        const late = await makeProvider();
        await makeService(late._id);
        await hours(late, 'wednesday', [{ start: '14:00', end: '18:00' }]);

        const res = await search({ date: DATE });
        const ids = res.body.data.map(r => r.provider);
        expect(ids.indexOf(early._id.toString())).toBeLessThan(ids.indexOf(late._id.toString()));
    });
});
