/**
 * A team member messaging a client. Every member messages the clients of the
 * bookings THEY perform, under THEIR OWN identity (sender = the staff user),
 * within the appointment's single thread. This suite pins:
 *   - a member performing the booking can read + send, and the message's sender
 *     is the member themselves — whatever access level they once had
 *   - a member who does NOT perform the booking is refused (403) — messaging a
 *     colleague's or the owner's clients is the owner's
 *   - cross-tenant: a staff member of another business cannot read/send (403)
 *   - a block between the client and the OWNER also stops staff (blocking the
 *     business blocks its staff)
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const TeamMember = require('../../models/TeamMember');
const Message = require('../../models/Message');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

let seq = 0;
const setup = async () => {
    seq += 1;
    const owner = await makeProvider();
    const svc = await makeService(owner._id);
    const customer = await makeUser({ email: `client-${seq}@test.com`, name: 'Client' });
    // Moses performs the booking; Junior (once a "Manager") does not.
    const staffYes = await makeUser({ role: 'staff', staffOf: owner._id, staffTier: 'low', email: `s-yes-${seq}@test.com`, name: 'Moses' });
    const staffNo = await makeUser({ role: 'staff', staffOf: owner._id, staffTier: 'high', email: `s-no-${seq}@test.com`, name: 'Junior' });
    const mosesRow = await TeamMember.create({ provider: owner._id, name: 'Moses', user: staffYes._id });
    await TeamMember.create({ provider: owner._id, name: 'Junior', user: staffNo._id });
    const appt = await makeAppointment(customer._id, svc._id, owner._id, { status: 'confirmed', teamMember: mosesRow._id });
    return { owner, svc, customer, appt, staffYes, staffNo };
};
const send = (as, apptId, content) => request(app).post(`/api/messages/${apptId}`).set(authHeader(as)).send({ content });
const read = (as, apptId) => request(app).get(`/api/messages/${apptId}`).set(authHeader(as));

describe('team member messaging — their own clients', () => {
    it('the member performing the booking messages the client AS THEMSELVES', async () => {
        const { customer, appt, staffYes } = await setup();
        const res = await send(staffYes, appt._id, 'Hi, running 10 min late — see you soon.');
        expect(res.status).toBe(201);
        expect(String(res.body.data.sender._id || res.body.data.sender)).toBe(String(staffYes._id)); // own identity
        expect(String(res.body.data.recipient)).toBe(String(customer._id));

        // The client sees it in the appointment thread, attributed to the staff member.
        const thread = await read(customer, appt._id);
        expect(thread.status).toBe(200);
        expect(thread.body.data.some((m) => String(m.sender._id || m.sender) === String(staffYes._id))).toBe(true);
    });

    it('a member who does not perform the booking is refused — even a former Manager', async () => {
        const { appt, staffNo } = await setup();
        expect((await send(staffNo, appt._id, 'hello')).status).toBe(403);
        expect((await read(staffNo, appt._id)).status).toBe(403);
    });

    it("a staff member of another business cannot read or message (cross-tenant)", async () => {
        const { appt } = await setup();
        const otherBiz = await makeProvider();
        const outsider = await makeUser({ role: 'staff', staffOf: otherBiz._id, staffTier: 'medium', email: `outsider-${seq}@test.com` });
        expect((await send(outsider, appt._id, 'hi')).status).toBe(403);
        expect((await read(outsider, appt._id)).status).toBe(403);
    });

    it('a block between the client and the OWNER also stops staff (business block)', async () => {
        const { owner, customer, appt, staffYes } = await setup();
        // Client blocks the business owner.
        await User.updateOne({ _id: customer._id }, { $addToSet: { blockedUsers: owner._id } });
        const res = await send(staffYes, appt._id, 'hello');
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/unavailable/i);
        expect(await Message.countDocuments({ appointment: appt._id })).toBe(0);
    });

    it('the owner can still message the client (unchanged)', async () => {
        const { owner, appt } = await setup();
        expect((await send(owner, appt._id, 'Welcome!')).status).toBe(201);
    });

    it('a customer reply routes to the OWNER, not a staff member', async () => {
        const { owner, customer, appt } = await setup();
        const res = await send(customer, appt._id, 'Thanks, see you then!');
        expect(res.status).toBe(201);
        expect(String(res.body.data.recipient)).toBe(String(owner._id));
    });

    it('a staff send on a GUEST appointment (no client account) is a clean 400, not a 500', async () => {
        seq += 1;
        const owner = await makeProvider();
        const svc = await makeService(owner._id);
        const staffYes = await makeUser({ role: 'staff', staffOf: owner._id, email: `s-guest-${seq}@test.com` });
        const row = await TeamMember.create({ provider: owner._id, name: 'Guest Host', user: staffYes._id });
        const guestAppt = await makeAppointment(null, svc._id, owner._id, { status: 'confirmed', guestName: 'Walk-in', guestEmail: 'g@test.com', teamMember: row._id });
        const res = await send(staffYes, guestAppt._id, 'hi');
        expect(res.status).toBe(400); // no client account to message — not an unhandled crash
    });
});
