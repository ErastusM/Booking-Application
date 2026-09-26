/**
 * The owner's report: "The service is 2 hours but it's showing 14:00 as an
 * available slot … If you book a 2 hour service at 14:00 whilst 15:00 is
 * occupied the service won't be delivered."
 *
 * The rule, everywhere: a start is offered — and accepted — only if the WHOLE
 * service fits the person doing it: their real length (a member's own duration
 * included), inside their hours, clear of every booking of theirs (a segment of
 * a shared ticket, a group), their blocked time, breaks and leave. A booking
 * that ends exactly when the next starts is fine. A clash with a booking is a
 * 409 whatever the client sends; nothing genuinely free is refused.
 */
const request = require('supertest');
const { futureDate } = require('../helpers/dates');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');
const BlockedTime = require('../../models/BlockedTime');
const Shift = require('../../models/Shift');
const TimeOff = require('../../models/TimeOff');
const WaitingList = require('../../models/WaitingList');
const { promoteFromWaitingList } = require('../../utils/waitingListHelper');

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
const DATE = futureDate(0);
const day = new Date(`${DATE}T00:00:00.000Z`);
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

let seq = 0;
const setup = async ({ erastusCut } = {}) => {
    seq += 1;
    const provider = await makeProvider({ name: 'Vido Barber' });
    const customer = await makeUser({ name: 'Ndapewa Shikongo' });
    const other = await makeUser({ name: 'Tomas Nangolo' });
    const cut = await makeService(provider._id, { name: 'Cut', duration: 60, price: 100 });
    const braids = await makeService(provider._id, { name: 'Braids', duration: 120, price: 900 });
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '18:00') });
    const hilda = await TeamMember.create({ provider: provider._id, name: 'Hilda', offersAllServices: true });
    const erastusUser = await makeUser({ role: 'staff', staffOf: provider._id, name: 'Erastus Member', email: `erastus${seq}@sweep.test` });
    const erastus = await TeamMember.create({
        provider: provider._id, name: 'Erastus', offersAllServices: true, user: erastusUser._id,
        serviceOverrides: erastusCut ? [{ service: cut._id, duration: erastusCut, price: 170 }] : [],
    });
    return { provider, customer, other, cut, braids, hilda, erastus, erastusUser };
};

const book = (user, body) => request(app).post('/api/appointments').set(authHeader(user))
    .send({ appointmentDate: DATE, ...body, service: String(body.service) });
const walkIn = (ctx, body) => book(ctx.provider, { walkInName: 'Walk In', ...body });
// A confirmed booking already on the books.
const seed = (ctx, svc, teamMember, startTime, endTime, extra = {}) => makeAppointment(null, svc._id, ctx.provider._id, {
    walkInName: 'Existing', teamMember, status: 'confirmed', appointmentDate: day, startTime, endTime, ...extra,
});
const slots = (ctx, query) => request(app).get('/api/appointments/booked-slots')
    .query({ providerId: String(ctx.provider._id), date: DATE, ...query }).then((r) => r.body);
// Would the booking page offer a start? Only if [start, start + length) hits nothing busy.
const offered = (busy, start, length) => !busy.some((b) => mins(start) < mins(b.endTime) && mins(start) + length > mins(b.startTime));

