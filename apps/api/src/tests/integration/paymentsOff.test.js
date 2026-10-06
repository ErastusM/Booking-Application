/**
 * Online payments switched off (PAYMENTS_ENABLED unset — the production
 * default until the owner flips it): bookings behave exactly as before, even
 * for a business whose saved setting asks for full prepayment, PayGate is
 * never called, the hold sweeper does nothing, and every /api/payments route —
 * PayGate's callbacks included — answers 404.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendStaffBookingAlert: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const emailService = require('../../utils/emailService');
const Appointment = require('../../models/Appointment');
const User = require('../../models/User');
const Payment = require('../../models/Payment');
const LedgerEntry = require('../../models/LedgerEntry');
const Notification = require('../../models/Notification');
const payments = require('../../services/paymentService');
const { makeProvider, makeUser, makeAdmin, makeService, authHeader } = require('../helpers/factories');
const { futureDate } = require('../helpers/dates');
const { createFakePaygate } = require('../helpers/fakePaygate');

const gw = createFakePaygate();
const tick = () => new Promise((r) => setTimeout(r, 60));

beforeAll(async () => {
    process.env.PAYMENTS_ENABLED = 'false';
    gw.install();
    await testDb.connect();
});
afterAll(async () => {
    process.env.PAYMENTS_ENABLED = 'true';
    gw.uninstall();
    await testDb.closeDatabase();
});
afterEach(async () => { gw.reset(); jest.clearAllMocks(); await testDb.clearDatabase(); });

describe('payments switched off', () => {
    it('a client booking at a business set to "full" is confirmed at once, as today — no hold, no PayGate, the usual notices', async () => {
        const provider = await makeProvider({ businessProfile: { currency: 'NAD' }, paymentSettings: { mode: 'full' } });
        const service = await makeService(provider._id, { price: 200, duration: 30 });
        const client = await makeUser({ name: 'Ana Shilongo' });

        const guest = await request(app).post('/api/appointments').send({
            service: service._id, appointmentDate: futureDate(0), startTime: '10:00', endTime: '10:30', guestName: 'Ben Iipinge', guestEmail: 'ben@example.com',
        });
        const mine = await request(app).post('/api/appointments').set(authHeader(client)).send({
            service: service._id, appointmentDate: futureDate(0), startTime: '11:00', endTime: '11:30',
        });
        for (const res of [guest, mine]) {
            expect(res.status).toBe(201);
            expect(res.body.message).toBe('Appointment confirmed');
            expect(res.body.data.status).toBe('confirmed');
            expect(res.body.payment).toBeUndefined();
            expect(res.body.code).toBeUndefined();
            // No payment fields on the booking at all.
            for (const k of ['paymentKind', 'amountDueOnlineCents', 'amountPaidOnlineCents', 'currency', 'paymentHoldExpiresAt', 'onlinePayment']) {
                expect(res.body.data[k]).toBeUndefined();
            }
        }
        expect(gw.calls).toHaveLength(0);
        expect(await Payment.countDocuments()).toBe(0);
        await tick();
        expect(emailService.sendAppointmentConfirmed).toHaveBeenCalledTimes(2);
        expect(await Notification.countDocuments({ user: provider._id })).toBe(2);

        // Cancelling, the calendar and the sweeper are untouched.
        const list = await request(app).get('/api/appointments?all=true').set(authHeader(provider));
        expect(list.body.data).toHaveLength(2);
        const c = await request(app).put(`/api/appointments/${mine.body.data._id}/status`).set(authHeader(provider)).send({ status: 'cancelled' });
        expect(c.status).toBe(200);
        expect((await Appointment.findById(mine.body.data._id)).status).toBe('cancelled');
        expect(await LedgerEntry.countDocuments()).toBe(0);
        expect(gw.calls).toHaveLength(0);
    });

    it('every payments route is a 404 — owner, admin, public and PayGate callbacks — and nothing is written', async () => {
        const provider = await makeProvider();
        const admin = await makeAdmin();
        const ref = 'BP0123456789ABCDEF0123456789ABCD';
        const asOwner = [
            request(app).get('/api/payments/settings'),
            request(app).put('/api/payments/settings').send({ mode: 'full' }),
            request(app).get('/api/payments/payout-account'),
            request(app).put('/api/payments/payout-account').send({ accountHolder: 'A B', bankName: 'Bank', branchCode: '123456', accountNumber: '123456789' }),
            request(app).get('/api/payments/me/balance'),
            request(app).get('/api/payments/me/ledger'),
            request(app).get('/api/payments/me/statement.csv'),
            request(app).get('/api/payments/me/payments'),
            request(app).post('/api/payments/507f1f77bcf86cd799439011/refund').send({}),
        ];
        for (const r of asOwner) expect((await r.set(authHeader(provider))).status).toBe(404);
        const asAdmin = [
            request(app).get('/api/payments/admin/balances'),
            request(app).post('/api/payments/admin/payouts').send({ providerId: String(provider._id), amountCents: 100 }),
            request(app).get('/api/payments/admin/payments'),
        ];
        for (const r of asAdmin) expect((await r.set(authHeader(admin))).status).toBe(404);
        const publicOnes = [
            request(app).get(`/api/payments/${ref}/status`),
            request(app).post(`/api/payments/${ref}/retry`),
            request(app).get(`/api/payments/policy/${provider._id}`),
            request(app).post('/api/payments/paygate/notify').type('form').send('PAY_REQUEST_ID=x&CHECKSUM=y'),
            request(app).post('/api/payments/paygate/return').type('form').send('PAY_REQUEST_ID=x&CHECKSUM=y'),
        ];
        for (const r of publicOnes) expect((await r).status).toBe(404);
        expect((await User.findById(provider._id)).paymentSettings).toBeUndefined();
        expect(await Payment.countDocuments()).toBe(0);
    });

    it('a booking needs no new fields: the plan is always "pay at the appointment"', async () => {
        expect(await payments.planForBooking(String(new (require('mongoose').Types.ObjectId)()), 200)).toBeNull();
        expect(payments.planFor({ settings: { mode: 'full' }, currency: 'NAD', priceCents: 20000 })).toBeNull();
    });
});
