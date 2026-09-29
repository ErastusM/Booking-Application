/**
 * Old date-specific shifts no longer change anyone's hours.
 *
 * The "Shifts" screen was removed in #249; the weekly Working Hours screen is
 * now the only place hours are set. Shift rows saved before then are kept (no
 * data is deleted) but ignored: a member's bookable hours are their weekly
 * Working Hours only, minus their own blocked time and approved time off.
 * These tests pin that a shift row — working hours, a break, or an empty
 * "day off" — changes nothing, and that the legacy /shifts routes still work.
 */
const request = require('supertest');
const { futureDate } = require('../helpers/dates');
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
const DATE = futureDate(0);
// Pass the DATE STRING, exactly as production does (createAppointment forwards
// req.body.appointmentDate untouched). Building `new Date('...T00:00:00')` here
// made these tests pass only under UTC (in UTC+2 local midnight is 22:00 the
// PREVIOUS day, so the date key came out a day early).
const asDate = () => DATE;
const OTHER_DATE = futureDate(1);

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

describe('a shift row never changes the weekly hours', () => {
    it('uses the weekly pattern when there is no shift', async () => {
        const ctx = await setup();
        // A second bookable member, as in a real roster (a lone member is held to
        // their own weekly hours in exactly the same way — staffBookingMath).
        await TeamMember.create({ provider: ctx.provider._id, name: 'Second Chair' });
        expect((await tryBook(ctx, '10:00', '10:30')).teamMember).toBeTruthy();
        // 08:00 is inside business hours but outside their 09:00 pattern.
        expect((await tryBook(ctx, '08:00', '08:30')).error).toMatch(/working hours/i);
    });

    it('a shift for the date is ignored: the weekly pattern still decides', async () => {
        const ctx = await setup();
        // An old 12:00–20:00 shift, against the usual 09:00–17:00.
        await Shift.create({ provider: ctx.provider._id, teamMember: ctx.member._id, date: DATE, slots: [{ start: '12:00', end: '20:00' }] });

        // 10:00 is inside the weekly pattern: bookable, whatever the shift says.
        expect((await tryBook(ctx, '10:00', '10:30')).teamMember).toBeTruthy();
        // 19:00 is outside the weekly pattern: the shift does not open it.
        expect((await tryBook(ctx, '19:00', '19:30')).error).toMatch(/working hours/i);
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

    it('a shift with no slots is no longer a day off', async () => {
        const ctx = await setup();
        await Shift.create({ provider: ctx.provider._id, teamMember: ctx.member._id, date: DATE, slots: [] });

        expect((await tryBook(ctx, '10:00', '10:30')).teamMember).toBeTruthy();
    });

    it('a shift break no longer closes time', async () => {
        const ctx = await setup();
        await Shift.create({
            provider: ctx.provider._id, teamMember: ctx.member._id, date: DATE,
            slots: [{ start: '09:00', end: '17:00' }],
            breaks: [{ start: '13:00', end: '14:00', label: 'Lunch' }],
        });

        expect((await tryBook(ctx, '13:30', '14:00')).teamMember).toBeTruthy();
    });
});

describe('what the customer is shown', () => {
    it('shows only the weekly hours as closed — never a shift or its break', async () => {
        const { provider, member } = await setup();
        await Shift.create({
            provider: provider._id, teamMember: member._id, date: DATE,
            slots: [{ start: '09:00', end: '17:00' }],
            breaks: [{ start: '13:00', end: '14:00', label: 'Lunch' }],
        });

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=${member._id}`);

        expect(res.status).toBe(200);
        expect(res.body.hoursSource).toBe('weekly');
        const kinds = res.body.data.map((b) => b.kind);
        expect(kinds).not.toContain('break');
        // Outside the weekly 09:00–17:00 is closed, and nothing else.
        const off = res.body.data.filter((b) => b.kind === 'off_shift');
        expect(off).toEqual([
            { startTime: '00:00', endTime: '09:00', kind: 'off_shift' },
            { startTime: '17:00', endTime: '23:59', kind: 'off_shift' },
        ]);
    });

    it('says nothing about shifts when no staff member is named', async () => {
        const { provider, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: DATE, slots: [{ start: '09:00', end: '17:00' }] });

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}`);

        // A shift is one person's day and says nothing about the business.
        expect(res.body.data.map((b) => b.kind)).not.toContain('off_shift');
        // And with no member named there is no per-member window to hand back.
        expect(res.body.shiftWindow).toBeNull();
    });

    // shiftWindow stays in the payload for older clients, but is always null:
    // the member's weekly window (memberWindow) is what the picker uses.
    it('never hands back a shift window, even with a shift that day', async () => {
        const { provider, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: DATE, slots: [{ start: '12:00', end: '20:00' }] });

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=${member._id}`);

        expect(res.body.shiftWindow).toBeNull();
        expect(res.body.memberWindow).toEqual([{ start: '09:00', end: '17:00' }]);
    });

    it('an empty (day off) shift does not close the day', async () => {
        const { provider, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: DATE, slots: [] });

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=${member._id}`);

        expect(res.body.shiftWindow).toBeNull();
        expect(res.body.hoursSource).toBe('weekly');
        expect(res.body.data.some((b) => b.startTime === '00:00' && b.endTime === '23:59')).toBe(false);
    });

    it('hands back null when the member has no shift that day', async () => {
        const { provider, member } = await setup();

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=${member._id}`);

        expect(res.body.shiftWindow).toBeNull();
    });
});

// The customer date picker's working/off days (the route keeps its old
// "shift-days" name) come from the weekly hours only.
describe('a member\'s working days for the customer calendar', () => {
    const shiftDays = (provider, member, from, to) =>
        request(app).get(`/api/providers/${provider._id}/staff/${member._id}/shift-days?from=${from}&to=${to}`);

    it('ignores shifts: an empty "day off" shift leaves a weekly working day working', async () => {
        const { provider, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: DATE, slots: [{ start: '09:00', end: '13:00' }] });
        await Shift.create({ provider: provider._id, teamMember: member._id, date: OTHER_DATE, slots: [] });

        const res = await shiftDays(provider, member, DATE, OTHER_DATE);

        expect(res.status).toBe(200);
        expect(res.body.data.working).toEqual([DATE, OTHER_DATE]);
        expect(res.body.data.off).toEqual([]);
    });

    it('never returns slot times or notes — only which days', async () => {
        const { provider, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: DATE, slots: [{ start: '09:00', end: '13:00' }], note: 'secret' });

        const res = await shiftDays(provider, member, DATE, OTHER_DATE);

        expect(JSON.stringify(res.body)).not.toContain('secret');
        expect(JSON.stringify(res.body)).not.toContain('09:00');
    });

    it('leaves out shifts beyond the range', async () => {
        const { provider, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: futureDate(19), slots: [{ start: '09:00', end: '13:00' }] });

        const res = await shiftDays(provider, member, DATE, OTHER_DATE);

        // Never the out-of-range shift. Days inside the range come from the
        // member's own weekly hours (09:00–17:00 every day) — their own, even as
        // the business's only bookable member.
        expect(res.body.data.working).toEqual([DATE, OTHER_DATE]);
        expect(res.body.data.working).not.toContain(futureDate(19));
        expect(res.body.data.off).toEqual([]);
    });

    it('rejects bad date params', async () => {
        const { provider, member } = await setup();
        const res = await shiftDays(provider, member, 'nope', OTHER_DATE);
        expect(res.status).toBe(400);
    });

    // Another business's member must never be reachable through this provider's id.
    it('hands back empty for a member that is not this provider\'s', async () => {
        const { provider } = await setup();
        const other = await makeProvider();
        const theirMember = await TeamMember.create({ provider: other._id, name: 'Not Yours' });

        const res = await shiftDays(provider, theirMember, DATE, OTHER_DATE);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ working: [], off: [] });
    });
});

// Rescheduling is held to the member's weekly hours — never to a shift row.
describe('rescheduling follows the weekly hours', () => {
    const Appointment = require('../../models/Appointment');

    it('refuses a customer moving a booking outside the weekly hours', async () => {
        const { provider, customer, svc, member } = await setup();
        // An old shift covering 18:00 does not open it.
        await Shift.create({ provider: provider._id, teamMember: member._id, date: OTHER_DATE, slots: [{ start: '12:00', end: '20:00' }] });

        const appt = await Appointment.create({
            customer: customer._id, service: svc._id, provider: provider._id, teamMember: member._id,
            appointmentDate: new Date(`${DATE}T00:00:00Z`), startTime: '10:00', endTime: '10:30',
            totalPrice: 50, status: 'confirmed',
        });

        const res = await request(app)
            .put(`/api/appointments/${appt._id}/reschedule`)
            .set(authHeader(customer))
            .send({ appointmentDate: OTHER_DATE, startTime: '18:00' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/working hours/i);
        // And it really did not move.
        expect((await Appointment.findById(appt._id)).startTime).toBe('10:00');
        expect((await Appointment.findById(appt._id)).appointmentDate.toISOString().slice(0, 10)).toBe(DATE);
    });

    it('lets a customer move a booking onto an old shift\'s break or day off', async () => {
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

        expect(res.status).toBe(200);
        expect((await Appointment.findById(appt._id)).startTime).toBe('13:15');
    });
});

// A shift no longer opens time outside the member's weekly hours. Business
// hours here are 08:00–18:00; the weekly hours 09:00–17:00; the shift to 20:00.
describe('a shift no longer opens time outside the weekly hours', () => {
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

    it('refuses it even when an old shift covers that time', async () => {
        const { provider, customer, svc, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: DATE, slots: [{ start: '12:00', end: '20:00' }] });

        const res = await book(customer, svc, member, OUT_OF_HOURS, '19:30');

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/working hours/i);
        expect(await Appointment.countDocuments({ teamMember: member._id })).toBe(0);
    });

    it('refuses a customer rescheduling onto a shift-covered out-of-hours slot', async () => {
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

        expect(res.status).toBe(400);
        expect((await Appointment.findById(appt._id)).startTime).toBe('10:00');
    });
});

// A recurring series is gated by the weekly hours and approved leave per
// occurrence; an old "day off" shift no longer skips one.
describe('a recurring series follows the weekly hours and leave', () => {
    const Appointment = require('../../models/Appointment');
    // DATE is a Wednesday; a weekly series lands on the next two Wednesdays too.
    const WEEK_1 = futureDate(7);
    const WEEK_2 = futureDate(14);

    const series = (customer, svc, member) => request(app)
        .post('/api/appointments')
        .set(authHeader(customer))
        .send({
            service: svc._id.toString(), appointmentDate: DATE,
            startTime: '10:00', endTime: '10:30', teamMember: member._id.toString(),
            isRecurring: true, recurrenceType: 'weekly', recurrenceEndDate: WEEK_2,
        });
    const bookedDays = async (member) => (await Appointment.find({ teamMember: member._id }).select('appointmentDate').lean())
        .map((a) => a.appointmentDate.toISOString().slice(0, 10));

    it('an old "day off" shift no longer skips an occurrence', async () => {
        const { provider, customer, svc, member } = await setup();
        await Shift.create({ provider: provider._id, teamMember: member._id, date: WEEK_1, slots: [] });

        const res = await series(customer, svc, member);

        expect(res.status).toBe(201);
        expect(res.body.skippedDates || []).not.toContain(WEEK_1);
        expect(await bookedDays(member)).toEqual(expect.arrayContaining([DATE, WEEK_1, WEEK_2]));
    });

    it('skips an occurrence the member is on approved leave for, keeps the rest', async () => {
        const { provider, customer, svc, member } = await setup();
        const TimeOff = require('../../models/TimeOff');
        await TimeOff.create({ provider: provider._id, teamMember: member._id, startDate: WEEK_1, endDate: WEEK_1, allDay: true, status: 'approved', type: 'vacation' });

        const res = await series(customer, svc, member);

        expect(res.status).toBe(201);
        expect(res.body.skippedDates).toContain(WEEK_1);

        const days = await bookedDays(member);
        expect(days).toContain(DATE);       // first occurrence
        expect(days).toContain(WEEK_2);     // last occurrence
        expect(days).not.toContain(WEEK_1); // on leave
    });
});

// The legacy routes still work (nothing crashes, nothing is deleted), but what
// they store has no effect on hours.
describe('managing shifts (legacy routes)', () => {
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

    it('saving or clearing a shift never changes the weekly hours', async () => {
        const ctx = await setup();
        await put(ctx.provider, ctx.member, { date: DATE, slots: [{ start: '12:00', end: '20:00' }] });
        expect((await tryBook(ctx, '10:00', '10:30')).teamMember).toBeTruthy();

        const res = await request(app)
            .delete(`/api/team/${ctx.member._id}/shifts/${DATE}`)
            .set(authHeader(ctx.provider));
        expect(res.status).toBe(200);

        // Still their usual 09:00–17:00.
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
