/**
 * clients:contact — a staff member messaging a client. Decision: the staff
 * member messages under THEIR OWN identity (sender = the staff user), talking to
 * the client, within the appointment's single thread. This suite pins:
 *   - a staff member of the business WITH clients:contact can read + send, and
 *     the message's sender is the staff member themselves
 *   - a staff member WITHOUT the capability is refused (403)
 *   - cross-tenant: a staff member of another business cannot read/send (403)
 *   - a block between the client and the OWNER also stops staff (blocking the
 *     business blocks its staff)
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
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
    const appt = await makeAppointment(customer._id, svc._id, owner._id, { status: 'confirmed' });
    // Medium tier grants clients:contact; Low does not.
    const staffYes = await makeUser({ role: 'staff', staffOf: owner._id, staffTier: 'medium', email: `s-yes-${seq}@test.com`, name: 'Moses' });
    const staffNo = await makeUser({ role: 'staff', staffOf: owner._id, staffTier: 'low', email: `s-no-${seq}@test.com`, name: 'Junior' });
    return { owner, svc, customer, appt, staffYes, staffNo };
};
const send = (as, apptId, content) => request(app).post(`/api/messages/${apptId}`).set(authHeader(as)).send({ content });
const read = (as, apptId) => request(app).get(`/api/messages/${apptId}`).set(authHeader(as));

describe('clients:contact — staff messaging', () => {
    it('a staff member with the capability messages the client AS THEMSELVES', async () => {
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

    it('a staff member WITHOUT clients:contact is refused', async () => {
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
        const staffYes = await makeUser({ role: 'staff', staffOf: owner._id, staffTier: 'medium', email: `s-guest-${seq}@test.com` });
        const guestAppt = await makeAppointment(null, svc._id, owner._id, { status: 'confirmed', guestName: 'Walk-in', guestEmail: 'g@test.com' });
        const res = await send(staffYes, guestAppt._id, 'hi');
        expect(res.status).toBe(400); // no client account to message — not an unhandled crash
    });
});
