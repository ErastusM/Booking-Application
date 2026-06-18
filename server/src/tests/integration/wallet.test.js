/**
 * Bookplus Wallet — prepaid balance + reservation flows.
 * Covers: top-up request/approve/reject, reservation on booking, deduction on
 * completion, release on cancellation, insufficient-funds blocking, and the
 * provider→client manual adjustment approval flow.
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
const walletService = require('../../utils/walletService');
const { makeProvider, makeService, makeUser, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const futureDate = (daysAhead = 14) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Spin up a wallet-required provider + funded client, returning everything a
// test needs. `fund` is approved into the client's wallet via the real flow.
const setup = async ({ mode = 'wallet_required', price = 100, fund = 0 } = {}) => {
    const provider = await makeProvider({ walletSettings: { enabled: true, bookingPaymentMode: mode, refundsAllowed: true } });
    const svc = await makeService(provider._id, { price, duration: 30 });
    const client = await makeUser();

    if (fund > 0) {
        const topup = await request(app).post('/api/wallet/topup')
            .set(authHeader(client))
            .send({ providerId: provider._id.toString(), amount: fund });
        await request(app).post(`/api/wallet/topups/${topup.body.data._id}/approve`)
            .set(authHeader(provider));
    }
    return { provider, svc, client };
};

const getWallet = async (client, providerId) => {
    const res = await request(app).get(`/api/wallet/mine/${providerId}`).set(authHeader(client));
    return res.body.data.wallet;
};

const book = (client, svc, startTime = '10:00', endTime = '10:30') =>
    request(app).post('/api/appointments').set(authHeader(client)).send({
        service: svc._id.toString(), appointmentDate: futureDate(), startTime, endTime,
    });

// ─────────────────────────────────────────────────────────────────────────────
describe('Wallet top-up flow', () => {
    it('approving a top-up credits the total balance', async () => {
        const { provider, client } = await setup();
        const topup = await request(app).post('/api/wallet/topup')
            .set(authHeader(client))
            .send({ providerId: provider._id.toString(), amount: 500, reference: 'BP-123' });
        expect(topup.status).toBe(201);
        expect(topup.body.data.status).toBe('pending');

        const approve = await request(app).post(`/api/wallet/topups/${topup.body.data._id}/approve`).set(authHeader(provider));
        expect(approve.status).toBe(200);

        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(500);
        expect(wallet.availableBalance).toBe(500);
    });

    it('rejecting a top-up leaves the balance unchanged', async () => {
        const { provider, client } = await setup();
        const topup = await request(app).post('/api/wallet/topup')
            .set(authHeader(client)).send({ providerId: provider._id.toString(), amount: 300 });
        await request(app).post(`/api/wallet/topups/${topup.body.data._id}/reject`).set(authHeader(provider));

        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(0);
    });

    it('a top-up cannot be approved twice', async () => {
        const { provider, client } = await setup();
        const topup = await request(app).post('/api/wallet/topup')
            .set(authHeader(client)).send({ providerId: provider._id.toString(), amount: 200 });
        await request(app).post(`/api/wallet/topups/${topup.body.data._id}/approve`).set(authHeader(provider));
        const again = await request(app).post(`/api/wallet/topups/${topup.body.data._id}/approve`).set(authHeader(provider));
        expect(again.status).toBe(409);

        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(200); // credited once only
    });
});

describe('Reservation on booking (wallet_required)', () => {
    it('reserves the service price, leaving total unchanged', async () => {
        const { provider, svc, client } = await setup({ price: 100, fund: 500 });
        const res = await book(client, svc);
        expect(res.status).toBe(201);

        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(500);
        expect(wallet.reservedBalance).toBe(100);
        expect(wallet.availableBalance).toBe(400);
    });

    it('blocks booking and creates nothing when funds are insufficient', async () => {
        const { provider, svc, client } = await setup({ price: 100, fund: 50 });
        const res = await book(client, svc);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INSUFFICIENT_WALLET');

        const wallet = await getWallet(client, provider._id);
        expect(wallet.reservedBalance).toBe(0); // nothing held

        const list = await request(app).get('/api/appointments').set(authHeader(client));
        expect(list.body.data.length).toBe(0); // booking rolled back
    });

    it('does not reserve when the provider is wallet_optional', async () => {
        const { provider, svc, client } = await setup({ mode: 'wallet_optional', price: 100, fund: 0 });
        const res = await book(client, svc);
        expect(res.status).toBe(201); // booking allowed with no funds

        const wallet = await getWallet(client, provider._id);
        expect(wallet.reservedBalance).toBe(0);
    });
});

describe('Completion and cancellation', () => {
    it('completion turns the reservation into a permanent deduction', async () => {
        const { provider, svc, client } = await setup({ price: 100, fund: 500 });
        const booking = await book(client, svc);
        await request(app).put(`/api/appointments/${booking.body.data._id}/status`)
            .set(authHeader(provider)).send({ status: 'completed' });

        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(400);
        expect(wallet.reservedBalance).toBe(0);
        expect(wallet.availableBalance).toBe(400);
    });

    it('cancellation releases the reservation back to available', async () => {
        const { provider, svc, client } = await setup({ price: 100, fund: 500 });
        const booking = await book(client, svc);
        await request(app).delete(`/api/appointments/${booking.body.data._id}`)
            .set(authHeader(client)).send({ cancellationReason: 'changed mind' });

        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(500);
        expect(wallet.reservedBalance).toBe(0);
    });

    it('completion is idempotent — deducts only once', async () => {
        const { provider, svc, client } = await setup({ price: 100, fund: 500 });
        const booking = await book(client, svc);
        const id = booking.body.data._id;
        await request(app).put(`/api/appointments/${id}/status`).set(authHeader(provider)).send({ status: 'completed' });
        await request(app).put(`/api/appointments/${id}/status`).set(authHeader(provider)).send({ status: 'completed' });

        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(400); // not 300
    });
});

describe('Manual adjustments (provider proposes, client approves)', () => {
    it('a credit adjustment increases the balance once approved', async () => {
        const { provider, client } = await setup({ fund: 100 });
        const adj = await request(app).post('/api/wallet/provider/adjustments')
            .set(authHeader(provider))
            .send({ customerId: client._id.toString(), amount: 50, direction: 'credit', reason: 'Promo' });
        expect(adj.status).toBe(201);

        const pending = await request(app).get('/api/wallet/adjustments/pending').set(authHeader(client));
        expect(pending.body.data.length).toBe(1);

        await request(app).post(`/api/wallet/adjustments/${adj.body.data._id}/approve`).set(authHeader(client));
        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(150);
    });

    it('a rejected adjustment changes nothing', async () => {
        const { provider, client } = await setup({ fund: 100 });
        const adj = await request(app).post('/api/wallet/provider/adjustments')
            .set(authHeader(provider))
            .send({ customerId: client._id.toString(), amount: 40, direction: 'debit', reason: 'Penalty' });
        await request(app).post(`/api/wallet/adjustments/${adj.body.data._id}/reject`).set(authHeader(client));

        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(100);
    });

    it('a debit larger than available balance is refused on approval', async () => {
        const { provider, client } = await setup({ fund: 100 });
        const adj = await request(app).post('/api/wallet/provider/adjustments')
            .set(authHeader(provider))
            .send({ customerId: client._id.toString(), amount: 1000, direction: 'debit', reason: 'Big penalty' });
        const approve = await request(app).post(`/api/wallet/adjustments/${adj.body.data._id}/approve`).set(authHeader(client));
        expect(approve.status).toBe(400);

        const wallet = await getWallet(client, provider._id);
        expect(wallet.totalBalance).toBe(100); // untouched
    });
});

describe('Reservation adjustment (service change, §8)', () => {
    it('raises and lowers the held amount, and completion deducts the adjusted value', async () => {
        const { provider, svc, client } = await setup({ price: 100, fund: 500 });
        const booking = await book(client, svc); // reserves 100
        const apptId = booking.body.data._id;

        let r = await walletService.adjustReservation({ appointmentId: apptId, newAmount: 150 });
        expect(r.ok).toBe(true);
        expect((await getWallet(client, provider._id)).reservedBalance).toBe(150);

        await walletService.adjustReservation({ appointmentId: apptId, newAmount: 60 });
        expect((await getWallet(client, provider._id)).reservedBalance).toBe(60);

        await request(app).put(`/api/appointments/${apptId}/status`).set(authHeader(provider)).send({ status: 'completed' });
        const w = await getWallet(client, provider._id);
        expect(w.totalBalance).toBe(440); // 500 − adjusted 60
        expect(w.reservedBalance).toBe(0);
    });

    it('refuses an increase the wallet cannot cover', async () => {
        const { provider, svc, client } = await setup({ price: 100, fund: 120 });
        const booking = await book(client, svc); // reserves 100, leaves 20 available
        const r = await walletService.adjustReservation({ appointmentId: booking.body.data._id, newAmount: 1000 });
        expect(r.ok).toBe(false);
        expect((await getWallet(client, provider._id)).reservedBalance).toBe(100); // unchanged
    });
});

describe('Provider summary', () => {
    it('reports funds held, reserved and pending counts', async () => {
        const { provider, svc, client } = await setup({ price: 100, fund: 500 });
        await book(client, svc); // reserves 100

        const summary = await request(app).get('/api/wallet/provider/summary').set(authHeader(provider));
        expect(summary.status).toBe(200);
        expect(summary.body.data.fundsHeld).toBe(500);
        expect(summary.body.data.totalReserved).toBe(100);
        expect(summary.body.data.totalAvailable).toBe(400);
    });
});
