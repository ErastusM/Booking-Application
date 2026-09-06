/**
 * Security — MEDIUM batch (audit follow-ups):
 *   A. CRM note write requires an actual provider↔client relationship
 *      (a booking) — no writing PII records about strangers.
 *   B. Provider wallet-adjustment proposals require the target be this
 *      provider's client (wallet or booking) — no spamming arbitrary users.
 *   C. Form submission's template must belong to the appointment's provider
 *      — no cross-provider template/response mismatch.
 *   D. Group-booking view redacts co-participants' contact details (email,
 *      phone, guest contact, manage token) — a member sees only first names.
 *   E. Login spends a bcrypt comparison even when the email doesn't exist, so
 *      the hit/miss timing can't be used to enumerate accounts (behaviourally:
 *      login still works and unknown emails still get a generic 401).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const FormTemplate = require('../../models/FormTemplate');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('A — CRM note requires a real client relationship', () => {
    it('rejects a note for a user who never booked with the provider', async () => {
        const provider = await makeProvider();
        const stranger = await makeUser();
        const res = await request(app)
            .put(`/api/crm/clients/${stranger._id}/notes`)
            .set(authHeader(provider))
            .send({ notes: 'should not be stored' });
        expect(res.status).toBe(404);
    });

    it('allows a note for an actual client', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const client = await makeUser();
        await makeAppointment(client._id, svc._id, provider._id, {});
        const res = await request(app)
            .put(`/api/crm/clients/${client._id}/notes`)
            .set(authHeader(provider))
            .send({ notes: 'VIP, allergic to X' });
        expect(res.status).toBe(200);
        expect(res.body.data.notes).toBe('VIP, allergic to X');
    });
});

describe('B — wallet adjustment requires the target be the provider\'s client', () => {
    it('rejects an adjustment proposal against a stranger', async () => {
        const provider = await makeProvider();
        const stranger = await makeUser();
        const res = await request(app)
            .post('/api/wallet/provider/adjustments')
            .set(authHeader(provider))
            .send({ customerId: stranger._id, amount: 50, direction: 'credit' });
        expect(res.status).toBe(404);
    });

    it('allows an adjustment for a client who has booked', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const client = await makeUser();
        await makeAppointment(client._id, svc._id, provider._id, {});
        const res = await request(app)
            .post('/api/wallet/provider/adjustments')
            .set(authHeader(provider))
            .send({ customerId: client._id, amount: 50, direction: 'credit' });
        expect(res.status).toBe(201);
    });
});

describe('C — form submission is bound to the appointment provider\'s template', () => {
    it('rejects submitting another provider\'s template against this appointment', async () => {
        const provA = await makeProvider();
        const provB = await makeProvider();
        const svcB = await makeService(provB._id);
        const customer = await makeUser();
        const apptB = await makeAppointment(customer._id, svcB._id, provB._id, {});
        // Template owned by A, appointment served by B.
        const tplA = await FormTemplate.create({ provider: provA._id, title: 'Intake A', fields: [] });

        const res = await request(app)
            .post('/api/forms/submissions')
            .set(authHeader(customer))
            .send({ template: tplA._id, appointment: apptB._id, answers: [] });
        expect(res.status).toBe(403);
    });

    it('accepts the appointment provider\'s own template', async () => {
        const provB = await makeProvider();
        const svcB = await makeService(provB._id);
        const customer = await makeUser();
        const apptB = await makeAppointment(customer._id, svcB._id, provB._id, {});
        const tplB = await FormTemplate.create({ provider: provB._id, title: 'Intake B', fields: [] });

        const res = await request(app)
            .post('/api/forms/submissions')
            .set(authHeader(customer))
            .send({ template: tplB._id, appointment: apptB._id, answers: [] });
        expect(res.status).toBe(201);
    });
});

describe('D — group booking hides co-participants\' contact details', () => {
    it('shows the caller their own contact but only first names for others', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const alice = await makeUser({ name: 'Alice Anderson' });
        const bob = await makeUser({ name: 'Bob Brown' });
        const groupId = 'grp-test-1';
        const aliceAppt = await makeAppointment(alice._id, svc._id, provider._id, { groupId, groupSize: 2 });
        await makeAppointment(bob._id, svc._id, provider._id, { groupId, groupSize: 2 });

        const res = await request(app).get(`/api/appointments/group/${groupId}`).set(authHeader(alice));
        expect(res.status).toBe(200);

        const rows = res.body.data;
        const mine = rows.find(r => String(r._id) === String(aliceAppt._id));
        const other = rows.find(r => String(r._id) !== String(aliceAppt._id));

        // Alice sees her own contact in full.
        expect(mine.customer.email).toBeTruthy();
        // Bob's row: first name only, no contact fields leaked.
        expect(other.customer.name).toBe('Bob');
        expect(other.customer.email).toBeUndefined();
        expect(other.customer.phone).toBeUndefined();
        expect(other.guestEmail).toBeUndefined();
        expect(other.manageToken).toBeUndefined();
    });

    it('lets the provider see every participant in full', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const alice = await makeUser({ name: 'Alice Anderson' });
        const bob = await makeUser({ name: 'Bob Brown' });
        const groupId = 'grp-test-2';
        await makeAppointment(alice._id, svc._id, provider._id, { groupId, groupSize: 2 });
        await makeAppointment(bob._id, svc._id, provider._id, { groupId, groupSize: 2 });

        const res = await request(app).get(`/api/appointments/group/${groupId}`).set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.every(r => r.customer && r.customer.email)).toBe(true);
    });
});

describe('E — login enumeration timing guard does not break auth', () => {
    it('still signs in a valid user and 401s an unknown email the same way', async () => {
        const password = 'Password1!';
        const user = await makeUser({ email: 'real@test.com', password });

        const ok = await request(app).post('/api/auth/login').send({ email: 'real@test.com', password });
        expect(ok.status).toBe(200);

        const wrongPw = await request(app).post('/api/auth/login').send({ email: 'real@test.com', password: 'nope' });
        expect(wrongPw.status).toBe(401);
        expect(wrongPw.body.message).toBe('Invalid credentials');

        const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@test.com', password: 'nope' });
        expect(unknown.status).toBe(401);
        expect(unknown.body.message).toBe('Invalid credentials'); // identical to wrong-password
    });
});