describe("the owner's report — a 2-hour service next to a 15:00 booking", () => {
    it('a professional: 14:00 is not offered and is refused (409); 13:00 and 16:00 touch and are fine', async () => {
        const ctx = await setup();
        await seed(ctx, ctx.cut, ctx.erastus._id, '15:00', '16:00');

        const { data } = await slots(ctx, { teamMember: String(ctx.erastus._id), service: String(ctx.braids._id) });
        expect(offered(data, '14:00', 120)).toBe(false);
        expect(offered(data, '15:00', 120)).toBe(false);
        expect(offered(data, '13:00', 120)).toBe(true);
        expect(offered(data, '16:00', 120)).toBe(true);

        const refused = await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '14:00', endTime: '16:00' });
        expect(refused.status).toBe(409);
        expect(refused.body.message).toMatch(/already booked/i);

        const before = await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '13:00', endTime: '15:00' });
        expect(before.status).toBe(201);
        const after = await book(ctx.other, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '16:00', endTime: '18:00' });
        expect(after.status).toBe(201);
    });

    it("the owner's own column, booked by a client and by the owner", async () => {
        const ctx = await setup();
        expect((await walkIn(ctx, { service: ctx.cut._id, startTime: '15:00', endTime: '16:00' })).status).toBe(201);

        const { data } = await slots(ctx, { teamMember: 'owner', service: String(ctx.braids._id) });
        expect(offered(data, '14:00', 120)).toBe(false);
        expect(offered(data, '13:00', 120)).toBe(true);

        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: 'owner', startTime: '14:00', endTime: '16:00' })).status).toBe(409);
        expect((await walkIn(ctx, { service: ctx.braids._id, startTime: '14:00', endTime: '16:00' })).status).toBe(409);
        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: 'owner', startTime: '13:00', endTime: '15:00' })).status).toBe(201);
    });

    it('the screenshot: a day that ends at 16:00 — 14:00 is genuinely free, 15:00 cannot START a 2-hour service', async () => {
        const ctx = await setup();
        await StaffAvailability.create({ provider: ctx.provider._id, teamMember: ctx.erastus._id, schedule: everyDay('13:00', '16:00') });
        const { data } = await slots(ctx, { teamMember: String(ctx.erastus._id), service: String(ctx.braids._id) });
        expect(offered(data, '13:00', 120)).toBe(true);
        expect(offered(data, '14:00', 120)).toBe(true);
        expect(offered(data, '15:00', 120)).toBe(false);
        // What stops 15:00 is the end of the day, not a booking.
        expect(data.filter((b) => b.kind === 'appointment')).toEqual([]);

        const late = await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '15:00', endTime: '17:00' });
        expect(late.status).toBe(400);
        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '14:00', endTime: '16:00' })).status).toBe(201);
    });

    it('every length: 30/45/60 fit before 15:00 at 14:00; 90 and 120 do not', async () => {
        const ctx = await setup();
        await seed(ctx, ctx.cut, null, '15:00', '16:00');
        for (const [length, ok] of [[30, true], [45, true], [60, true], [90, false], [120, false]]) {
            const svc = await makeService(ctx.provider._id, { name: `S${length}`, duration: length });
            const end = `${String(Math.floor((840 + length) / 60)).padStart(2, '0')}:${String((840 + length) % 60).padStart(2, '0')}`;
            const res = await book(ctx.customer, { service: svc._id, teamMember: 'owner', startTime: '14:00', endTime: end });
            expect(res.status).toBe(ok ? 201 : 409);
            if (ok) await Appointment.deleteOne({ _id: res.body.data._id });
        }
    });
});

describe('the server trusts no window shorter than the service', () => {
    it("the owner posting a 2-hour service as 14:00–15:00 next to 15:00 is refused; with room it is stored as 2 hours", async () => {
        const ctx = await setup();
        await seed(ctx, ctx.cut, null, '15:00', '16:00');
        expect((await walkIn(ctx, { service: ctx.braids._id, startTime: '14:00', endTime: '15:00' })).status).toBe(409);

        const ok = await walkIn(ctx, { service: ctx.braids._id, startTime: '10:00', endTime: '11:00' });
        expect(ok.status).toBe(201);
        expect(ok.body.data.endTime).toBe('12:00');
        // …and nothing can then be put inside the real 2 hours.
        expect((await walkIn(ctx, { service: ctx.cut._id, startTime: '11:00', endTime: '12:00' })).status).toBe(409);
    });

    it('the owner may still book LONGER than the service', async () => {
        const ctx = await setup();
        const res = await walkIn(ctx, { service: ctx.cut._id, startTime: '09:00', endTime: '11:00' });
        expect(res.status).toBe(201);
        expect(res.body.data.endTime).toBe('11:00');
    });
});

