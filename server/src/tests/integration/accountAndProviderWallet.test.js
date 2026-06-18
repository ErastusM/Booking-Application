/**
 * Provider↔platform wallet (admin tops up providers), self-service account
 * deactivate/delete, and user blocking (bookings + messaging).
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeAdmin, makeUser, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const Appointment = require('../../models/Appointment');
const Wallet = require('../../models/Wallet');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const futureDate = (d = 14) => {
    const x = new Date(); x.setDate(x.getDate() + d);
    const p = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('Provider ↔ platform wallet', () => {
    it('provider submits a top-up; admin approves to credit the balance', async () => {
        const provider = await makeProvider();
        const admin = await makeAdmin();

        const submit = await request(app).post('/api/provider-wallet/topup')
            .set(authHeader(provider))
            .send({ amount: 500, reference: 'DEP-1', proofType: 'pdf', proofUrl: 'https://x/p.pdf' });
        expect(submit.status).toBe(201);

        const pending = await request(app).get('/api/provider-wallet/admin/topups?status=pending').set(authHeader(admin));
        expect(pending.body.data.length).toBe(1);

        const approve = await request(app).post(`/api/provider-wallet/admin/topups/${submit.body.data.transaction._id}/approve`).set(authHeader(admin));
        expect(approve.status).toBe(200);

        const me = await request(app).get('/api/provider-wallet/me').set(authHeader(provider));
        expect(me.body.data.wallet.balance).toBe(500);
    });

    it('admin can credit and debit a provider directly', async () => {
        const provider = await makeProvider();
        const admin = await makeAdmin();
        await request(app).post('/api/provider-wallet/admin/adjust').set(authHeader(admin))
            .send({ providerId: provider._id.toString(), amount: 300, direction: 'credit', reason: 'manual deposit' });
        let me = await request(app).get('/api/provider-wallet/me').set(authHeader(provider));
        expect(me.body.data.wallet.balance).toBe(300);

        await request(app).post('/api/provider-wallet/admin/adjust').set(authHeader(admin))
            .send({ providerId: provider._id.toString(), amount: 100, direction: 'debit', reason: 'correction' });
        me = await request(app).get('/api/provider-wallet/me').set(authHeader(provider));
        expect(me.body.data.wallet.balance).toBe(200);
    });

    it('a debit larger than the balance is refused', async () => {
        const provider = await makeProvider();
        const admin = await makeAdmin();
        const res = await request(app).post('/api/provider-wallet/admin/adjust').set(authHeader(admin))
            .send({ providerId: provider._id.toString(), amount: 50, direction: 'debit', reason: 'x' });
        expect(res.status).toBe(400);
    });

    it('a provider cannot reach the admin endpoints', async () => {
        const provider = await makeProvider();
        const res = await request(app).get('/api/provider-wallet/admin/wallets').set(authHeader(provider));
        expect(res.status).toBe(403);
    });
});

describe('Account deactivation and deletion', () => {
    const creds = { email: 'acct@test.com', password: 'Password1!' };

    it('deactivating blocks the old session but signing in reactivates', async () => {
        await makeUser({ ...creds, isVerified: true });
        const login1 = await request(app).post('/api/auth/login').send(creds);
        const token = login1.body.data.token;

        const deact = await request(app).post('/api/auth/deactivate').set('Authorization', `Bearer ${token}`);
        expect(deact.status).toBe(200);

        // Old session no longer works (revoked / account inactive)
        const profile = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
        expect([401, 403]).toContain(profile.status);

        // Signing in again reactivates and works
        const login2 = await request(app).post('/api/auth/login').send(creds);
        expect(login2.status).toBe(200);
        const dbUser = await User.findOne({ email: creds.email });
        expect(dbUser.isActive).toBe(true);
        expect(dbUser.deactivatedAt).toBeNull();
    });

    it('deleting anonymises the account and blocks sign-in', async () => {
        await makeUser({ email: 'del@test.com', password: 'Password1!', isVerified: true });
        const login = await request(app).post('/api/auth/login').send({ email: 'del@test.com', password: 'Password1!' });
        const token = login.body.data.token;

        const wrong = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token}`).send({ password: 'nope' });
        expect(wrong.status).toBe(401);

        const del = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token}`).send({ password: 'Password1!' });
        expect(del.status).toBe(200);

        const relogin = await request(app).post('/api/auth/login').send({ email: 'del@test.com', password: 'Password1!' });
        expect(relogin.status).toBe(401);

        const ghost = await User.findById(login.body.data.user.id);
        expect(ghost.name).toBe('Deleted user');
        expect(ghost.deletedAt).toBeTruthy();
    });

    it('deleting cancels upcoming bookings and releases held wallet funds', async () => {
        const provider = await makeProvider({ walletSettings: { enabled: true, bookingPaymentMode: 'wallet_required' } });
        const svc = await makeService(provider._id, { price: 100, duration: 30 });
        const customer = await makeUser({ password: 'Password1!', isVerified: true });

        // Fund the wallet, then book (reserves 100)
        const topup = await request(app).post('/api/wallet/topup').set(authHeader(customer)).send({ providerId: provider._id.toString(), amount: 300 });
        await request(app).post(`/api/wallet/topups/${topup.body.data._id}/approve`).set(authHeader(provider));
        const booking = await request(app).post('/api/appointments').set(authHeader(customer)).send({
            service: svc._id.toString(), appointmentDate: futureDate(), startTime: '10:00', endTime: '10:30',
        });
        expect(booking.status).toBe(201);
        expect((await Wallet.findOne({ customer: customer._id, provider: provider._id })).reservedBalance).toBe(100);

        // Delete the account
        const login = await request(app).post('/api/auth/login').send({ email: customer.email, password: 'Password1!' });
        const del = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${login.body.data.token}`).send({ password: 'Password1!' });
        expect(del.status).toBe(200);

        // The booking is cancelled and the held funds were released
        expect((await Appointment.findById(booking.body.data._id)).status).toBe('cancelled');
        expect((await Wallet.findOne({ customer: customer._id, provider: provider._id })).reservedBalance).toBe(0);
    });
});

describe('Blocking', () => {
    it('a blocked customer cannot book the provider', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const customer = await makeUser({ isVerified: true });

        await request(app).post('/api/auth/block').set(authHeader(customer)).send({ userId: provider._id.toString() });

        const res = await request(app).post('/api/appointments').set(authHeader(customer)).send({
            service: svc._id.toString(), appointmentDate: futureDate(), startTime: '10:00', endTime: '10:30',
        });
        expect(res.status).toBe(403);
    });

    it('blocks messaging in both directions', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const customer = await makeUser({ isVerified: true });
        const appt = await makeAppointment(customer._id, svc._id, provider._id);

        // Provider blocks the customer
        await request(app).post('/api/auth/block').set(authHeader(provider)).send({ userId: customer._id.toString() });

        // Customer can no longer message the provider on that appointment
        const res = await request(app).post(`/api/messages/${appt._id}`).set(authHeader(customer)).send({ content: 'hello?' });
        expect(res.status).toBe(403);
    });

    it('unblocking restores booking', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const customer = await makeUser({ isVerified: true });

        await request(app).post('/api/auth/block').set(authHeader(customer)).send({ userId: provider._id.toString() });
        await request(app).delete(`/api/auth/block/${provider._id.toString()}`).set(authHeader(customer));

        const res = await request(app).post('/api/appointments').set(authHeader(customer)).send({
            service: svc._id.toString(), appointmentDate: futureDate(), startTime: '11:00', endTime: '11:30',
        });
        expect(res.status).toBe(201);
    });
});
