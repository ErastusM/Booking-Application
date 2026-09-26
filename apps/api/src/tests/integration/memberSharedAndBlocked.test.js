/**
 * Two guards from the data-leak review.
 *
 * 1. A shared multi-service booking (a colleague or the owner does one of the
 *    segments) is the owner's to move or cancel. A team member who performs
 *    part of it can't change its status or reschedule it — that would move or
 *    cancel the other person's part too — and on the calendar list they see
 *    only their own segments' prices, with the total as their own share.
 * 2. "Respect blocks": once a client and the business owner have blocked each
 *    other, nobody books between them — through the multi-service and group
 *    paths too, for the owner and for members.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');
const TeamMember = require('../../models/TeamMember');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

let seq = 0;
const makeStaff = async (provider, name) => {
    seq += 1;
    const login = await makeUser({ role: 'staff', staffOf: provider._id, email: `shared-${seq}@test.com` });
    const member = await TeamMember.create({ provider: provider._id, name, user: login._id, offersAllServices: true });
    return { login, member };
};
const weekday = (plus = 3) => {
    const d = new Date();
    d.setDate(d.getDate() + plus);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const setup = async () => {
    const owner = await makeProvider();
    const cut = await makeService(owner._id, { name: 'Cut', price: 100 });
    const colour = await makeService(owner._id, { name: 'Colour', price: 300 });
    const erastus = await makeStaff(owner, 'Erastus');
    const sarah = await makeStaff(owner, 'Sarah');
    const client = await makeUser({ name: 'Tomas Client' });
    // Shared: Erastus does the Cut, Sarah the Colour. Erastus is the header performer.
    const shared = await makeAppointment(client._id, cut._id, owner._id, {
        status: 'confirmed', teamMember: erastus.member._id, totalPrice: 400, startTime: '10:00', endTime: '11:30',
        services: [
            { service: cut._id, name: 'Cut', price: 100, duration: 30, startTime: '10:00', endTime: '10:30', teamMember: erastus.member._id },
            { service: colour._id, name: 'Colour', price: 300, duration: 60, startTime: '10:30', endTime: '11:30', teamMember: sarah.member._id },
        ],
    });
    // Wholly his: a multi-service ticket where he does every segment.
    const whollyHis = await makeAppointment(client._id, cut._id, owner._id, {
        status: 'confirmed', teamMember: erastus.member._id, totalPrice: 200, startTime: '14:00', endTime: '15:00',
        services: [
            { service: cut._id, name: 'Cut', price: 100, duration: 30, startTime: '14:00', endTime: '14:30', teamMember: erastus.member._id },
            { service: cut._id, name: 'Cut', price: 100, duration: 30, startTime: '14:30', endTime: '15:00', teamMember: erastus.member._id },
        ],
    });
    return { owner, cut, colour, erastus, sarah, client, shared, whollyHis };
};

const status = (u, id, s) => request(app).put(`/api/appointments/${id}/status`).set(authHeader(u)).send({ status: s });
const reschedule = (u, id, body) => request(app).put(`/api/appointments/${id}/provider-reschedule`).set(authHeader(u)).send(body);

describe('a shared multi-service booking is the owner\'s to change', () => {
    it("a member who does one segment can't cancel, complete or reschedule it", async () => {
        const { erastus, sarah, shared } = await setup();
        for (const who of [erastus, sarah]) {
            for (const s of ['cancelled', 'completed']) {
                const res = await status(who.login, shared._id, s);
                expect(res.status).toBe(403);
                expect(res.body.message).toBe('Part of this booking is with someone else — ask the owner to change it.');
            }
            const moved = await reschedule(who.login, shared._id, { appointmentDate: weekday(), startTime: '12:00' });
            expect(moved.status).toBe(403);
            expect(moved.body.code).toBe('shared_booking');
        }
        const after = await Appointment.findById(shared._id);
        expect(after.status).toBe('confirmed');
        expect(after.startTime).toBe('10:00');
    });

    it('a booking wholly theirs (every segment) is still theirs to change', async () => {
        const { erastus, whollyHis } = await setup();
        expect((await status(erastus.login, whollyHis._id, 'completed')).status).toBe(200);
    });

    it('the owner still changes the shared booking', async () => {
        const { owner, shared } = await setup();
        expect((await status(owner, shared._id, 'cancelled')).status).toBe(200);
    });
});

describe("the calendar list never shows a member a colleague's money on a shared ticket", () => {
    it('strips the colleague\'s segment price and shows the total as their own share', async () => {
        const { erastus, sarah, shared, whollyHis } = await setup();
        const res = await request(app).get('/api/appointments?all=true').set(authHeader(erastus.login));
        expect(res.status).toBe(200);
        const s = res.body.data.find((a) => String(a._id) === String(shared._id));
        expect(s.totalPrice).toBe(100);
        const mine = s.services.find((x) => String(x.teamMember?._id || x.teamMember) === String(erastus.member._id));
        const hers = s.services.find((x) => String(x.teamMember?._id || x.teamMember) === String(sarah.member._id));
        expect(mine.price).toBe(100);
        expect(hers).not.toHaveProperty('price');
        // Paginated list too.
        const page = await request(app).get('/api/appointments').set(authHeader(sarah.login));
        const p = page.body.data.find((a) => String(a._id) === String(shared._id));
        expect(p.totalPrice).toBe(300);
        expect(p.services.find((x) => String(x.teamMember?._id || x.teamMember) === String(erastus.member._id))).not.toHaveProperty('price');
        // A ticket wholly his is unchanged.
        expect(res.body.data.find((a) => String(a._id) === String(whollyHis._id)).totalPrice).toBe(200);
    });

    it('the owner still sees every price and the full total', async () => {
        const { owner, shared } = await setup();
        const res = await request(app).get('/api/appointments?all=true').set(authHeader(owner));
        const s = res.body.data.find((a) => String(a._id) === String(shared._id));
        expect(s.totalPrice).toBe(400);
        expect(s.services.every((x) => typeof x.price === 'number')).toBe(true);
    });
});

describe('"Respect blocks" on multi-service and group bookings', () => {
    const multi = (u, body) => request(app).post('/api/appointments/multi').set(authHeader(u)).send(body);
    const group = (u, body) => request(app).post('/api/appointments/group').set(authHeader(u)).send(body);

    it.each([
        ['the client blocked the business', async (owner, client) => User.updateOne({ _id: client._id }, { $addToSet: { blockedUsers: owner._id } })],
        ['the business blocked the client', async (owner, client) => User.updateOne({ _id: owner._id }, { $addToSet: { blockedUsers: client._id } })],
    ])('%s: the owner and a member are refused, through multi and group', async (_label, block) => {
        const { owner, cut, erastus, client } = await setup();
        await block(owner, client);
        const day = weekday(5);
        const m1 = await multi(owner, { appointmentDate: day, startTime: '09:00', customerId: String(client._id), services: [{ serviceId: String(cut._id) }] });
        expect(m1.status).toBe(403);
        const m2 = await multi(erastus.login, { appointmentDate: day, startTime: '09:00', customerId: String(client._id), services: [{ serviceId: String(cut._id) }] });
        expect(m2.status).toBe(403);
        const g1 = await group(owner, { service: String(cut._id), appointmentDate: day, startTime: '16:00', endTime: '16:30', clients: [{ name: 'Guest' }, { customerId: String(client._id) }] });
        expect(g1.status).toBe(403);
        const g2 = await group(erastus.login, { service: String(cut._id), appointmentDate: day, startTime: '16:00', endTime: '16:30', clients: [{ customerId: String(client._id) }] });
        expect(g2.status).toBe(403);
        expect(await Appointment.countDocuments({ appointmentDate: { $gte: new Date(`${day}T00:00:00`) } })).toBe(0);
    });

    it('an unblocked client still books through both', async () => {
        const { owner, cut, client } = await setup();
        const day = weekday(5);
        expect((await multi(owner, { appointmentDate: day, startTime: '09:00', customerId: String(client._id), services: [{ serviceId: String(cut._id) }] })).status).toBe(201);
        expect((await group(owner, { service: String(cut._id), appointmentDate: day, startTime: '16:00', endTime: '16:30', clients: [{ customerId: String(client._id) }] })).status).toBe(201);
    });
});