describe("a member's own duration (#228) is the length every check uses", () => {
    it('Erastus takes 120 minutes for a Cut: no path fits it as 60 minutes before his 15:00', async () => {
        const ctx = await setup({ erastusCut: 120 });
        await seed(ctx, ctx.cut, ctx.erastus._id, '15:00', '16:00', { status: 'pending' });

        // The owner (who skips the client length check) posting it as one hour.
        expect((await walkIn(ctx, { service: ctx.cut._id, teamMember: String(ctx.erastus._id), startTime: '14:00', endTime: '15:00' })).status).toBe(409);
        // A client at his real length.
        expect((await book(ctx.customer, { service: ctx.cut._id, teamMember: String(ctx.erastus._id), startTime: '14:00', endTime: '16:00' })).status).toBe(409);
        // Erastus himself, from his own login.
        const staff = await request(app).post('/api/appointments').set(authHeader(ctx.erastusUser))
            .send({ service: String(ctx.cut._id), appointmentDate: DATE, startTime: '14:00', endTime: '16:00', walkInName: 'Walk In' });
        expect(staff.status).toBe(409);
        // 12:00–14:00 touches nothing.
        expect((await book(ctx.customer, { service: ctx.cut._id, teamMember: String(ctx.erastus._id), startTime: '12:00', endTime: '14:00' })).status).toBe(201);
    });

    it('"any available" tests each person at THEIR length — nobody free for the whole Cut is a 409, not a double booking', async () => {
        const ctx = await setup({ erastusCut: 120 });
        await seed(ctx, ctx.cut, ctx.hilda._id, '13:00', '14:30');
        await seed(ctx, ctx.cut, ctx.erastus._id, '15:00', '16:00');

        const res = await book(ctx.customer, { service: ctx.cut._id, startTime: '14:00', endTime: '15:00' });
        expect(res.status).toBe(409);
        expect(await Appointment.countDocuments({ teamMember: ctx.erastus._id })).toBe(1);

        // The "any professional" view agrees: 14:00 is no one's whole booking.
        const view = await slots(ctx, { service: String(ctx.cut._id), duration: 60 });
        expect(offered(view.data, '14:00', 60)).toBe(false);
        const open = (t) => view.openStarts.some((r) => mins(t) >= mins(r.start) && mins(t) <= mins(r.end));
        expect(open('14:00')).toBe(false);
        expect(open('16:00')).toBe(true);  // either is free
        expect(open('14:30')).toBe(true);  // Hilda, 14:30–15:30
    });

    it('"any available" books the chosen person at their length, at the menu price the client was quoted', async () => {
        const ctx = await setup({ erastusCut: 120 });
        await seed(ctx, ctx.cut, ctx.hilda._id, '13:00', '14:30');
        const res = await book(ctx.customer, { service: ctx.cut._id, startTime: '14:00', endTime: '15:00' });
        expect(res.status).toBe(201);
        expect(String(res.body.data.teamMember)).toBe(String(ctx.erastus._id));
        expect(res.body.data.endTime).toBe('16:00');
        // The page quotes the menu price when no professional is picked; the
        // member's own price is only for a booking made with them by name.
        expect(res.body.data.totalPrice).toBe(100);
        // 15:00 now goes to Hilda (free from 14:30), never on top of Erastus.
        const next = await book(ctx.other, { service: ctx.cut._id, startTime: '15:00', endTime: '16:00' });
        expect(next.status).toBe(201);
        expect(String(next.body.data.teamMember)).toBe(String(ctx.hilda._id));
    });

    it("the view merges nobody's gaps: Hilda free 13:00–14:30 + Erastus free from 15:00 is no 2-hour 14:00", async () => {
        const ctx = await setup();
        await seed(ctx, ctx.cut, ctx.hilda._id, '14:30', '18:00');
        await seed(ctx, ctx.cut, ctx.erastus._id, '08:00', '15:00');
        const view = await slots(ctx, { service: String(ctx.braids._id), duration: 120 });
        expect(offered(view.data, '14:00', 120)).toBe(false);
        expect(offered(view.data, '12:00', 120)).toBe(true);   // Hilda 12:00–14:00
        expect(offered(view.data, '15:00', 120)).toBe(true);   // Erastus 15:00–17:00
        expect((await book(ctx.customer, { service: ctx.braids._id, startTime: '14:00', endTime: '16:00' })).status).toBe(409);
        expect((await book(ctx.customer, { service: ctx.braids._id, startTime: '15:00', endTime: '17:00' })).status).toBe(201);
    });
});

describe('blocked time, breaks and leave count for the whole service', () => {
    it("a member's own block at 15:00 stops a 2-hour 14:00 for them only", async () => {
        const ctx = await setup();
        await BlockedTime.create({ provider: ctx.provider._id, date: DATE, startTime: '15:00', endTime: '16:00', teamMember: ctx.erastus._id });
        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '14:00', endTime: '16:00' })).status).toBe(400);
        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '13:00', endTime: '15:00' })).status).toBe(201);
        expect((await book(ctx.other, { service: ctx.braids._id, teamMember: String(ctx.hilda._id), startTime: '14:00', endTime: '16:00' })).status).toBe(201);
    });

    it("an owner-only block closes the owner's column, not the team's; a business-wide block closes both", async () => {
        const ctx = await setup();
        await BlockedTime.create({ provider: ctx.provider._id, date: DATE, startTime: '15:00', endTime: '16:00', teamMember: null, ownerOnly: true });
        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: 'owner', startTime: '14:00', endTime: '16:00' })).status).toBe(400);
        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.hilda._id), startTime: '14:00', endTime: '16:00' })).status).toBe(201);
        await BlockedTime.create({ provider: ctx.provider._id, date: DATE, startTime: '11:00', endTime: '12:00', teamMember: null });
        expect((await book(ctx.other, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '10:00', endTime: '12:00' })).status).toBe(400);
    });

    it('a shift break and approved leave at 15:00 stop a 2-hour 14:00', async () => {
        const ctx = await setup();
        await Shift.create({ provider: ctx.provider._id, teamMember: ctx.erastus._id, date: DATE, slots: [{ start: '08:00', end: '18:00' }], breaks: [{ start: '15:00', end: '16:00' }] });
        await TimeOff.create({ provider: ctx.provider._id, teamMember: ctx.hilda._id, startDate: DATE, endDate: DATE, allDay: false, startTime: '15:00', endTime: '16:00', status: 'approved' });
        for (const m of [ctx.erastus, ctx.hilda]) {
            expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: String(m._id), startTime: '14:00', endTime: '16:00' })).status).toBe(400);
        }
        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '13:00', endTime: '15:00' })).status).toBe(201);
    });
});

