/**
 * Date-specific shifts, and the breaks inside them.
 *
 * The contract these exist to pin (models/Shift states it, this proves it):
 *
 *     a Shift for the date  →  the member's weekly pattern  →  business hours
 *
 * A shift REPLACES the pattern for that one date. That is the only way to say
 * "not in this Thursday" without editing every Thursday, so a shift with no
 * slots is a rostered day off — meaningfully different from having no shift row
 * at all, which falls back to the pattern.
 *
 * The second half matters just as much: a break has to be invisible to the
 * customer's slot picker, not merely refused at submit. Slots are computed on
 * the client from opening hours minus the busy list, so a break the client
 * never hears about is a slot the customer picks and is then rejected.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const Shift = require('../../models/Shift');
const { resolveBookingStaff } = require('../../utils/staffBooking');

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
// A fixed future date avoids "today is a Sunday" flakiness.
const DATE = '2026-09-16';
// Pass the DATE STRING, exactly as production does (createAppointment forwards
// req.body.appointmentDate untouched). Building `new Date('...T00:00:00')` here
// made these tests pass only under UTC: in UTC+2 — the app's own production
// timezone — local midnight is 22:00 the PREVIOUS day, so the shift lookup key
// came out a day early and five of these tests silently exercised the weekly
// pattern instead of the shift they had just created.
const asDate = () => DATE;
const OTHER_DATE = '2026-09-17';

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const svc = await makeService(provider._id);
    const member = await TeamMember.create({ provider: provider._id, name: 'Moses Hamalwa' });
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '18:00') });
    // Their usual week: 09:00–17:00 every day.
    await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: everyDay('09:00', '17:00') });
    return { provider, customer, svc, member };
};

const tryBook = ({ provider, customer, svc, member }, startTime, endTime) =>
    resolveBookingStaff({
        svc, providerId: provider._id, appointmentDate: asDate(), startTime, endTime,
        requestedTeamMember: member._id, requester: { role: 'customer', _id: customer._id },
    });

describe('shift precedence', () => {
    it('falls back to the weekly pattern when there is no shift', async () => {
        const ctx = await setup();
        expect((await tryBook(ctx, '10:00', '10:30')).teamMember).toBeTruthy();
        // 08:00 is inside business hours but outside their 09:00 pattern.
        expect((await tryBook(ctx, '08:00', '08:30')).error).toMatch(/working hours/i);
    });

    it('a shift replaces the pattern for that date', async () => {
        const ctx = await setup();
        // Late start that day: 12:00–20:00 instead of the usual 09:00–17:00.
        await Shift.create({ provider: ctx.provider._id, teamMember: ctx.member._id, date: DATE, slots: [{ start: '12:00', end: '20:00' }] });

        // 10:00 is inside the usual pattern but outside today's shift.
        expect((await tryBook(ctx, '10:00', '10:30')).error).toMatch(/rostered/i);
        // 19:00 is outside the pattern but inside today's shift.
        expect((await tryBook(ctx, '19:00', '19:30')).teamMember).toBeTruthy();
    });

    it('leaves other dates on the weekly pattern', async () => {
        const ctx = await setup();
        await Shift.create({ provider: ctx.provider._id, teamMember: ctx.member._id, date: DATE, slots: [] });

        const otherDay = OTHER_DATE;
        const res = await resolveBookingStaff({
            svc: ctx.svc, providerId: ctx.provider._id, appointmentDate: otherDay,
            startTime: '10:00', endTime: '10:30',
            requestedTeamMember: ctx.member._id, requester: { role: 'customer', _id: ctx.customer._id },
        });
        expect(res.teamMember).toBeTruthy();
    });

    // The case a weekly pattern cannot express.
    it('a shift with no slots is a day off', async () => {
        const ctx = await setup();
        await Shift.create({ provider: ctx.provider._id, teamMember: ctx.member._id, date: DATE, slots: [] });

        expect((await tryBook(ctx, '10:00', '10:30')).error).toMatch(/rostered/i);
    });

    it('refuses a booking that lands on a break', async () => {
        const ctx = await setup();
        await Shift.create({
            provider: ctx.provider._id, teamMember: ctx.member._id, date: DATE,
            slots: [{ start: '09:00', end: '17:00' }],
            breaks: [{ start: '13:00', end: '14:00', label: 'Lunch' }],
        });

        expect((await tryBook(ctx, '13:30', '14:00')).error).toMatch(/break/i);
        // Either side of it is fine.
        expect((await tryBook(ctx, '12:00', '12:30')).teamMember).toBeTruthy();
        expect((await tryBook(ctx, '14:00', '14:30')).teamMember).toBeTruthy();
    });
});

describe('what the customer is shown', () => {
    // Enforcing at submit but not at display means offering a slot and then
    // refusing it — correct, and a terrible experience.
    it('reports breaks and off-shift hours as busy', async () => {
        const { provider, member } = await setup();
        await Shift.create({
            provider: provider._id, teamMember: member._id, date: DATE,
            slots: [{ start: '09:00', end: '17:00' }],
            breaks: [{ start: '13:00', end: '14:00', label: 'Lunch' }],
        });

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=${member._id}`);

        expect(res.status).toBe(200);
        const kinds = res.body.data.map((b) => b.kind);
        expect(kinds).toContain('break');
        expect(kinds).toContain('off_shift');

        const lunch = res.body.data.find((b) => b.kind === 'break');
        expect(lunch.startTime).toBe('13:00');
        expect(lunch.endTime).toBe('14:00');
        // Before and after the shift are both blocked out.
        const off = res.body.data.filter((b) => b.kind === 'off_shift');
        expect(off.some((b) => b.startTime === '00:00' && b.endTime === '09:00')).toBe(true);
        expect(off.some((b) => b.startTime === '17:00')).toBe(true);
    });

    it('says nothing about shifts when no staff member is named', async () => {
        const { provider, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: DATE, slots: [{ start: '09:00', end: '17:00' }] });

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}`);

        // A shift is one person's day and says nothing about the business.
        expect(res.body.data.map((b) => b.kind)).not.toContain('off_shift');
    });
});

// Shifts were enforced when a booking was CREATED and nowhere else, so a
// customer could book a legal slot and then reschedule straight onto the
// member's rostered day off — auto-confirmed, no override needed.
describe('rescheduling respects the roster', () => {
    const Appointment = require('../../models/Appointment');

    it('refuses a customer moving a booking onto a rostered day off', async () => {
        const { provider, customer, svc, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: OTHER_DATE, slots: [] });

        const appt = await Appointment.create({
            customer: customer._id, service: svc._id, provider: provider._id, teamMember: member._id,
            appointmentDate: new Date(`${DATE}T00:00:00Z`), startTime: '10:00', endTime: '10:30',
            totalPrice: 50, status: 'confirmed',
        });

        const res = await request(app)
            .put(`/api/appointments/${appt._id}/reschedule`)
            .set(authHeader(customer))
            .send({ appointmentDate: OTHER_DATE, startTime: '10:00' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/rostered/i);
        // And it really did not move.
        expect((await Appointment.findById(appt._id)).startTime).toBe('10:00');
        expect((await Appointment.findById(appt._id)).appointmentDate.toISOString().slice(0, 10)).toBe(DATE);
    });

    it('refuses a customer moving a booking onto a break', async () => {
        const { provider, customer, svc, member } = await setup();
        await Shift.create({
            provider: provider._id, teamMember: member._id, date: OTHER_DATE,
            slots: [{ start: '09:00', end: '17:00' }],
            breaks: [{ start: '13:00', end: '14:00', label: 'Lunch' }],
        });

        const appt = await Appointment.create({
            customer: customer._id, service: svc._id, provider: provider._id, teamMember: member._id,
            appointmentDate: new Date(`${DATE}T00:00:00Z`), startTime: '10:00', endTime: '10:30',
            totalPrice: 50, status: 'confirmed',
        });

        const res = await request(app)
            .put(`/api/appointments/${appt._id}/reschedule`)
            .set(authHeader(customer))
            .send({ appointmentDate: OTHER_DATE, startTime: '13:15' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/break/i);
    });
});

// A shift REPLACES business hours for that member on that date, so a member
// rostered to cover a slot the business is normally closed for must actually be
// bookable there. Business hours here are 08:00–18:00; the shift runs to 20:00.
describe('a shift can be sold outside business hours', () => {
    const Appointment = require('../../models/Appointment');
    // 19:00 is outside the 08:00–18:00 business day but inside a 12:00–20:00 shift.
    const OUT_OF_HOURS = '19:00';
    const book = (customer, svc, member, startTime, endTime, date = DATE) => request(app)
        .post('/api/appointments')
        .set(authHeader(customer))
        .send({ service: svc._id.toString(), appointmentDate: date, startTime, endTime, teamMember: member._id.toString() });

    it('refuses the out-of-hours slot when there is no shift', async () => {
        const { customer, svc, member } = await setup();
        // The member's own weekly hours (09:00–17:00) don't reach 19:00 either,
        // and there is no shift — so the business-hours gate rightly stands.
        const res = await book(customer, svc, member, OUT_OF_HOURS, '19:30');
        expect(res.status).toBe(400);
        expect(await Appointment.countDocuments({ teamMember: member._id })).toBe(0);
    });

    it('allows it for a member whose shift covers that time', async () => {
        const { provider, customer, svc, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: DATE, slots: [{ start: '12:00', end: '20:00' }] });

        const res = await book(customer, svc, member, OUT_OF_HOURS, '19:30');

        expect(res.status).toBe(201);
        expect(res.body.data.teamMember).toBe(member._id.toString());
    });

    // The gate stands down, but the per-staff check does not: a slot the shift
    // itself doesn't cover is still refused, with the roster's own message.
    it('still refuses a time the shift does not cover', async () => {
        const { provider, customer, svc, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: DATE, slots: [{ start: '12:00', end: '20:00' }] });

        // 21:00 is outside business hours AND outside the shift.
        const res = await book(customer, svc, member, '21:00', '21:30');
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/rostered/i);
    });

    it('lets a customer reschedule onto a shift-covered out-of-hours slot', async () => {
        const { provider, customer, svc, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: OTHER_DATE, slots: [{ start: '12:00', end: '20:00' }] });

        const appt = await Appointment.create({
            customer: customer._id, service: svc._id, provider: provider._id, teamMember: member._id,
            appointmentDate: new Date(`${DATE}T00:00:00Z`), startTime: '10:00', endTime: '10:30',
            totalPrice: 50, status: 'confirmed',
        });

        const res = await request(app)
            .put(`/api/appointments/${appt._id}/reschedule`)
            .set(authHeader(customer))
            .send({ appointmentDate: OTHER_DATE, startTime: OUT_OF_HOURS });

        expect(res.status).toBe(200);
        expect((await Appointment.findById(appt._id)).startTime).toBe(OUT_OF_HOURS);
    });
});

// A single booking is gated by the roster; a recurring series used to insert
// every occurrence blind, booking straight through a member's rostered day off.
describe('a recurring series respects the roster', () => {
    const Appointment = require('../../models/Appointment');
    // DATE is a Wednesday; a weekly series lands on the next two Wednesdays too.
    const WEEK_1 = '2026-09-23';
    const WEEK_2 = '2026-09-30';

    it('skips the occurrences the member is rostered off, keeps the rest', async () => {
        const { provider, customer, svc, member } = await setup();
        // Rostered off on the middle occurrence only.
        await Shift.create({ provider: provider._id, teamMember: member._id, date: WEEK_1, slots: [] });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: svc._id.toString(), appointmentDate: DATE,
                startTime: '10:00', endTime: '10:30', teamMember: member._id.toString(),
                isRecurring: true, recurrenceType: 'weekly', recurrenceEndDate: WEEK_2,
            });

        expect(res.status).toBe(201);
        expect(res.body.skippedDates).toContain(WEEK_1);

        const days = (await Appointment.find({ teamMember: member._id }).select('appointmentDate').lean())
            .map((a) => a.appointmentDate.toISOString().slice(0, 10));
        expect(days).toContain(DATE);       // first occurrence
        expect(days).toContain(WEEK_2);     // last occurrence
        expect(days).not.toContain(WEEK_1); // the rostered day off
    });
});

describe('managing shifts', () => {
    const put = (provider, member, body) =>
        request(app).put(`/api/team/${member._id}/shifts`).set(authHeader(provider)).send(body);

    it('saves and then reads back a shift', async () => {
        const { provider, member } = await setup();

        const res = await put(provider, member, {
            date: DATE,
            slots: [{ start: '09:00', end: '17:00' }],
            breaks: [{ start: '13:00', end: '14:00', label: 'Lunch' }],
        });
        expect(res.status).toBe(200);

        const list = await request(app)
            .get(`/api/team/${member._id}/shifts?from=${DATE}&to=${DATE}`)
            .set(authHeader(provider));
        expect(list.body.data).toHaveLength(1);
        expect(list.body.data[0].breaks[0].label).toBe('Lunch');
    });

    it('overwrites rather than duplicating the same date', async () => {
        const { provider, member } = await setup();
        await put(provider, member, { date: DATE, slots: [{ start: '09:00', end: '17:00' }] });
        await put(provider, member, { date: DATE, slots: [{ start: '11:00', end: '19:00' }] });

        const all = await Shift.find({ teamMember: member._id, date: DATE });
        expect(all).toHaveLength(1);
        expect(all[0].slots[0].start).toBe('11:00');
    });

    // A break outside the working hours would make the shift claim time it
    // hasn't got, so it is refused rather than silently kept.
    it('refuses a break that falls outside the working hours', async () => {
        const { provider, member } = await setup();

        const res = await put(provider, member, {
            date: DATE,
            slots: [{ start: '09:00', end: '12:00' }],
            breaks: [{ start: '13:00', end: '14:00' }],
        });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/outside the working hours/i);
        expect(await Shift.countDocuments({ teamMember: member._id })).toBe(0);
    });

    it('refuses overlapping working periods', async () => {
        const { provider, member } = await setup();
        const res = await put(provider, member, {
            date: DATE, slots: [{ start: '09:00', end: '13:00' }, { start: '12:00', end: '17:00' }],
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/overlap/i);
    });

    it('refuses a period that ends before it starts', async () => {
        const { provider, member } = await setup();
        const res = await put(provider, member, { date: DATE, slots: [{ start: '17:00', end: '09:00' }] });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/end after/i);
    });

    it('clearing a shift hands the date back to the weekly pattern', async () => {
        const ctx = await setup();
        await put(ctx.provider, ctx.member, { date: DATE, slots: [{ start: '12:00', end: '20:00' }] });
        expect((await tryBook(ctx, '10:00', '10:30')).error).toMatch(/rostered/i);

        const res = await request(app)
            .delete(`/api/team/${ctx.member._id}/shifts/${DATE}`)
            .set(authHeader(ctx.provider));
        expect(res.status).toBe(200);

        // Back on their usual 09:00–17:00.
        expect((await tryBook(ctx, '10:00', '10:30')).teamMember).toBeTruthy();
    });

    it('refuses another provider\'s team member', async () => {
        const { member } = await setup();
        const intruder = await makeProvider();

        const res = await request(app)
            .put(`/api/team/${member._id}/shifts`)
            .set(authHeader(intruder))
            .send({ date: DATE, slots: [{ start: '09:00', end: '17:00' }] });

        expect(res.status).toBe(404);
        expect(await Shift.countDocuments({ teamMember: member._id })).toBe(0);
    });

    // The date regex alone accepts days that do not exist; a shift stored against
    // 2026-02-31 would sit in the collection matching nothing the booking path
    // ever asks about — an invisible, un-clearable ghost.
    it('refuses a well-formed but impossible calendar date', async () => {
        const { provider, member } = await setup();

        const res = await put(provider, member, { date: '2026-02-31', slots: [{ start: '09:00', end: '17:00' }] });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/real calendar date/i);
        expect(await Shift.countDocuments({ teamMember: member._id })).toBe(0);
    });

    // The schema constrains the note length, but findOneAndUpdate only enforces
    // the schema with runValidators — without it an over-long note is written
    // unchecked. A schema violation is the caller's mistake, so it answers 400.
    it('enforces the schema on the upsert path, not just on create', async () => {
        const { provider, member } = await setup();

        const res = await put(provider, member, {
            date: DATE, slots: [{ start: '09:00', end: '17:00' }], note: 'x'.repeat(200),
        });

        expect(res.status).toBe(400);
        expect(await Shift.countDocuments({ teamMember: member._id })).toBe(0);
    });
});
