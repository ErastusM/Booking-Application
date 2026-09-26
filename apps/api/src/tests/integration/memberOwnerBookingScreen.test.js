/**
 * One app: a team member books from the owner's New Appointment screen — the
 * same "+ Add service" (multi-service), Group booking and "Repeat this
 * appointment" the owner has — but the server keeps the booking theirs:
 *   - in their OWN column (never a colleague's or the owner's);
 *   - only for the clients they serve;
 *   - at their OWN price and time for each service;
 *   - held to every guard a customer is (past, hours, blocked time).
 * And the calendar's people list (/team/mine/calendar) gives a member only
 * themselves. There are no access levels: a former View-only, Reception or
 * Manager member is held to exactly the same.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');
const TeamMember = require('../../models/TeamMember');
const BlockedTime = require('../../models/BlockedTime');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

let seq = 0;
const makeStaff = async (provider, tier, member = {}) => {
    seq += 1;
    const login = await makeUser({ role: 'staff', staffOf: provider._id, email: `oneapp-${seq}@test.com`, ...(tier !== undefined ? { staffTier: tier } : {}) });
    const row = await TeamMember.create({
        provider: provider._id, name: `Member ${seq}`, user: login._id, offersAllServices: true,
        email: `member-${seq}@private.test`, phone: `+2648100${seq}`, ...member,
    });
    return { login, member: row };
};

const weekday = (plus = 2) => {
    const d = new Date();
    d.setDate(d.getDate() + plus);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const idOf = (v) => String(v?._id || v);

const setup = async () => {
    const provider = await makeProvider({ name: 'Olivia Owner' });
    const cut = await makeService(provider._id, { name: 'Cut', price: 100, duration: 30 });
    const beard = await makeService(provider._id, { name: 'Beard', price: 60, duration: 20 });
    const erastus = await makeStaff(provider, 'low');
    const sarah = await makeStaff(provider, 'low');
    // Erastus charges his own price and takes his own time for Cut.
    erastus.member.serviceOverrides = [{ service: cut._id, price: 150, duration: 45 }];
    await erastus.member.save();
    const mine = await makeUser({ name: 'Tomas Shikongo' });
    const hers = await makeUser({ name: 'Ndapewa Amutenya' });
    await makeAppointment(mine._id, cut._id, provider._id, { status: 'completed', teamMember: erastus.member._id, startTime: '08:00', endTime: '08:30' });
    await makeAppointment(hers._id, cut._id, provider._id, { status: 'completed', teamMember: sarah.member._id, startTime: '08:00', endTime: '08:30' });
    return { provider, cut, beard, erastus, sarah, mine, hers };
};

const multi = (user, body) => request(app).post('/api/appointments/multi').set(authHeader(user)).send(body);
const group = (user, body) => request(app).post('/api/appointments/group').set(authHeader(user)).send(body);

describe('+ Add service (multi-service) for a team member', () => {
    it('books their own client for two services, in their own column, at their own price and time', async () => {
        const { cut, beard, erastus, mine } = await setup();
        const res = await multi(erastus.login, {
            appointmentDate: weekday(), startTime: '14:00', customerId: String(mine._id),
            services: [{ serviceId: String(cut._id) }, { serviceId: String(beard._id) }],
        });
        expect(res.status).toBe(201);
        const a = res.body.data;
        expect(idOf(a.customer)).toBe(String(mine._id));
        expect(idOf(a.teamMember)).toBe(String(erastus.member._id));
        expect(a.services.every((s) => idOf(s.teamMember) === String(erastus.member._id))).toBe(true);
        // Cut at HIS price (150) and time (45 min), Beard at the menu's 60 / 20 min.
        expect(a.totalPrice).toBe(210);
        expect(a.startTime).toBe('14:00');
        expect(a.endTime).toBe('15:05');
    });

    it("can't be pointed at a colleague's column — a Service provider's booking stays theirs", async () => {
        const { cut, erastus, sarah } = await setup();
        const res = await multi(erastus.login, {
            appointmentDate: weekday(), startTime: '14:00', walkInName: 'Walk In', teamMember: String(sarah.member._id),
            services: [{ serviceId: String(cut._id), teamMember: String(sarah.member._id) }],
        });
        expect(res.status).toBe(201);
        expect(idOf(res.body.data.teamMember)).toBe(String(erastus.member._id));
        expect(res.body.data.services.every((s) => idOf(s.teamMember) === String(erastus.member._id))).toBe(true);
    });

    it("refuses a colleague's client and never reveals who they are", async () => {
        const { cut, erastus, hers } = await setup();
        const res = await multi(erastus.login, {
            appointmentDate: weekday(), startTime: '14:00', customerId: String(hers._id), services: [{ serviceId: String(cut._id) }],
        });
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain('Ndapewa');
        expect(await Appointment.countDocuments({ customer: hers._id, status: 'confirmed' })).toBe(0);
    });

    it('works for a former View-only member too (there are no levels); is refused for another business', async () => {
        const { provider, cut, mine } = await setup();
        const viewer = await makeStaff(provider, 'basic');
        const r1 = await multi(viewer.login, { appointmentDate: weekday(), startTime: '14:00', walkInName: 'X', services: [{ serviceId: String(cut._id) }] });
        expect(r1.status).toBe(201);
        expect(idOf(r1.body.data.teamMember)).toBe(String(viewer.member._id));

        const other = await makeProvider();
        const stranger = await makeStaff(other, 'high');
        const r2 = await multi(stranger.login, { appointmentDate: weekday(), startTime: '14:00', customerId: String(mine._id), services: [{ serviceId: String(cut._id) }] });
        expect(r2.status).toBe(403);
    });

    it('holds a member to their own blocked time and to the past, like any customer', async () => {
        const { provider, cut, erastus } = await setup();
        const day = weekday();
        await BlockedTime.create({ provider: provider._id, teamMember: erastus.member._id, date: day, startTime: '13:00', endTime: '16:00' });
        const blocked = await multi(erastus.login, { appointmentDate: day, startTime: '14:00', walkInName: 'W', services: [{ serviceId: String(cut._id) }] });
        expect(blocked.status).toBe(400);

        const past = await multi(erastus.login, { appointmentDate: '2020-01-06', startTime: '10:00', walkInName: 'W', services: [{ serviceId: String(cut._id) }] });
        expect(past.status).toBe(400);
    });

    it("a former Reception member can't book a colleague's client or into a colleague's or the owner's column", async () => {
        const { provider, cut, sarah, hers } = await setup();
        const lina = await makeStaff(provider, 'medium');
        const onBehalf = await multi(lina.login, {
            appointmentDate: weekday(), startTime: '15:00', customerId: String(hers._id), teamMember: String(sarah.member._id),
            services: [{ serviceId: String(cut._id) }],
        });
        expect(onBehalf.status).toBe(403);
        for (const teamMember of [String(sarah.member._id), 'owner']) {
            const walkIn = await multi(lina.login, {
                appointmentDate: weekday(), startTime: '16:00', walkInName: 'Walk In', teamMember,
                services: [{ serviceId: String(cut._id), teamMember }],
            });
            expect(walkIn.status).toBe(201);
            expect(idOf(walkIn.body.data.teamMember)).toBe(String(lina.member._id));
            await Appointment.deleteOne({ _id: walkIn.body.data._id });
        }
    });
});

describe("#228's performer rules hold for a member's multi-service bookings", () => {
    it("a member can't book themselves for a service they don't perform", async () => {
        const { provider, erastus } = await setup();
        const other = await makeService(provider._id, { name: 'Nails', price: 80, duration: 30 });
        erastus.member.offersAllServices = false;
        erastus.member.services = [];
        await erastus.member.save();
        const res = await multi(erastus.login, { appointmentDate: weekday(), startTime: '14:00', walkInName: 'W', services: [{ serviceId: String(other._id) }] });
        expect(res.status).toBe(400);
    });
});

describe('Group booking for a team member', () => {
    it('books name-only guests into their own column, as walk-ins (never as the member)', async () => {
        const { cut, erastus } = await setup();
        const res = await group(erastus.login, {
            service: String(cut._id), appointmentDate: weekday(), startTime: '10:00', endTime: '10:45',
            clients: [{ name: 'Guest One' }, { name: 'Guest Two' }],
        });
        expect(res.status).toBe(201);
        expect(res.body.data).toHaveLength(2);
        res.body.data.forEach((a) => {
            expect(idOf(a.teamMember)).toBe(String(erastus.member._id));
            expect(a.customer).toBeNull();
            expect(a.totalPrice).toBe(150); // his price
        });
        expect(await Appointment.countDocuments({ customer: erastus.login._id })).toBe(0);
    });

    it("refuses a group that names a colleague's client", async () => {
        const { cut, erastus, hers } = await setup();
        const res = await group(erastus.login, {
            service: String(cut._id), appointmentDate: weekday(), startTime: '10:00', endTime: '10:45',
            clients: [{ name: 'Guest' }, { customerId: String(hers._id), name: 'x' }],
        });
        expect(res.status).toBe(403);
    });

    it('works for a former View-only member too', async () => {
        const { provider, cut } = await setup();
        const viewer = await makeStaff(provider, 'basic');
        const res = await group(viewer.login, {
            service: String(cut._id), appointmentDate: weekday(), startTime: '10:00', endTime: '10:30', clients: [{ name: 'G' }],
        });
        expect(res.status).toBe(201);
    });
});

describe('Repeat this appointment for a team member', () => {
    it('books a weekly series for their own client in their own column', async () => {
        const { cut, erastus, mine } = await setup();
        const day = weekday();
        const end = new Date(`${day}T12:00:00`); end.setDate(end.getDate() + 14);
        const res = await request(app).post('/api/appointments').set(authHeader(erastus.login)).send({
            service: String(cut._id), appointmentDate: day, startTime: '09:00', endTime: '09:45',
            customerId: String(mine._id), isRecurring: true, recurrenceType: 'weekly', recurrenceEndDate: end.toISOString().slice(0, 10),
        });
        expect(res.status).toBe(201);
        const series = await Appointment.find({ recurrenceGroupId: res.body.data.recurrenceGroupId });
        expect(series.length).toBe(3);
        series.forEach((a) => expect(String(a.teamMember)).toBe(String(erastus.member._id)));
    });
});

describe('The calendar people list (/team/mine/calendar)', () => {
    const roster = (user) => request(app).get('/api/team/mine/calendar').set(authHeader(user));

    it('gives a Service provider only themselves — no colleagues', async () => {
        const { erastus } = await setup();
        const res = await roster(erastus.login);
        expect(res.status).toBe(200);
        expect(res.body.data.members).toHaveLength(1);
        expect(res.body.data.members[0]).toMatchObject({ name: erastus.member.name, isMe: true });
        // Only the people on their own calendar — and not even prices.
        expect(res.body.data.members[0]).not.toHaveProperty('serviceOverrides');
        expect(res.body.data.owner.name).toBe('Olivia Owner');
    });

    it('a former Manager also gets only themselves — no colleagues, no prices', async () => {
        const { provider } = await setup();
        const hilda = await makeStaff(provider, 'high');
        const res = await roster(hilda.login);
        expect(res.status).toBe(200);
        expect(res.body.data.members).toHaveLength(1);
        expect(res.body.data.members[0]).toMatchObject({ isMe: true });
        const raw = JSON.stringify(res.body);
        expect(raw).not.toMatch(/@private\.test/);
        expect(raw).not.toMatch(/serviceOverrides/);
    });

    it('is refused to customers', async () => {
        const customer = await makeUser();
        const res = await roster(customer);
        expect(res.status).toBe(403);
    });
});