describe('multi-service tickets: each person is busy for their own segment', () => {
    const multi = (ctx, startTime, services) => request(app).post('/api/appointments/multi').set(authHeader(ctx.provider))
        .send({ appointmentDate: DATE, startTime, walkInName: 'Ticket', services });

    it('Hilda 14:00–15:00 + Erastus 15:00–16:00: Erastus can’t take 2 hours at 14:00; Hilda is free at 15:00', async () => {
        const ctx = await setup();
        const t = await multi(ctx, '14:00', [
            { serviceId: String(ctx.cut._id), teamMember: String(ctx.hilda._id) },
            { serviceId: String(ctx.cut._id), teamMember: String(ctx.erastus._id) },
        ]);
        expect(t.status).toBe(201);

        const erastusView = await slots(ctx, { teamMember: String(ctx.erastus._id) });
        expect(erastusView.data.filter((b) => b.kind === 'appointment')).toEqual([expect.objectContaining({ startTime: '15:00', endTime: '16:00' })]);
        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '14:00', endTime: '16:00' })).status).toBe(409);
        expect((await walkIn(ctx, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '14:00', endTime: '16:00' })).status).toBe(409);
        expect((await book(ctx.customer, { service: ctx.cut._id, teamMember: String(ctx.hilda._id), startTime: '15:00', endTime: '16:00' })).status).toBe(201);
    });

    it("the owner's unassigned segment on a member's ticket is the owner's busy time — and only that", async () => {
        const ctx = await setup();
        const t = await multi(ctx, '10:00', [
            { serviceId: String(ctx.cut._id), teamMember: String(ctx.hilda._id) },
            { serviceId: String(ctx.cut._id) },
        ]);
        expect(t.status).toBe(201);
        expect(String(t.body.data.teamMember)).toBe(String(ctx.hilda._id));

        const ownerView = await slots(ctx, { teamMember: 'owner' });
        expect(ownerView.data.filter((b) => b.kind === 'appointment')).toEqual([expect.objectContaining({ startTime: '11:00', endTime: '12:00' })]);
        expect((await walkIn(ctx, { service: ctx.cut._id, startTime: '11:00', endTime: '12:00' })).status).toBe(409);
        expect((await book(ctx.customer, { service: ctx.cut._id, teamMember: 'owner', startTime: '10:00', endTime: '11:00' })).status).toBe(201);
    });

    it("the owner's own multi-service booking is not refused for a colleague's booking", async () => {
        const ctx = await setup();
        await seed(ctx, ctx.cut, ctx.hilda._id, '10:00', '11:00');
        const t = await multi(ctx, '10:00', [{ serviceId: String(ctx.cut._id) }, { serviceId: String(ctx.cut._id) }]);
        expect(t.status).toBe(201);
    });
});

describe('group bookings', () => {
    it('a group at 15:00 blocks a 2-hour 14:00, and a group can’t be posted shorter than its service', async () => {
        const ctx = await setup();
        const g = await request(app).post('/api/appointments/group').set(authHeader(ctx.provider)).send({
            service: String(ctx.cut._id), appointmentDate: DATE, startTime: '15:00', endTime: '16:00',
            teamMember: String(ctx.hilda._id), clients: [{ name: 'Group A' }, { name: 'Group B' }],
        });
        expect(g.status).toBe(201);
        expect((await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.hilda._id), startTime: '14:00', endTime: '16:00' })).status).toBe(409);

        const short = await request(app).post('/api/appointments/group').set(authHeader(ctx.provider)).send({
            service: String(ctx.braids._id), appointmentDate: DATE, startTime: '14:00', endTime: '15:00',
            teamMember: String(ctx.hilda._id), clients: [{ name: 'Group C' }, { name: 'Group D' }],
        });
        expect(short.status).toBe(409);

        const fits = await request(app).post('/api/appointments/group').set(authHeader(ctx.provider)).send({
            service: String(ctx.braids._id), appointmentDate: DATE, startTime: '12:00', endTime: '13:00',
            teamMember: String(ctx.hilda._id), clients: [{ name: 'Group E' }, { name: 'Group F' }],
        });
        expect(fits.status).toBe(201);
        expect(fits.body.data.map((a) => a.endTime)).toEqual(['14:00', '14:00']);
    });
});

