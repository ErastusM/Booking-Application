/**
 * POST /api/appointments/batch-reschedule
 *
 * Drag-to-reschedule sends a whole decision at once: moving one booking onto
 * another offers to push the occupant too, and that push can ripple. The point
 * of the endpoint is that the ripple lands as ONE unit — so these tests care
 * far more about what happens when part of it fails than about the happy path.
 *
 * There are no Mongo transactions available (standalone mongod), so atomicity
 * is built out of validate-first, guarded writes and a compensating rollback.
 * Each of those three is pinned below.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A weekday N days out, so every slot sits inside the default 09:00–17:00
// availability and nothing is rejected for being a closed Saturday.
const weekdayAhead = (n) => {
    const d = new Date();
    let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) added++; }
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const service = await makeService(provider._id, { duration: 60 });
    const date = weekdayAhead(3);
    const day = new Date(`${date}T00:00:00.000Z`);

    const at = (startTime, endTime) => makeAppointment(customer._id, service._id, provider._id, {
        appointmentDate: day, startTime, endTime, status: 'confirmed',
    });
    return { provider, customer, service, date, at };
};

const post = (provider, body) => request(app)
    .post('/api/appointments/batch-reschedule')
    .set(authHeader(provider))
    .send(body);

describe('batch reschedule — the happy path', () => {
    it('moves one booking', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');

        const res = await post(provider, { moves: [{ id: a._id.toString(), appointmentDate: date, startTime: '14:00', endTime: '15:00' }] });

        expect(res.status).toBe(200);
        const after = await Appointment.findById(a._id);
        expect(after.startTime).toBe('14:00');
        expect(after.endTime).toBe('15:00');
    });

    it('applies a whole push cascade in one call', async () => {
        const { provider, date, at } = await setup();
        // 10:00 stretches over 11:00, which shoves 12:00 along behind it.
        const a = await at('10:00', '11:00');
        const b = await at('11:00', '12:00');
        const c = await at('12:00', '13:00');

        const res = await post(provider, {
            moves: [
                { id: a._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '12:00' },
                { id: b._id.toString(), appointmentDate: date, startTime: '12:00', endTime: '13:00' },
                { id: c._id.toString(), appointmentDate: date, startTime: '13:00', endTime: '14:00' },
            ],
        });

        expect(res.status).toBe(200);
        expect((await Appointment.findById(a._id)).endTime).toBe('12:00');
        expect((await Appointment.findById(b._id)).startTime).toBe('12:00');
        expect((await Appointment.findById(c._id)).startTime).toBe('13:00');
    });

    it('keeps a booking\'s own length when no endTime is sent', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '10:45');

        await post(provider, { moves: [{ id: a._id.toString(), appointmentDate: date, startTime: '15:00' }] });

        const after = await Appointment.findById(a._id);
        expect(after.startTime).toBe('15:00');
        expect(after.endTime).toBe('15:45');   // 45 minutes preserved, not the service default
    });
});

describe('batch reschedule — it is one unit or nothing', () => {
    // The whole reason this endpoint exists. If the second move is illegal, the
    // first must not survive: a half-applied push leaves the day genuinely
    // double-booked, which is worse than the clash it was resolving.
    it('rolls the first move back when a later one is impossible', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');
        const b = await at('11:00', '12:00');

        const res = await post(provider, {
            moves: [
                { id: a._id.toString(), appointmentDate: date, startTime: '14:00', endTime: '15:00' },
                // Inverted window — rejected during validation, before any write.
                { id: b._id.toString(), appointmentDate: date, startTime: '16:00', endTime: '15:00' },
            ],
        });

        expect(res.status).toBe(400);
        expect((await Appointment.findById(a._id)).startTime).toBe('10:00');
        expect((await Appointment.findById(b._id)).startTime).toBe('11:00');
    });

    it('refuses a batch whose moves collide with each other', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');
        const b = await at('11:00', '12:00');

        const res = await post(provider, {
            moves: [
                { id: a._id.toString(), appointmentDate: date, startTime: '14:00', endTime: '15:00' },
                { id: b._id.toString(), appointmentDate: date, startTime: '14:30', endTime: '15:30' },
            ],
        });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/overlap each other/i);
        expect((await Appointment.findById(a._id)).startTime).toBe('10:00');
    });

    it('refuses to land on a booking it is not moving', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');
        await at('14:00', '15:00');           // bystander, not in the batch

        const res = await post(provider, {
            moves: [{ id: a._id.toString(), appointmentDate: date, startTime: '14:00', endTime: '15:00' }],
        });

        expect(res.status).toBe(409);
        expect((await Appointment.findById(a._id)).startTime).toBe('10:00');
    });

    // The race guard: each write matches on the slot we believe it still holds.
    it('aborts and restores when a booking moved underneath the batch', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');
        const b = await at('11:00', '12:00');

        // Somebody else moves `b` between the client reading the calendar and
        // this request landing, so the guard on b's slot can no longer match.
        await Appointment.updateOne({ _id: b._id }, { $set: { startTime: '11:30', endTime: '12:30' } });

        const res = await post(provider, {
            moves: [
                { id: a._id.toString(), appointmentDate: date, startTime: '14:00', endTime: '15:00' },
                { id: b._id.toString(), appointmentDate: date, startTime: '15:00', endTime: '16:00' },
            ],
        });

        expect(res.status).toBe(409);
        // a was written first, then compensated back when b's guard failed.
        expect((await Appointment.findById(a._id)).startTime).toBe('10:00');
        expect((await Appointment.findById(b._id)).startTime).toBe('11:30');
    });
});

describe('batch reschedule — who is allowed to', () => {
    it('refuses another provider\'s bookings', async () => {
        const { date, at } = await setup();
        const a = await at('10:00', '11:00');
        const intruder = await makeProvider();

        const res = await post(intruder, { moves: [{ id: a._id.toString(), appointmentDate: date, startTime: '14:00' }] });

        expect(res.status).toBe(403);
        expect((await Appointment.findById(a._id)).startTime).toBe('10:00');
    });

    it('refuses a completed booking — finished work stays put', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');
        await Appointment.updateOne({ _id: a._id }, { $set: { status: 'completed' } });

        const res = await post(provider, { moves: [{ id: a._id.toString(), appointmentDate: date, startTime: '14:00' }] });

        expect(res.status).toBe(400);
        expect((await Appointment.findById(a._id)).startTime).toBe('10:00');
    });

    it('rejects the same booking twice in one batch', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');

        const res = await post(provider, {
            moves: [
                { id: a._id.toString(), appointmentDate: date, startTime: '14:00' },
                { id: a._id.toString(), appointmentDate: date, startTime: '15:00' },
            ],
        });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/twice/i);
    });

    it('rejects an empty or oversized batch', async () => {
        const { provider } = await setup();
        expect((await post(provider, { moves: [] })).status).toBe(400);
        const tooMany = Array.from({ length: 26 }, () => ({ id: 'x', appointmentDate: '2030-01-01', startTime: '10:00' }));
        expect((await post(provider, { moves: tooMany })).status).toBe(400);
    });
});

describe('batch reschedule — outside opening hours', () => {
    // Providers may deliberately place work outside their published hours, but
    // only by saying so. The flag is set by the drag UI once it has shown the
    // off-hours hatch; it is never the default.
    it('rejects an out-of-hours slot by default', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');

        const res = await post(provider, { moves: [{ id: a._id.toString(), appointmentDate: date, startTime: '21:00', endTime: '22:00' }] });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/availability/i);
        expect((await Appointment.findById(a._id)).startTime).toBe('10:00');
    });

    it('allows it when the caller opts in', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');

        const res = await post(provider, {
            moves: [{ id: a._id.toString(), appointmentDate: date, startTime: '21:00', endTime: '22:00' }],
            allowOutsideHours: true,
        });

        expect(res.status).toBe(200);
        expect((await Appointment.findById(a._id)).startTime).toBe('21:00');
    });

    it('never accepts a window that runs past midnight', async () => {
        const { provider, date, at } = await setup();
        const a = await at('10:00', '11:00');

        const res = await post(provider, {
            moves: [{ id: a._id.toString(), appointmentDate: date, startTime: '23:00', endTime: '00:30' }],
            allowOutsideHours: true,
        });

        expect(res.status).toBe(400);
        expect((await Appointment.findById(a._id)).startTime).toBe('10:00');
    });
});
