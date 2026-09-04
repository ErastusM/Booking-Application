/**
 * Batch 1 — regressions found by the post-deploy audit, in code shipped earlier
 * this session:
 *   1. The booking-race lock skipped the recurring branch, so a recurring
 *      booking's first occurrence could still double-book the same person.
 *   2. Reschedule recomputed endTime from Service.duration (ignoring a member's
 *      duration override / the booked span) and never moved multi-service
 *      segments, silently shrinking bookings and leaving phantom busy windows.
 *   3. Permanent team-member removal hard-deleted wallet-reserved bookings
 *      without releasing the hold, freezing the customer's prepaid funds.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');
const Wallet = require('../../models/Wallet');
const walletService = require('../../utils/walletService');

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
// A date comfortably in the future so past-slot / cancellation-window guards pass.
const DATE = '2026-12-16';

describe('Fix 1 — recurring booking no longer races on its first occurrence', () => {
    it('lets only ONE of two simultaneous recurring bookings win the anchor slot', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100, duration: 60 });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const a = await makeUser();
        const b = await makeUser();

        const bookRecurring = (customer) => request(app).post('/api/appointments').set(authHeader(customer)).send({
            service: svc._id.toString(), appointmentDate: DATE, startTime: '10:00', endTime: '11:00',
            isRecurring: true, recurrenceType: 'daily', recurrenceEndDate: '2026-12-18',
        });

        const [r1, r2] = await Promise.all([bookRecurring(a), bookRecurring(b)]);
        expect([r1.status, r2.status].sort()).toEqual([201, 400]); // one wins, one refused
        const anchorRows = await Appointment.countDocuments({
            provider: provider._id, teamMember: null, appointmentDate: new Date(DATE), startTime: '10:00', status: { $ne: 'cancelled' },
        });
        expect(anchorRows).toBe(1); // exactly one booking on the anchor slot
    });
});

describe('Fix 3 — reschedule preserves the booked length and shifts segments', () => {
    it('keeps the booked span (not Service.duration) when a booking is moved', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100, duration: 30 }); // catalogue = 30m
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const customer = await makeUser();
        // A 60-minute booking (e.g. a member duration override) — NOT the 30m default.
        const appt = await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: new Date(DATE), startTime: '10:00', endTime: '11:00', status: 'confirmed',
        });

        const res = await request(app).put(`/api/appointments/${appt._id}/reschedule`)
            .set(authHeader(customer)).send({ appointmentDate: DATE, startTime: '14:00' });

        expect(res.status).toBe(200);
        expect(res.body.data.startTime).toBe('14:00');
        expect(res.body.data.endTime).toBe('15:00'); // 60m span kept — NOT 14:30
    });

    it('shifts every multi-service segment by the same delta on reschedule', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100, duration: 30 });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const customer = await makeUser();
        const appt = await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: new Date(DATE), startTime: '10:00', endTime: '11:00', status: 'confirmed',
            services: [
                { service: svc._id, name: 'A', price: 50, duration: 30, startTime: '10:00', endTime: '10:30' },
                { service: svc._id, name: 'B', price: 50, duration: 30, startTime: '10:30', endTime: '11:00' },
            ],
        });

        const res = await request(app).put(`/api/appointments/${appt._id}/reschedule`)
            .set(authHeader(customer)).send({ appointmentDate: DATE, startTime: '14:00' });

        expect(res.status).toBe(200);
        const segs = res.body.data.services;
        expect(segs.map((s) => [s.startTime, s.endTime])).toEqual([
            ['14:00', '14:30'],
            ['14:30', '15:00'],
        ]);
    });
});

describe('Fix 2 — permanent removal releases wallet holds', () => {
    it('frees a customer\'s reserved funds when the member is removed', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 50, duration: 60 });
        const member = await TeamMember.create({ provider: provider._id, name: 'Erastus' });
        const customer = await makeUser();

        // Fund the wallet and reserve against an upcoming booking on the member.
        await Wallet.create({ customer: customer._id, provider: provider._id, totalBalance: 100, reservedBalance: 0 });
        const appt = await makeAppointment(customer._id, svc._id, provider._id, {
            teamMember: member._id, status: 'confirmed', paymentStatus: 'unpaid',
        });
        const reserved = await walletService.reserveFunds({
            customer: customer._id, provider: provider._id, amount: 50, appointmentId: appt._id,
        });
        expect(reserved.ok).toBe(true);
        expect((await Wallet.findOne({ customer: customer._id, provider: provider._id })).reservedBalance).toBe(50);

        // Permanently remove the member — the doomed booking is purged, its hold released.
        const res = await request(app).delete(`/api/team/${member._id}/permanent`).set(authHeader(provider));
        expect(res.status).toBe(200);

        expect(await Appointment.findById(appt._id)).toBeNull();            // booking purged
        const wallet = await Wallet.findOne({ customer: customer._id, provider: provider._id });
        expect(wallet.reservedBalance).toBe(0);                            // hold released — funds freed
    });
});