describe('reschedule — client, guest and owner', () => {
    it('a 2-hour booking can’t be moved to 14:00 next to 15:00; 13:00 is fine', async () => {
        const ctx = await setup();
        const mine = await book(ctx.customer, { service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '09:00', endTime: '11:00' });
        expect(mine.status).toBe(201);
        await seed(ctx, ctx.cut, ctx.erastus._id, '15:00', '16:00');
        const id = mine.body.data._id;

        // The reschedule picker sees Erastus's time without the booking being moved.
        const view = await slots(ctx, { teamMember: String(ctx.erastus._id), exclude: id });
        expect(offered(view.data, '10:00', 120)).toBe(true);   // overlaps only itself
        expect(offered(view.data, '14:00', 120)).toBe(false);

        const client = await request(app).put(`/api/appointments/${id}/reschedule`).set(authHeader(ctx.customer)).send({ appointmentDate: DATE, startTime: '14:00' });
        expect(client.status).toBe(409);
        const owner = await request(app).put(`/api/appointments/${id}/provider-reschedule`).set(authHeader(ctx.provider)).send({ appointmentDate: DATE, startTime: '14:00' });
        expect(owner.status).toBe(409);
        const token = (await Appointment.findById(id)).manageToken;
        const guest = await request(app).post(`/api/appointments/manage/${token}/reschedule`).send({ appointmentDate: DATE, startTime: '14:00' });
        expect(guest.status).toBe(409);

        const moved = await request(app).put(`/api/appointments/${id}/reschedule`).set(authHeader(ctx.customer)).send({ appointmentDate: DATE, startTime: '13:00' });
        expect(moved.status).toBe(200);
        expect(moved.body.data.endTime).toBe('15:00');
    });

    it('a multi-service ticket is checked segment by segment at its new time', async () => {
        const ctx = await setup();
        const t = await request(app).post('/api/appointments/multi').set(authHeader(ctx.provider)).send({
            appointmentDate: DATE, startTime: '09:00', walkInName: 'Ticket',
            services: [
                { serviceId: String(ctx.cut._id), teamMember: String(ctx.hilda._id) },
                { serviceId: String(ctx.cut._id), teamMember: String(ctx.erastus._id) },
            ],
        });
        expect(t.status).toBe(201);
        await seed(ctx, ctx.cut, ctx.erastus._id, '15:00', '16:00');
        await seed(ctx, ctx.cut, ctx.hilda._id, '15:30', '16:30');

        // 14:00: Erastus's segment would be 15:00–16:00, on his booking.
        const clash = await request(app).put(`/api/appointments/${t.body.data._id}/provider-reschedule`).set(authHeader(ctx.provider)).send({ appointmentDate: DATE, startTime: '14:00' });
        expect(clash.status).toBe(409);
        // 13:00: Hilda 13–14, Erastus 14–15 — both free. (Checking the whole
        // 13:00–15:00 span against Hilda alone used to be the only check.)
        const ok = await request(app).put(`/api/appointments/${t.body.data._id}/provider-reschedule`).set(authHeader(ctx.provider)).send({ appointmentDate: DATE, startTime: '13:00' });
        expect(ok.status).toBe(200);
        expect(ok.body.data.services.map((s) => `${s.startTime}-${s.endTime}`)).toEqual(['13:00-14:00', '14:00-15:00']);
    });

    it('moving a ticket onto time only the colleague needs is not refused for the primary', async () => {
        const ctx = await setup();
        const t = await request(app).post('/api/appointments/multi').set(authHeader(ctx.provider)).send({
            appointmentDate: DATE, startTime: '09:00', walkInName: 'Ticket',
            services: [
                { serviceId: String(ctx.cut._id), teamMember: String(ctx.hilda._id) },
                { serviceId: String(ctx.cut._id), teamMember: String(ctx.erastus._id) },
            ],
        });
        // Hilda is busy 15:00–16:00, but at 14:00 she only does 14–15; Erastus does 15–16.
        await seed(ctx, ctx.cut, ctx.hilda._id, '15:00', '16:00');
        const res = await request(app).put(`/api/appointments/${t.body.data._id}/provider-reschedule`).set(authHeader(ctx.provider)).send({ appointmentDate: DATE, startTime: '14:00' });
        expect(res.status).toBe(200);
    });
});

describe('recurring series', () => {
    it('skips the week where the whole 2 hours would run into a booking, and books the rest', async () => {
        const ctx = await setup();
        const week2 = futureDate(7);
        await makeAppointment(null, ctx.cut._id, ctx.provider._id, {
            walkInName: 'Existing', teamMember: ctx.erastus._id, status: 'confirmed',
            appointmentDate: new Date(`${week2}T00:00:00.000Z`), startTime: '15:00', endTime: '16:00',
        });
        const res = await book(ctx.customer, {
            service: ctx.braids._id, teamMember: String(ctx.erastus._id), startTime: '14:00', endTime: '16:00',
            isRecurring: true, recurrenceType: 'weekly', recurrenceInterval: 1, recurrenceEndDate: futureDate(14),
        });
        expect(res.status).toBe(201);
        expect(res.body.skippedDates).toEqual([week2]);
        const series = await Appointment.find({ recurrenceGroupId: res.body.data.recurrenceGroupId }).lean();
        expect(series.map((a) => a.appointmentDate.toISOString().slice(0, 10)).sort()).toEqual([DATE, futureDate(14)]);
    });
});

