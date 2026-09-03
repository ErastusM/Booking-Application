/**
 * Concurrency: the overlap-check + insert must be atomic, or two bookings that
 * arrive at nearly the same instant BOTH pass "is the slot free?" before either
 * writes, and BOTH insert — a same-person double-book (seen in production on the
 * owner/null column: "the app blocked me, but after I refreshed it went
 * through"). The booking lock (utils/lock.withBookingLock) serializes per
 * provider+member+day so the loser waits, re-checks, and is refused.
 *
 * These fire two overlapping bookings concurrently and assert exactly ONE wins
 * and exactly ONE row lands on the slot. Without the lock both would return 201.
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

const book = (customer, svc, provider, startTime, endTime, teamMember) => {
    const body = { service: svc._id.toString(), appointmentDate: DATE, startTime, endTime };
    if (teamMember !== undefined) body.teamMember = teamMember;
    return request(app).post('/api/appointments').set(authHeader(customer)).send(body);
};

describe('concurrent booking of the same slot', () => {
    it('lets only ONE of two simultaneous OWNER-column bookings win', async () => {
        const provider = await makeProvider(); // solo business: owner column = teamMember null
        const svc = await makeService(provider._id, { price: 100, duration: 60 });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const a = await makeUser();
        const b = await makeUser();

        // Two different clients, same 10:00–11:00 slot on the owner, fired together.
        const [r1, r2] = await Promise.all([
            book(a, svc, provider, '10:00', '11:00'),
            book(b, svc, provider, '10:00', '11:00'),
        ]);

        const statuses = [r1.status, r2.status].sort();
        expect(statuses).toEqual([201, 400]); // exactly one wins, one refused
        const rows = await Appointment.countDocuments({
            provider: provider._id, teamMember: null, startTime: '10:00', status: { $ne: 'cancelled' },
        });
        expect(rows).toBe(1); // and only ONE booking actually landed
    });

    it('lets only ONE of two simultaneous bookings win for a NAMED member', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100, duration: 60 });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const member = await TeamMember.create({ provider: provider._id, name: 'Erastus' });
        await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: everyDay('08:00', '19:00') });
        const a = await makeUser();
        const b = await makeUser();

        const mid = member._id.toString();
        const [r1, r2] = await Promise.all([
            book(a, svc, provider, '14:00', '15:00', mid),
            book(b, svc, provider, '14:00', '15:00', mid),
        ]);

        expect([r1.status, r2.status].sort()).toEqual([201, 400]);
        const rows = await Appointment.countDocuments({
            provider: provider._id, teamMember: member._id, startTime: '14:00', status: { $ne: 'cancelled' },
        });
        expect(rows).toBe(1);
    });

    it('still lets two NON-overlapping bookings for the same member both succeed', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100, duration: 60 });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const a = await makeUser();
        const b = await makeUser();

        // The lock serializes the same member's day, but non-overlapping times
        // must BOTH go through — the lock is about correctness, not throughput.
        const [r1, r2] = await Promise.all([
            book(a, svc, provider, '10:00', '11:00'),
            book(b, svc, provider, '11:00', '12:00'),
        ]);
        expect(r1.status).toBe(201);
        expect(r2.status).toBe(201);
        const rows = await Appointment.countDocuments({
            provider: provider._id, teamMember: null, status: { $ne: 'cancelled' },
        });
        expect(rows).toBe(2);
    });
});
