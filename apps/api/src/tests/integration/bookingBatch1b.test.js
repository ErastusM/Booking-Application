/**
 * Batch 1b — finishing the booking-lock coverage found by the audit:
 *   - A multi-service ticket used to lock only on its PRIMARY member, so a
 *     second member appearing on a non-primary segment could be raced into a
 *     double-book. The lock now covers every distinct member the ticket touches.
 *   - Waiting-list promotion checked the freed slot and inserted outside the
 *     lock; it now runs both under the same per-member key (smoke-covered here
 *     by the still-correct "taken slot is skipped" path).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');
const { promoteFromWaitingList } = require('../../utils/waitingListHelper');
const WaitingList = require('../../models/WaitingList');

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
const DATE = '2026-12-16';

describe('Batch 1b — multi-service lock covers every segment member', () => {
    it('refuses a second concurrent ticket that shares a NON-primary segment member', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const s1 = await makeService(provider._id, { price: 50, duration: 30 });
        const s2 = await makeService(provider._id, { price: 50, duration: 30 });
        const alice = await TeamMember.create({ provider: provider._id, name: 'Alice' });
        await StaffAvailability.create({ provider: provider._id, teamMember: alice._id, schedule: everyDay('08:00', '19:00') });

        // Each ticket: segment 1 on the owner column (primary), segment 2 on Alice
        // (10:30–11:00). The old lock keyed only on the owner, so both tickets could
        // book Alice's 10:30 segment concurrently.
        const multi = () => request(app).post('/api/appointments/multi').set(authHeader(provider)).send({
            appointmentDate: DATE, startTime: '10:00', walkInName: 'Walk-in',
            services: [{ serviceId: s1._id.toString() }, { serviceId: s2._id.toString(), teamMember: alice._id.toString() }],
        });

        const [r1, r2] = await Promise.all([multi(), multi()]);
        expect([r1.status, r2.status].sort()).toEqual([201, 400]); // one wins, one refused
        const aliceBookings = await Appointment.countDocuments({ provider: provider._id, 'services.teamMember': alice._id });
        expect(aliceBookings).toBe(1); // Alice's 10:30 segment booked exactly once
    });
});

describe('Batch 1b — waitlist promotion will not book a slot that is taken', () => {
    it('skips promotion and keeps the customer waiting when the freed slot is already booked', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const svc = await makeService(provider._id, { price: 100, duration: 60 });
        const waiter = await makeUser();
        const other = await makeUser();

        // The owner column is already booked 10:00–11:00.
        await makeAppointment(other._id, svc._id, provider._id, {
            appointmentDate: new Date(DATE), startTime: '10:00', endTime: '11:00', status: 'confirmed', teamMember: null,
        });
        // Someone is waiting on exactly that slot.
        await WaitingList.create({
            customer: waiter._id, provider: provider._id, service: svc._id,
            appointmentDate: new Date(DATE), startTime: '10:00', endTime: '11:00', position: 1, status: 'waiting', teamMember: null,
        });

        await promoteFromWaitingList(svc._id, new Date(DATE), '10:00', '11:00');

        // No new booking for the waiter, and they're still in line (not promoted).
        const waiterBookings = await Appointment.countDocuments({ customer: waiter._id });
        expect(waiterBookings).toBe(0);
        const entry = await WaitingList.findOne({ customer: waiter._id });
        expect(entry.status).toBe('waiting');
    });
});