describe('waiting-list promotion books the whole service for the person', () => {
    const waitOn = async (ctx, teamMember) => WaitingList.create({
        customer: ctx.other._id, provider: ctx.provider._id, service: ctx.cut._id, teamMember,
        appointmentDate: day, startTime: '14:00', endTime: '15:00', position: 1,
    });

    it('does not promote into a slot where their length runs into the next booking', async () => {
        const ctx = await setup({ erastusCut: 120 });
        await seed(ctx, ctx.cut, ctx.erastus._id, '15:00', '16:00');
        const entry = await waitOn(ctx, ctx.erastus._id);
        await promoteFromWaitingList(ctx.cut._id, day, '14:00', '15:00');
        expect((await WaitingList.findById(entry._id)).status).toBe('waiting');
        expect(await Appointment.countDocuments({ teamMember: ctx.erastus._id })).toBe(1);
    });

    it('promotes at their length when it fits', async () => {
        const ctx = await setup({ erastusCut: 120 });
        const entry = await waitOn(ctx, ctx.erastus._id);
        await promoteFromWaitingList(ctx.cut._id, day, '14:00', '15:00');
        expect((await WaitingList.findById(entry._id)).status).toBe('promoted');
        const promoted = await Appointment.findOne({ customer: ctx.other._id }).lean();
        expect(promoted).toMatchObject({ startTime: '14:00', endTime: '16:00', totalPrice: 170 });
    });
});

describe('reassigning a booking books the new person at THEIR length', () => {
    const drag = (ctx, id, body) => request(app).put(`/api/appointments/${id}/provider-reschedule`).set(authHeader(ctx.provider))
        .send({ appointmentDate: DATE, ...body });

    it("a Cut dragged from Hilda (60) to Erastus (120) can't sit an hour before his 15:00; with room it is stored as 2 hours", async () => {
        const ctx = await setup({ erastusCut: 120 });
        const hilda = await seed(ctx, ctx.cut, ctx.hilda._id, '10:00', '11:00');
        await seed(ctx, ctx.cut, ctx.erastus._id, '15:00', '17:00');

        // The calendar sends the card's own end with the new lane.
        const clash = await drag(ctx, hilda._id, { startTime: '14:00', endTime: '15:00', teamMember: String(ctx.erastus._id) });
        expect(clash.status).toBe(409);
        expect((await Appointment.findById(hilda._id)).teamMember.toString()).toBe(String(ctx.hilda._id));

        const ok = await drag(ctx, hilda._id, { startTime: '12:00', endTime: '13:00', teamMember: String(ctx.erastus._id) });
        expect(ok.status).toBe(200);
        expect(ok.body.data).toMatchObject({ startTime: '12:00', endTime: '14:00' });
        // 13:00–15:00 touches his 15:00 booking.
        const hilda2 = await seed(ctx, ctx.cut, ctx.hilda._id, '09:00', '10:00');
        expect((await drag(ctx, hilda2._id, { startTime: '10:00', endTime: '11:00', teamMember: String(ctx.erastus._id) })).status).toBe(200);

        // Back to Hilda: her own length, and a longer stretch the owner chose is kept.
        const back = await drag(ctx, hilda._id, { startTime: '16:00', endTime: '18:00', teamMember: String(ctx.hilda._id) });
        expect(back.status).toBe(200);
        expect(back.body.data.endTime).toBe('18:00');
        // 'owner' is the owner's own column, not a roster id.
        const toOwner = await drag(ctx, hilda2._id, { startTime: '08:00', endTime: '09:00', teamMember: 'owner' });
        expect(toOwner.status).toBe(200);
        expect(toOwner.body.data.teamMember).toBeNull();
    });

    it('a handover moves a single booking at the target’s length, and skips it when that runs into their next booking', async () => {
        const ctx = await setup({ erastusCut: 120 });
        const fits = await seed(ctx, ctx.cut, ctx.hilda._id, '10:00', '11:00');
        const clashes = await seed(ctx, ctx.cut, ctx.hilda._id, '14:00', '15:00');
        await seed(ctx, ctx.cut, ctx.erastus._id, '15:00', '16:00');
        const res = await request(app).post(`/api/team/${ctx.hilda._id}/handover`).set(authHeader(ctx.provider)).send({ to: String(ctx.erastus._id) });
        expect(res.status).toBe(200);
        expect(res.body.data.moved).toBe(1);
        expect(res.body.data.skipped.map((s) => String(s.id))).toEqual([String(clashes._id)]);
        expect(await Appointment.findById(fits._id).lean()).toMatchObject({ startTime: '10:00', endTime: '12:00' });
        expect(String((await Appointment.findById(clashes._id)).teamMember)).toBe(String(ctx.hilda._id));
    });
});

