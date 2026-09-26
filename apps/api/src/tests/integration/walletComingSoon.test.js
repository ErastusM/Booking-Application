/**
 * Wallet "coming soon" (owner decision, September 2026): with WALLET_ENABLED off,
 * every client pays cash at the appointment.
 *   - Top-ups, top-up approvals, adjustments, wallet settings, gift card sale and
 *     redemption, and paying a booking from the wallet answer 403
 *     WALLET_COMING_SOON.
 *   - Bookings are always cash, even for a business set to "wallet required".
 *   - The expiry sweep and the reminder job do nothing.
 *   - An existing balance is untouched and still readable by the client and the
 *     business.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendStaffBookingAlert: jest.fn().mockResolvedValue(true),
    sendWalletExpiryReminder: jest.fn().mockResolvedValue(true),
    sendWalletTopUpReceipt: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const emailService = require('../../utils/emailService');
const { runReminderSweep, runExpirySweep } = require('../../utils/walletExpiryService');
const { makeProvider, makeService, makeUser, authHeader } = require('../helpers/factories');

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
    process.env.WALLET_ENABLED = 'false';
    await testDb.connect();
});
afterAll(async () => {
    process.env.WALLET_ENABLED = 'true';
    await testDb.closeDatabase();
});
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

const soon = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const walletBusiness = () => makeProvider({
    walletSettings: { enabled: true, bookingPaymentMode: 'wallet_required', refundsAllowed: false, expiryMonths: 6, paymentInstructions: 'Bank: 123' },
    businessProfile: { businessName: 'Glow Studio', currency: 'NAD' },
});

const expectComingSoon = (res) => {
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WALLET_COMING_SOON');
    expect(res.body.message).toMatch(/coming soon/i);
    expect(res.body.message).toMatch(/pay the business directly at your appointment/i);
};

describe('wallet actions answer 403 WALLET_COMING_SOON', () => {
    it('client top-up (with or without proof of payment)', async () => {
        const provider = await walletBusiness();
        const client = await makeUser();
        expectComingSoon(await request(app).post('/api/wallet/topup').set(authHeader(client))
            .send({ providerId: provider._id.toString(), amount: 100, rulesAcknowledged: true, proofUrl: 'https://res.cloudinary.com/x/proof.pdf' }));
        expect(await WalletTransaction.countDocuments()).toBe(0);
        expect(await Wallet.countDocuments()).toBe(0);
    });

    it('business settings, approvals and adjustments; gift card sale and redemption', async () => {
        const provider = await walletBusiness();
        const client = await makeUser();
        const id = '5f0000000000000000000001';
        expectComingSoon(await request(app).put('/api/wallet/settings').set(authHeader(provider)).send({ enabled: true }));
        expectComingSoon(await request(app).post(`/api/wallet/topups/${id}/approve`).set(authHeader(provider)));
        expectComingSoon(await request(app).post('/api/wallet/provider/adjustments').set(authHeader(provider))
            .send({ customerId: client._id.toString(), amount: 10, direction: 'credit', reason: 'x' }));
        expectComingSoon(await request(app).post(`/api/wallet/adjustments/${id}/approve`).set(authHeader(client)));
        expectComingSoon(await request(app).post('/api/giftcards').set(authHeader(provider)).send({ amount: 100, recipientName: 'A' }));
        expectComingSoon(await request(app).post('/api/giftcards/redeem').set(authHeader(client)).send({ code: 'GIFT-AAAA-BBBB' }));
    });

    it('paying a booking from the wallet', async () => {
        const provider = await walletBusiness();
        const svc = await makeService(provider._id, { price: 100, duration: 30 });
        const client = await makeUser();
        expectComingSoon(await request(app).post('/api/appointments').set(authHeader(client)).send({
            service: svc._id.toString(), appointmentDate: soon(), startTime: '10:00', endTime: '10:30', paymentMethod: 'wallet',
        }));
    });
});

describe('bookings are cash', () => {
    it('a "wallet required" business still takes a cash booking, and reserves nothing', async () => {
        const provider = await walletBusiness();
        const svc = await makeService(provider._id, { price: 100, duration: 30 });
        const client = await makeUser();
        await Wallet.create({ customer: client._id, provider: provider._id, totalBalance: 500 });
        const res = await request(app).post('/api/appointments').set(authHeader(client)).send({
            service: svc._id.toString(), appointmentDate: soon(), startTime: '10:00', endTime: '10:30',
        });
        expect(res.status).toBe(201);
        expect(res.body.data.paymentMethod).toBe('cash');
        const w = await Wallet.findOne({ customer: client._id });
        expect(w.reservedBalance).toBe(0);
        expect(w.totalBalance).toBe(500);
    });

    it('a guest can book a "wallet required" business (cash)', async () => {
        const provider = await walletBusiness();
        const svc = await makeService(provider._id, { price: 100, duration: 30 });
        const res = await request(app).post('/api/appointments').send({
            service: svc._id.toString(), appointmentDate: soon(), startTime: '10:00', endTime: '10:30',
            guestName: 'Jane Doe', guestEmail: 'jane@example.com',
        });
        expect(res.status).toBe(201);
        expect(res.body.data.paymentMethod).toBe('cash');
    });
});

describe('existing balances: frozen, never expired, still readable', () => {
    it('expiry sweep and reminder job do nothing', async () => {
        const provider = await walletBusiness();
        const client = await makeUser();
        const w = await Wallet.create({ customer: client._id, provider: provider._id, totalBalance: 250 });
        await Wallet.collection.updateOne({ _id: w._id }, { $set: { updatedAt: new Date(Date.now() - 400 * DAY) } });
        expect(await runReminderSweep()).toBe(0);
        expect(await runExpirySweep()).toEqual({ expired: 0, noticed: 0 });
        expect(await runExpirySweep(Date.now() + 60 * DAY)).toEqual({ expired: 0, noticed: 0 });
        expect((await Wallet.findById(w._id)).totalBalance).toBe(250);
        expect(emailService.sendWalletExpiryReminder).not.toHaveBeenCalled();
        expect(await WalletTransaction.countDocuments()).toBe(0);
    });

    it('the client still sees the balance (no expiry date, wallet reported off)', async () => {
        const provider = await walletBusiness();
        const client = await makeUser();
        await Wallet.create({ customer: client._id, provider: provider._id, totalBalance: 250 });
        const mine = await request(app).get('/api/wallet/mine').set(authHeader(client));
        expect(mine.status).toBe(200);
        expect(mine.body.data).toHaveLength(1);
        expect(mine.body.data[0].totalBalance).toBe(250);
        expect(mine.body.data[0].rules.expiresAt).toBeNull();

        const one = await request(app).get(`/api/wallet/mine/${provider._id}`).set(authHeader(client));
        expect(one.status).toBe(200);
        expect(one.body.data.wallet.totalBalance).toBe(250);
        expect(one.body.data.comingSoon).toBe(true);
        expect(one.body.data.settings.enabled).toBe(false);
        expect(one.body.data.settings.paymentInstructions).toBe('');
    });

    it('the business still sees its clients’ balances', async () => {
        const provider = await walletBusiness();
        const client = await makeUser();
        await Wallet.create({ customer: client._id, provider: provider._id, totalBalance: 250 });
        const res = await request(app).get('/api/wallet/provider/wallets').set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.some((w) => w.totalBalance === 250)).toBe(true);
    });
});
