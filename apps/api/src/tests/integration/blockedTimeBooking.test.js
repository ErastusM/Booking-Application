/**
 * Blocked time must actually block.
 *
 * Regression cover for a live production bug: a solo provider (no team members)
 * blocked 18:00–19:00, but the slot still showed as free to customers AND the
 * booking saved successfully, so a client landed on top of the provider's
 * blocked time. Blocked time was only ever consulted by the per-staff resolver,
 * which returns early when a business has no staff.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const BlockedTime = require('../../models/BlockedTime');
const Appointment = require('../../models/Appointment');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduledClient: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A weekday at least 3 days out — inside the default availability schedule
// (weekends disabled) and clear of the 24h cancellation window.
const soonWeekday = () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const block = (providerId, date, startTime, endTime, extra = {}) =>
    BlockedTime.create({ provider: providerId, date, startTime, endTime, reason: 'Lunch', ...extra });

describe('blocked time blocks booking (solo provider, no staff)', () => {
    it('rejects a customer booking that overlaps a blocked time', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const date = soonWeekday();
        await block(provider._id, date, '13:00', '14:00');

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '13:00', endTime: '14:00' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/not available/i);
        expect(await Appointment.countDocuments()).toBe(0);
    });

    it('rejects a booking that only partially overlaps a blocked time', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const date = soonWeekday();
        await block(provider._id, date, '13:00', '14:00');

        // 12:30–13:30 straddles the start of the block.
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '12:30', endTime: '13:30' });

        expect(res.status).toBe(400);
        expect(await Appointment.countDocuments()).toBe(0);
    });

    it('allows a booking that merely touches the block boundary', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const date = soonWeekday();
        await block(provider._id, date, '13:00', '14:00');

        // Ends exactly when the block starts — no real overlap.
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '12:00', endTime: '13:00' });

        expect(res.status).toBe(201);
    });

    it('rejects a guest booking over blocked time too', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const date = soonWeekday();
        await block(provider._id, date, '13:00', '14:00');

        const res = await request(app)
            .post('/api/appointments')
            .send({
                service: svc._id.toString(), appointmentDate: date, startTime: '13:00', endTime: '14:00',
                guestName: 'Jaylen Steyn', guestEmail: 'jaylen@example.com',
            });

        expect(res.status).toBe(400);
        expect(await Appointment.countDocuments()).toBe(0);
    });

    it('blocks a RECURRING occurrence on a later date, not just the first', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const date = soonWeekday();

        // Recurring blocks are materialised one doc per occurrence, so a later
        // occurrence must block exactly like the first.
        await block(provider._id, date, '13:00', '14:00', {
            isRecurring: true, recurrenceType: 'weekly', recurrenceGroupId: 'grp-1',
        });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '13:00', endTime: '14:00' });

        expect(res.status).toBe(400);
    });

    it('still lets the PROVIDER book their own blocked time (walk-in override)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const date = soonWeekday();
        await block(provider._id, date, '13:00', '14:00');

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(provider))
            .send({
                service: svc._id.toString(), appointmentDate: date,
                startTime: '13:00', endTime: '14:00', walkInName: 'Walk-in client',
            });

        expect(res.status).toBe(201);
    });

    it('does not block a different provider on the same date/time', async () => {
        const customer = await makeUser();
        const blockedProvider = await makeProvider();
        const otherProvider = await makeProvider();
        const svc = await makeService(otherProvider._id, { duration: 60 });
        const date = soonWeekday();
        await block(blockedProvider._id, date, '13:00', '14:00');

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '13:00', endTime: '14:00' });

        expect(res.status).toBe(201);
    });
});

describe('GET /api/appointments/booked-slots exposes blocked time', () => {
    it('returns blocked ranges alongside appointments so the slot list can grey them out', async () => {
        const provider = await makeProvider();
        const date = soonWeekday();
        await block(provider._id, date, '18:00', '19:00');

        const res = await request(app)
            .get('/api/appointments/booked-slots')
            .query({ providerId: provider._id.toString(), date });

        expect(res.status).toBe(200);
        const blocked = res.body.data.filter(d => d.kind === 'blocked');
        expect(blocked).toHaveLength(1);
        expect(blocked[0]).toMatchObject({ startTime: '18:00', endTime: '19:00' });
    });

    it('does not leak another provider\'s blocked time', async () => {
        const provider = await makeProvider();
        const other = await makeProvider();
        const date = soonWeekday();
        await block(other._id, date, '18:00', '19:00');

        const res = await request(app)
            .get('/api/appointments/booked-slots')
            .query({ providerId: provider._id.toString(), date });

        expect(res.body.data).toHaveLength(0);
    });

    it('marks real bookings as kind:appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const date = soonWeekday();

        await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '09:00', endTime: '10:00' });

        const res = await request(app)
            .get('/api/appointments/booked-slots')
            .query({ providerId: provider._id.toString(), date });

        const appts = res.body.data.filter(d => d.kind === 'appointment');
        expect(appts).toHaveLength(1);
        expect(appts[0]).toMatchObject({ startTime: '09:00', endTime: '10:00' });
    });
});

describe('recurring series validates every occurrence', () => {
    // Weekly series → same weekday each time, so a block one week out hits
    // occurrence #2 while occurrence #1 stays bookable.
    const plusWeeks = (dateStr, n) => {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + 7 * n);
        const pad = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    it('skips the blocked week and still books the rest of the series', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const first = soonWeekday();
        const blockedWeek = plusWeeks(first, 1);
        await block(provider._id, blockedWeek, '13:00', '14:00');

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: svc._id.toString(), appointmentDate: first,
                startTime: '13:00', endTime: '14:00',
                isRecurring: true, recurrenceType: 'weekly',
                recurrenceEndDate: plusWeeks(first, 3),
            });

        expect(res.status).toBe(201);
        expect(res.body.skippedDates).toContain(blockedWeek);

        const booked = await Appointment.find({}).select('appointmentDate').lean();
        const days = booked.map(a => a.appointmentDate.toISOString().slice(0, 10));
        expect(days).toContain(first);          // first occurrence survives
        expect(days).not.toContain(blockedWeek); // blocked one dropped
        expect(booked.length).toBeGreaterThan(1); // rest of the series still booked
    });

    it('books the whole series untouched when nothing conflicts', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const first = soonWeekday();

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: svc._id.toString(), appointmentDate: first,
                startTime: '13:00', endTime: '14:00',
                isRecurring: true, recurrenceType: 'weekly',
                recurrenceEndDate: plusWeeks(first, 3),
            });

        expect(res.status).toBe(201);
        expect(res.body.skippedDates).toBeUndefined();
        expect(await Appointment.countDocuments()).toBe(4); // weeks 0..3
    });
});

describe('reschedule respects blocked time', () => {
    it('rejects a customer reschedule onto blocked time', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const date = soonWeekday();
        await block(provider._id, date, '13:00', '14:00');

        const created = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '09:00', endTime: '10:00' });
        expect(created.status).toBe(201);

        const res = await request(app)
            .put(`/api/appointments/${created.body.data._id}/reschedule`)
            .set(authHeader(customer))
            .send({ appointmentDate: date, startTime: '13:00' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/not available/i);
    });
});