describe('stretching a multi-service ticket on the calendar', () => {
    const ticket = async (ctx, services) => {
        const t = await request(app).post('/api/appointments/multi').set(authHeader(ctx.provider))
            .send({ appointmentDate: DATE, startTime: '10:00', walkInName: 'Ticket', services });
        expect(t.status).toBe(201);
        return t.body.data;
    };

    it("can't be stretched over the performer's next booking — batch resize, single resize and admin edit", async () => {
        const ctx = await setup();
        const t = await ticket(ctx, [
            { serviceId: String(ctx.cut._id), teamMember: String(ctx.hilda._id) },
            { serviceId: String(ctx.cut._id), teamMember: String(ctx.hilda._id) },
        ]);
        await seed(ctx, ctx.cut, ctx.hilda._id, '12:30', '13:30');

        const batch = await request(app).post('/api/appointments/batch-reschedule').set(authHeader(ctx.provider)).send({
            allowOutsideHours: true,
            moves: [{ id: t._id, appointmentDate: DATE, startTime: '10:00', endTime: '13:30' }],
        });
        expect(batch.status).toBe(409);
        const single = await request(app).put(`/api/appointments/${t._id}/provider-reschedule`).set(authHeader(ctx.provider))
            .send({ appointmentDate: DATE, startTime: '10:00', endTime: '13:30' });
        expect(single.status).toBe(409);
        expect(await Appointment.findById(t._id).lean()).toMatchObject({ startTime: '10:00', endTime: '12:00' });

        // Up to the booking (touching) is fine…
        const touch = await request(app).post('/api/appointments/batch-reschedule').set(authHeader(ctx.provider)).send({
            allowOutsideHours: true,
            moves: [{ id: t._id, appointmentDate: DATE, startTime: '10:00', endTime: '12:30' }],
        });
        expect(touch.status).toBe(200);
        // …and the stretch is then Hilda's time: nothing goes on top of it.
        expect((await book(ctx.customer, { service: ctx.cut._id, teamMember: String(ctx.hilda._id), startTime: '11:30', endTime: '12:30' })).status).toBe(409);
        const view = await slots(ctx, { teamMember: String(ctx.hilda._id) });
        expect(offered(view.data, '12:00', 30)).toBe(false);
    });

    it("the stretch belongs to the ticket's own person (the lane it is drawn in), not the colleague", async () => {
        const ctx = await setup();
        const t = await ticket(ctx, [
            { serviceId: String(ctx.cut._id), teamMember: String(ctx.hilda._id) },
            { serviceId: String(ctx.cut._id), teamMember: String(ctx.erastus._id) },
        ]);
        await seed(ctx, ctx.cut, ctx.hilda._id, '12:30', '13:30');
        const res = await request(app).put(`/api/appointments/${t._id}/provider-reschedule`).set(authHeader(ctx.provider))
            .send({ appointmentDate: DATE, startTime: '10:00', endTime: '13:30' });
        expect(res.status).toBe(409);
        // Erastus's booking at 12:30 doesn't stop Hilda's ticket growing (his part ends at 12:00).
        await Appointment.deleteMany({ teamMember: ctx.hilda._id, walkInName: 'Existing' });
        await seed(ctx, ctx.cut, ctx.erastus._id, '12:30', '13:30');
        const ok = await request(app).put(`/api/appointments/${t._id}/provider-reschedule`).set(authHeader(ctx.provider))
            .send({ appointmentDate: DATE, startTime: '10:00', endTime: '13:30' });
        expect(ok.status).toBe(200);
    });
});

