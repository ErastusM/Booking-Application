/**
 * A team member with no working hours of their own can't be booked.
 *
 * The owner's answer: "They shouldn't be bookable." Until now a member with no
 * shift that day and no weekly hours fell back to the BUSINESS's hours, so
 * clients could book them all day while their own Availability screen said
 * "Clients can't book you until you set your hours". Now nothing is inherited:
 *
 *   - no shift that day + no weekly hours = not bookable that day, everywhere
 *     the server decides (booking, any professional, search, waiting list,
 *     reschedule, a member's own walk-ins) — reason 'no_hours';
 *   - a shift is hours: a shift-only member is bookable on the shift's date;
 *   - the owner's own column still works the business's hours, and the owner
 *     can still book anyone outside hours (their override);
 *   - existing bookings are never touched;
 *   - the roster says who is not bookable (hasHours) for the Team card, the
 *     member's own screen and the client's tiles.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { futureDate } = require('../helpers/dates');
const { makeProvider, makeUser, makeService, authHeader, everyDayHours, giveHours } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');
const Shift = require('../../models/Shift');
const WaitingList = require('../../models/WaitingList');
const BookingRejection = require('../../models/BookingRejection');
const { promoteFromWaitingList } = require('../../utils/waitingListHelper');
const { searchAvailability } = require('../../utils/availabilitySearch');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DATE = futureDate(0);       // a Wednesday ~4 weeks out
const NEXT_WEEK = futureDate(7);  // the Wednesday after
const DAY = new Date(`${DATE}T00:00:00.000Z`);

// Vido Barber: open 08:00–18:00 every day. John has no hours of his own; Lina
// works 08:00–18:00 every day.
const shop = async ({ ownerPerformsTrim = true } = {}) => {
    const owner = await makeProvider({ name: 'Vido Barber' });
    await Availability.create({ provider: owner._id, schedule: everyDayHours('08:00', '18:00') });
    const trim = await makeService(owner._id, { name: 'Trim', price: 70, duration: 30, ownerPerforms: ownerPerformsTrim });
    const john = await TeamMember.create({ provider: owner._id, name: 'John', offersAllServices: true });
    const lina = await TeamMember.create({ provider: owner._id, name: 'Lina', offersAllServices: true });
    await giveHours(lina, everyDayHours('08:00', '18:00'));
    const customer = await makeUser({ name: 'Ndapewa Client' });
    return { owner, trim, john, lina, customer };
};
const book = (ctx, body, as = ctx.customer) => request(app).post('/api/appointments').set(authHeader(as))
    .send({ service: ctx.trim._id.toString(), appointmentDate: DATE, startTime: '10:00', endTime: '10:30', ...body });

describe('booking a member with no hours of their own', () => {
    it('is refused by name, says why, and tells the owner (turned-away reason no_hours)', async () => {
        const ctx = await shop();
        const res = await book(ctx, { teamMember: ctx.john._id.toString() });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('That staff member has no working hours set for that day.');
        // Recorded fire-and-forget after the response — wait for it (bounded).
        let rejection = null;
        for (let i = 0; i < 40 && !rejection; i += 1) {
            rejection = await BookingRejection.findOne({ provider: ctx.owner._id }).lean();
            if (!rejection) await new Promise((r) => setTimeout(r, 25));
        }
        expect(rejection?.reason).toBe('no_hours');
    });

    it('a colleague with hours, and the owner\'s own column, are still bookable', async () => {
        const ctx = await shop();
        expect((await book(ctx, { teamMember: ctx.lina._id.toString() })).status).toBe(201);
        const owner = await book(ctx, { teamMember: 'owner', startTime: '11:00', endTime: '11:30' });
        expect(owner.status).toBe(201);
        expect(owner.body.data.teamMember).toBeNull();
    });

    it('"any available" never lands on them: it picks the colleague with hours, then refuses', async () => {
        const ctx = await shop();
        const first = await book(ctx, {});
        expect(first.status).toBe(201);
        expect(String(first.body.data.teamMember)).toBe(String(ctx.lina._id)); // John is earlier on the roster
        const second = await book(ctx, {});
        // Lina is taken (a clash with a booking is a 409 — #238); John has no hours.
        expect(second.status).toBe(409);
        expect(second.body.data?.teamMember).toBeUndefined();
    });

    it('the owner can still book them — the owner\'s "outside working hours" override', async () => {
        const ctx = await shop();
        const res = await book(ctx, { teamMember: ctx.john._id.toString(), walkInName: 'Walk In' }, ctx.owner);
        expect(res.status).toBe(201);
        expect(String(res.body.data.teamMember)).toBe(String(ctx.john._id));
    });

    it('a member with no hours can\'t log a walk-in into their own column either', async () => {
        const ctx = await shop();
        const login = await makeUser({ role: 'staff', staffOf: ctx.owner._id, email: 'john@test.com' });
        await TeamMember.updateOne({ _id: ctx.john._id }, { $set: { user: login._id } });
        const res = await book(ctx, { walkInName: 'Walk In' }, login);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/no working hours/i);
        // Once they set hours, they can.
        await giveHours(ctx.john, everyDayHours('08:00', '18:00'));
        expect((await book(ctx, { walkInName: 'Walk In' }, login)).status).toBe(201);
    });

    it('enabled days with no times (the schema\'s defaults) are not hours', async () => {
        const ctx = await shop();
        await StaffAvailability.create({ provider: ctx.owner._id, teamMember: ctx.john._id }); // Mon–Fri on, no periods
        expect((await book(ctx, { teamMember: ctx.john._id.toString() })).status).toBe(400);
        const staff = await request(app).get(`/api/providers/${ctx.owner._id}/staff`);
        expect(staff.body.data.find((m) => String(m._id) === String(ctx.john._id)).hasHours).toBe(false);
    });
});

describe('a shift is hours of their own', () => {
    it('a shift-only member is bookable on the shift\'s date, and only then', async () => {
        const ctx = await shop();
        await Shift.create({ provider: ctx.owner._id, teamMember: ctx.john._id, date: DATE, slots: [{ start: '09:00', end: '13:00' }] });
        expect((await book(ctx, { teamMember: ctx.john._id.toString() })).status).toBe(201);
        const nextWeek = await book(ctx, { teamMember: ctx.john._id.toString(), appointmentDate: NEXT_WEEK });
        expect(nextWeek.status).toBe(400);
        expect(nextWeek.body.message).toMatch(/no working hours/i);
    });

    it('a weekly series for a shift-only member keeps the shift date and skips the rest', async () => {
        const ctx = await shop();
        await Shift.create({ provider: ctx.owner._id, teamMember: ctx.john._id, date: DATE, slots: [{ start: '09:00', end: '13:00' }] });
        const res = await book(ctx, {
            teamMember: ctx.john._id.toString(), isRecurring: true, recurrenceType: 'weekly',
            recurrenceInterval: 1, recurrenceEndDate: futureDate(14),
        });
        expect(res.status).toBe(201);
        expect(res.body.skippedDates).toEqual([NEXT_WEEK, futureDate(14)]);
        expect(await Appointment.countDocuments({ teamMember: ctx.john._id })).toBe(1);
    });
});

describe('what the client sees', () => {
    it('booked-slots: the whole day is off for a member with no hours (hoursSource "none")', async () => {
        const ctx = await shop();
        const res = await request(app).get('/api/appointments/booked-slots')
            .query({ providerId: ctx.owner._id.toString(), date: DATE, teamMember: ctx.john._id.toString() });
        expect(res.body.hoursSource).toBe('none');
        expect(res.body.data).toEqual(expect.arrayContaining([{ startTime: '00:00', endTime: '23:59', kind: 'off_shift' }]));

        const lina = await request(app).get('/api/appointments/booked-slots')
            .query({ providerId: ctx.owner._id.toString(), date: DATE, teamMember: ctx.lina._id.toString() });
        expect(lina.body.hoursSource).toBe('weekly');
        const owner = await request(app).get('/api/appointments/booked-slots')
            .query({ providerId: ctx.owner._id.toString(), date: DATE, teamMember: 'owner' });
        expect(owner.body.hoursSource).toBe('business');
    });

    it('shift-days: every day without a shift is off', async () => {
        const ctx = await shop();
        await Shift.create({ provider: ctx.owner._id, teamMember: ctx.john._id, date: DATE, slots: [{ start: '09:00', end: '13:00' }] });
        const res = await request(app)
            .get(`/api/providers/${ctx.owner._id}/staff/${ctx.john._id}/shift-days?from=${futureDate(-1)}&to=${futureDate(1)}`);
        expect(res.body.data.working).toEqual([DATE]);
        expect(res.body.data.off.sort()).toEqual([futureDate(-1), futureDate(1)]);
    });

    it('the professional tiles say who can be booked (hasHours); the owner always can', async () => {
        const ctx = await shop();
        const later = await TeamMember.create({ provider: ctx.owner._id, name: 'Shifty', offersAllServices: true });
        await Shift.create({ provider: ctx.owner._id, teamMember: later._id, date: DATE, slots: [{ start: '09:00', end: '13:00' }] });
        const past = await TeamMember.create({ provider: ctx.owner._id, name: 'Long Ago', offersAllServices: true });
        await Shift.create({ provider: ctx.owner._id, teamMember: past._id, date: '2020-01-01', slots: [{ start: '09:00', end: '13:00' }] });

        const res = await request(app).get(`/api/providers/${ctx.owner._id}/staff`);
        const by = Object.fromEntries(res.body.data.map((m) => [m.name, m.hasHours]));
        expect(by).toMatchObject({ 'Vido Barber': true, John: false, Lina: true, Shifty: true, 'Long Ago': false });
    });

    it('search: members with no hours add no openings; the owner\'s column still does', async () => {
        const noOwner = await shop({ ownerPerformsTrim: false });
        await StaffAvailability.deleteMany({ teamMember: noOwner.lina._id }); // nobody on the team has hours
        let results = await searchAvailability({ date: DATE, duration: 30 });
        expect(results.find((r) => r.provider === String(noOwner.owner._id))).toBeUndefined();

        const withOwner = await shop();
        await StaffAvailability.deleteMany({ teamMember: withOwner.lina._id });
        results = await searchAvailability({ date: DATE, duration: 30 });
        const hit = results.find((r) => r.provider === String(withOwner.owner._id));
        expect(hit.openings[0]).toBe('08:00'); // the owner works the business's hours
    });
});

describe('the waiting list', () => {
    it('a client can\'t join the line for a member with no hours that day', async () => {
        const ctx = await shop();
        const res = await request(app).post('/api/waitinglist').set(authHeader(ctx.customer)).send({
            service: ctx.trim._id.toString(), appointmentDate: DATE, startTime: '10:00', endTime: '10:30',
            teamMember: ctx.john._id.toString(),
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/no working hours/i);
    });

    it('promotion never books a member with no hours — the client keeps their place', async () => {
        const ctx = await shop();
        await WaitingList.create({
            service: ctx.trim._id, provider: ctx.owner._id, customer: ctx.customer._id, teamMember: ctx.john._id,
            appointmentDate: DAY, startTime: '10:00', endTime: '10:30', position: 1, status: 'waiting',
        });
        await promoteFromWaitingList(ctx.trim._id, DAY, '10:00', '10:30');
        expect(await Appointment.countDocuments({ customer: ctx.customer._id })).toBe(0);
        expect((await WaitingList.findOne({ customer: ctx.customer._id })).status).toBe('waiting');
    });
});

describe('existing bookings', () => {
    it('are never touched, but can\'t be moved to another time while the member has no hours', async () => {
        const ctx = await shop();
        // Booked while John still had hours…
        await giveHours(ctx.john, everyDayHours('08:00', '18:00'));
        const booked = await book(ctx, { teamMember: ctx.john._id.toString() });
        expect(booked.status).toBe(201);
        // …then his hours were cleared.
        await StaffAvailability.deleteMany({ teamMember: ctx.john._id });
        const still = await Appointment.findById(booked.body.data._id).lean();
        expect(still.status).not.toBe('cancelled');
        expect(String(still.teamMember)).toBe(String(ctx.john._id));

        const moved = await request(app).put(`/api/appointments/${booked.body.data._id}/reschedule`)
            .set(authHeader(ctx.customer)).send({ appointmentDate: DATE, startTime: '11:00' });
        expect(moved.status).toBe(400);
        expect(moved.body.message).toMatch(/no working hours/i);
    });

    it('a member with no hours can\'t move their own booking to a new time either — the owner still can', async () => {
        const ctx = await shop();
        const login = await makeUser({ role: 'staff', staffOf: ctx.owner._id, email: 'john-move@test.com' });
        await TeamMember.updateOne({ _id: ctx.john._id }, { $set: { user: login._id } });
        const appt = await Appointment.create({
            customer: ctx.customer._id, service: ctx.trim._id, provider: ctx.owner._id, teamMember: ctx.john._id,
            appointmentDate: DAY, startTime: '10:00', endTime: '10:30', status: 'confirmed', totalPrice: 70,
        });
        const move = (as, startTime) => request(app).put(`/api/appointments/${appt._id}/provider-reschedule`)
            .set(authHeader(as)).send({ appointmentDate: DATE, startTime });
        const refused = await move(login, '11:00');
        expect(refused.status).toBe(400);
        expect(refused.body.message).toBe('That staff member has no working hours set for that day.');
        expect((await Appointment.findById(appt._id).lean()).startTime).toBe('10:00');
        // The owner's override is unchanged.
        expect((await move(ctx.owner, '11:00')).status).toBe(200);
        // With hours of his own he moves it as before — even outside them (as today).
        await giveHours(ctx.john, everyDayHours('09:00', '12:00'));
        expect((await move(login, '15:00')).status).toBe(200);
    });
});

describe('readiness on the Team card and the member\'s own profile', () => {
    it('GET /api/team marks each member hasHours; GET /api/team/mine/profile says it to the member', async () => {
        const ctx = await shop();
        const team = await request(app).get('/api/team').set(authHeader(ctx.owner)).expect(200);
        const by = Object.fromEntries(team.body.data.map((m) => [m.name, m.hasHours]));
        expect(by).toEqual({ John: false, Lina: true });

        const login = await makeUser({ role: 'staff', staffOf: ctx.owner._id, email: 'john2@test.com' });
        await TeamMember.updateOne({ _id: ctx.john._id }, { $set: { user: login._id } });
        const me = await request(app).get('/api/team/mine/profile').set(authHeader(login)).expect(200);
        expect(me.body.data.hasHours).toBe(false);
        await request(app).put('/api/team/mine/availability').set(authHeader(login))
            .send({ schedule: { monday: { enabled: true, slots: [{ start: '09:00', end: '17:00' }] } } }).expect(200);
        const after = await request(app).get('/api/team/mine/profile').set(authHeader(login)).expect(200);
        expect(after.body.data.hasHours).toBe(true);
    });
});