describe("a booking's own buffers on every path", () => {
    it("a guest moving a Colour (30 min clean-up) can't land flush against the next booking; a signed-in client can't either", async () => {
        const ctx = await setup();
        const colour = await makeService(ctx.provider._id, { name: 'Colour', duration: 60, bufferAfter: 30 });
        const mine = await book(ctx.customer, { service: colour._id, teamMember: String(ctx.hilda._id), startTime: '09:00', endTime: '10:00' });
        expect(mine.status).toBe(201);
        await seed(ctx, ctx.cut, ctx.hilda._id, '15:00', '16:00');
        const token = (await Appointment.findById(mine.body.data._id)).manageToken;
        const guest = await request(app).post(`/api/appointments/manage/${token}/reschedule`).send({ appointmentDate: DATE, startTime: '14:00' });
        expect(guest.status).toBe(409);
        const client = await request(app).put(`/api/appointments/${mine.body.data._id}/reschedule`).set(authHeader(ctx.customer)).send({ appointmentDate: DATE, startTime: '14:00' });
        expect(client.status).toBe(409);
        expect((await request(app).post(`/api/appointments/manage/${token}/reschedule`).send({ appointmentDate: DATE, startTime: '13:30' })).status).toBe(200);
    });

    it('reviving a cancelled Colour keeps its clean-up time clear', async () => {
        const ctx = await setup();
        const colour = await makeService(ctx.provider._id, { name: 'Colour', duration: 60, bufferAfter: 30 });
        const old = await seed(ctx, colour, ctx.hilda._id, '14:00', '15:00', { status: 'cancelled' });
        await seed(ctx, ctx.cut, ctx.hilda._id, '15:00', '16:00');
        const res = await request(app).put(`/api/appointments/${old._id}/status`).set(authHeader(ctx.provider)).send({ status: 'confirmed' });
        expect(res.status).toBe(409);
    });

    it("a multi-service segment keeps its own clean-up time clear, as a single booking does", async () => {
        const ctx = await setup();
        const colour = await makeService(ctx.provider._id, { name: 'Colour', duration: 60, bufferAfter: 30 });
        await seed(ctx, ctx.cut, ctx.hilda._id, '15:00', '16:00');
        const single = await walkIn(ctx, { service: colour._id, teamMember: String(ctx.hilda._id), startTime: '14:00', endTime: '15:00' });
        expect(single.status).toBe(409);
        const multi = await request(app).post('/api/appointments/multi').set(authHeader(ctx.provider)).send({
            appointmentDate: DATE, startTime: '13:00', walkInName: 'Ticket',
            services: [
                { serviceId: String(ctx.cut._id), teamMember: String(ctx.erastus._id) },
                { serviceId: String(colour._id), teamMember: String(ctx.hilda._id) },
            ],
        });
        expect(multi.status).toBe(409);
        const room = await request(app).post('/api/appointments/multi').set(authHeader(ctx.provider)).send({
            appointmentDate: DATE, startTime: '12:30', walkInName: 'Ticket',
            services: [
                { serviceId: String(ctx.cut._id), teamMember: String(ctx.erastus._id) },
                { serviceId: String(colour._id), teamMember: String(ctx.hilda._id) },
            ],
        });
        expect(room.status).toBe(201);
    });

    it("a named person's view keeps the NEW booking's buffers clear too — what it offers, the server takes", async () => {
        const ctx = await setup();
        const colour = await makeService(ctx.provider._id, { name: 'Colour', duration: 60, bufferBefore: 15, bufferAfter: 30 });
        await seed(ctx, ctx.cut, ctx.hilda._id, '15:00', '16:00');
        for (const lane of [String(ctx.hilda._id)]) {
            const { data } = await slots(ctx, { teamMember: lane, service: String(colour._id) });
            expect(offered(data, '14:00', 60)).toBe(false);  // clean-up to 15:30
            expect(offered(data, '16:00', 60)).toBe(false);  // set-up from 15:45
            expect(offered(data, '13:30', 60)).toBe(true);
            expect(offered(data, '16:15', 60)).toBe(true);
        }
        expect((await book(ctx.customer, { service: colour._id, teamMember: String(ctx.hilda._id), startTime: '14:00', endTime: '15:00' })).status).toBe(409);
        expect((await book(ctx.customer, { service: colour._id, teamMember: String(ctx.hilda._id), startTime: '16:00', endTime: '17:00' })).status).toBe(409);
        expect((await book(ctx.customer, { service: colour._id, teamMember: String(ctx.hilda._id), startTime: '13:30', endTime: '14:30' })).status).toBe(201);
        // The owner's column too.
        await seed(ctx, ctx.cut, null, '15:00', '16:00');
        const own = await slots(ctx, { teamMember: 'owner', service: String(colour._id) });
        expect(offered(own.data, '14:00', 60)).toBe(false);
        expect((await book(ctx.other, { service: colour._id, teamMember: 'owner', startTime: '14:00', endTime: '15:00' })).status).toBe(409);
    });
});

describe('"anyone" for a service only the owner does is the owner\'s column', () => {
    it("a colleague's booking doesn't grey the owner's free time", async () => {
        const ctx = await setup();
        await TeamMember.updateMany({ provider: ctx.provider._id }, { $set: { offersAllServices: false, services: [ctx.cut._id] } });
        await seed(ctx, ctx.cut, ctx.hilda._id, '15:00', '16:00');
        const view = await slots(ctx, { service: String(ctx.braids._id) });
        expect(view.openStarts).toBeUndefined();
        expect(offered(view.data, '14:00', 120)).toBe(true);
        const res = await book(ctx.customer, { service: ctx.braids._id, startTime: '14:00', endTime: '16:00' });
        expect(res.status).toBe(201);
        expect(res.body.data.teamMember).toBeNull();
        // …and the owner's own booking does grey it.
        const after = await slots(ctx, { service: String(ctx.braids._id) });
        expect(offered(after.data, '13:00', 120)).toBe(false);
        expect(offered(after.data, '12:00', 120)).toBe(true);
    });
});
