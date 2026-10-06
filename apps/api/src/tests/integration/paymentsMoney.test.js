/**
 * Online payments — who may see and change a business's money (the owner
 * rule), the payment setting, the payout bank account, the owner's balance /
 * statement / CSV, and admin balances + payouts.
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
const User = require('../../models/User');
const Payment = require('../../models/Payment');
const LedgerEntry = require('../../models/LedgerEntry');
const Payout = require('../../models/Payout');
const payments = require('../../services/paymentService');
const { makeProvider, makeUser, makeAdmin, makeService, authHeader } = require('../helpers/factories');
const { futureDate } = require('../helpers/dates');
const { createFakePaygate } = require('../helpers/fakePaygate');

const gw = createFakePaygate();

beforeAll(async () => { gw.install(); await testDb.connect(); });
afterAll(async () => { gw.uninstall(); await testDb.closeDatabase(); });
afterEach(async () => { gw.reset(); await testDb.clearDatabase(); });

const ACCOUNT = { accountHolder: 'Vibe Cuts CC', bankName: 'Bank Windhoek', branchCode: '483872', accountNumber: '8004 123 4821' };

const world = async () => {
    const owner = await makeProvider({ businessProfile: { businessName: 'Vibe Cuts', currency: 'NAD' }, paymentSettings: { mode: 'full' } });
    const otherOwner = await makeProvider({ businessProfile: { businessName: 'Other', currency: 'NAD' } });
    const staff = await makeUser({ role: 'staff', staffOf: owner._id, name: 'Sam Staff' });
    const client = await makeUser({ name: 'Ana Shilongo' });
    const admin = await makeAdmin();
    const service = await makeService(owner._id, { name: 'Taper Fade', price: 200, duration: 30 });
    return { owner, otherOwner, staff, client, admin, service };
};

// A paid online booking for `client` (or a guest named `name`).
const paidBooking = async (service, { start = '10:00', end = '10:30', name = '=Ana Hyperlink' } = {}) => {
    const res = await request(app).post('/api/appointments')
        .send({ service: service._id, appointmentDate: futureDate(0), startTime: start, endTime: end, guestName: name, guestEmail: 'ana@example.com' });
    expect(res.status).toBe(201);
    gw.setStatus(res.body.payment.reference, 1);
    await request(app).post('/api/payments/paygate/notify').type('form').send(gw.notifyBody(res.body.payment.reference));
    return Payment.findOne({ reference: res.body.payment.reference });
};

describe('payment setting', () => {
    it('the owner reads and changes it; staff and clients cannot; an admin can for a named business', async () => {
        const { owner, staff, client, admin } = await world();
        const get = await request(app).get('/api/payments/settings').set(authHeader(owner));
        expect(get.status).toBe(200);
        expect(get.body.data).toMatchObject({ mode: 'full', currency: 'NAD', onlinePaymentAvailable: true, holdMinutes: 15 });

        const put = await request(app).put('/api/payments/settings').set(authHeader(owner)).send({ mode: 'deposit', depositType: 'percent', depositValue: 30 });
        expect(put.status).toBe(200);
        expect(put.body.data).toMatchObject({ mode: 'deposit', depositType: 'percent', depositValue: 30 });

        for (const who of [staff, client]) {
            expect((await request(app).get('/api/payments/settings').set(authHeader(who))).status).toBe(403);
            expect((await request(app).put('/api/payments/settings').set(authHeader(who)).send({ mode: 'at_appointment' })).status).toBe(403);
        }
        expect((await request(app).put('/api/payments/settings').set(authHeader(admin)).send({ mode: 'full' })).status).toBe(400);
        const byAdmin = await request(app).put('/api/payments/settings').set(authHeader(admin)).send({ providerId: String(owner._id), mode: 'full' });
        expect(byAdmin.status).toBe(200);
        expect((await User.findById(owner._id)).paymentSettings.mode).toBe('full');
        expect((await request(app).get('/api/payments/settings')).status).toBe(401);
    });

    it('validates the deposit and refuses online payment for a non-NAD business', async () => {
        const { owner } = await world();
        const bad = [
            { mode: 'sometimes' },
            { mode: 'deposit', depositType: 'percent', depositValue: 0 },
            { mode: 'deposit', depositType: 'percent', depositValue: 101 },
            { mode: 'deposit', depositType: 'percent', depositValue: 12.5 },
            { mode: 'deposit', depositType: 'fixed', depositValue: 0 },
            { mode: 'deposit', depositType: 'bitcoin', depositValue: 10 },
        ];
        for (const body of bad) {
            const r = await request(app).put('/api/payments/settings').set(authHeader(owner)).send(body);
            expect(r.status).toBe(400);
        }
        expect((await request(app).put('/api/payments/settings').set(authHeader(owner)).send({ mode: 'deposit', depositType: 'fixed', depositValue: 5000 })).status).toBe(200);

        const zar = await makeProvider({ businessProfile: { currency: 'ZAR' } });
        const r = await request(app).put('/api/payments/settings').set(authHeader(zar)).send({ mode: 'full' });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('currency_not_supported');
        expect((await request(app).put('/api/payments/settings').set(authHeader(zar)).send({ mode: 'at_appointment' })).status).toBe(200);
    });

    it('the public policy tells the booking page what will be asked', async () => {
        const { owner } = await world();
        await User.updateOne({ _id: owner._id }, { $set: { paymentSettings: { mode: 'deposit', depositType: 'percent', depositValue: 25 } } });
        const r = await request(app).get(`/api/payments/policy/${owner._id}?priceCents=20000`);
        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ mode: 'deposit', onlinePayment: true, currency: 'NAD', amountDueOnlineCents: 5000, paymentKind: 'deposit' });
        // Never leaks into the public business profile.
        const prof = await request(app).get(`/api/providers/${owner._id}`);
        expect(JSON.stringify(prof.body)).not.toMatch(/paymentSettings|payoutAccount/);
    });
});

describe('payout bank account', () => {
    it('owner-only; masked except the last 4 unless asked for on the edit endpoint; never in other payloads', async () => {
        const { owner, staff, admin } = await world();
        expect((await request(app).get('/api/payments/payout-account').set(authHeader(owner))).body.data).toMatchObject({ hasAccount: false });

        const bad = await request(app).put('/api/payments/payout-account').set(authHeader(owner)).send({ ...ACCOUNT, accountNumber: '12ab' });
        expect(bad.status).toBe(400);
        const put = await request(app).put('/api/payments/payout-account').set(authHeader(owner)).send(ACCOUNT);
        expect(put.status).toBe(200);
        expect(put.body.data).toMatchObject({ hasAccount: true, bankName: 'Bank Windhoek', accountNumberMasked: '•••• 4821', branchCode: '483872' });
        expect(put.body.data.accountNumber).toBeUndefined();

        const get = await request(app).get('/api/payments/payout-account').set(authHeader(owner));
        expect(get.body.data.accountNumberMasked).toBe('•••• 4821');
        expect(JSON.stringify(get.body)).not.toContain('80041234821');
        const edit = await request(app).get('/api/payments/payout-account/edit').set(authHeader(owner));
        expect(edit.body.data.accountNumber).toBe('80041234821');

        for (const who of [staff, admin]) {
            expect((await request(app).get('/api/payments/payout-account').set(authHeader(who))).status).toBe(403);
            expect((await request(app).get('/api/payments/payout-account/edit').set(authHeader(who))).status).toBe(403);
        }
        // Not in the owner's own profile payload either.
        const me = await request(app).get('/api/auth/profile').set(authHeader(owner));
        expect(me.status).toBe(200);
        expect(JSON.stringify(me.body)).not.toContain('80041234821');
    });
});

describe('the owner’s money', () => {
    it('balance with monthly totals and last payout; ledger with running balance; staff sees none of it', async () => {
        const { owner, staff, client, admin, service } = await world();
        await paidBooking(service);
        await paidBooking(service, { start: '11:00', end: '11:30', name: 'Ben Iipinge' });
        await User.updateOne({ _id: owner._id }, { $set: { payoutAccount: { ...ACCOUNT, accountNumber: '80041234821' } } });
        const payout = await request(app).post('/api/payments/admin/payouts').set(authHeader(admin))
            .send({ providerId: String(owner._id), amountCents: 15000, reference: 'EFT-0001' });
        expect(payout.status).toBe(201);

        const bal = await request(app).get('/api/payments/me/balance').set(authHeader(owner));
        expect(bal.status).toBe(200);
        expect(bal.body.data).toMatchObject({
            currency: 'NAD', balanceOwedCents: 25000, paidOnlineThisMonthCents: 40000, paidOutThisMonthCents: 15000,
            lastPayout: { amountCents: 15000, reference: 'EFT-0001' },
        });

        const ledger = await request(app).get('/api/payments/me/ledger?limit=2').set(authHeader(owner));
        expect(ledger.body.total).toBe(3);
        expect(ledger.body.data[0]).toMatchObject({ type: 'payout', amountCents: -15000, balanceAfterCents: 25000 });
        expect(ledger.body.data[1]).toMatchObject({ type: 'payment', amountCents: 20000, balanceAfterCents: 40000 });
        expect(ledger.body.data[1].description).toBe('Online payment: Ben — Taper Fade');
        const page2 = await request(app).get('/api/payments/me/ledger?limit=2&page=2').set(authHeader(owner));
        expect(page2.body.data[0]).toMatchObject({ type: 'payment', balanceAfterCents: 20000 });

        const pays = await request(app).get('/api/payments/me/payments').set(authHeader(owner));
        expect(pays.body.total).toBe(2);
        expect(pays.body.data[0]).toMatchObject({ status: 'paid', amountCents: 20000, refundableCents: 20000 });
        expect(pays.body.data[0].appointment).toMatchObject({ service: 'Taper Fade', status: 'confirmed' });

        for (const path of ['/api/payments/me/balance', '/api/payments/me/ledger', '/api/payments/me/payments', '/api/payments/me/statement.csv']) {
            expect((await request(app).get(path).set(authHeader(staff))).status).toBe(403);
            expect((await request(app).get(path).set(authHeader(client))).status).toBe(403);
        }
    });

    it('the statement CSV has a running balance and cannot inject formulas', async () => {
        const { owner, service } = await world();
        await paidBooking(service, { name: '=HYPERLINK Smith' });
        const csv = await request(app).get('/api/payments/me/statement.csv').set(authHeader(owner));
        expect(csv.status).toBe(200);
        expect(csv.headers['content-type']).toMatch(/text\/csv/);
        expect(csv.headers['content-disposition']).toMatch(/attachment; filename="bookplus-statement-/);
        const lines = csv.text.trim().split('\r\n');
        expect(lines[0]).toBe('Date,Type,Description,Amount (NAD),Balance (NAD)');
        expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},Online payment,/);
        expect(lines[1]).toContain('200.00,200.00');
        // The client's name starts with "=" — but the description cell starts with
        // "Online payment:", so it is inert; a cell that itself starts with = gets a quote.
        expect(lines[1]).not.toMatch(/,=/);
        const { csvCellForTest } = require('../../controllers/paymentController');
        expect(csvCellForTest('=SUM(A1)')).toBe("'=SUM(A1)");
        expect(csvCellForTest('-5.00')).toBe('-5.00'); // a plain amount stays a number
        expect(csvCellForTest('-1+cmd|x')).toBe("'-1+cmd|x");
        expect(csvCellForTest('+1')).toBe("'+1");
        expect(csvCellForTest('@x')).toBe("'@x");
        expect(csvCellForTest('a,"b"')).toBe('"a,""b"""');
    });

    it('refunds: the owner of the payment’s business or an admin — not staff, not another business', async () => {
        const { owner, otherOwner, staff, admin, service } = await world();
        const payment = await paidBooking(service);
        expect((await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(staff)).send({ amountCents: 100 })).status).toBe(403);
        expect((await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(otherOwner)).send({ amountCents: 100 })).status).toBe(404);
        expect((await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(owner)).send({ amountCents: 100 })).status).toBe(200);
        expect((await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(admin)).send({ amountCents: 100 })).status).toBe(200);
        expect((await Payment.findById(payment._id)).refundedCents).toBe(200);
        expect((await request(app).post('/api/payments/not-an-id/refund').set(authHeader(owner)).send({})).status).toBe(404);
    });
});

describe('admin: balances and payouts', () => {
    it('lists what each business is owed with masked bank details and a missing-account flag', async () => {
        const { owner, otherOwner, admin, staff } = await world();
        const svc2 = await makeService(otherOwner._id, { price: 100, duration: 30 });
        await User.updateOne({ _id: otherOwner._id }, { $set: { paymentSettings: { mode: 'full' } } });
        const { service } = await (async () => ({ service: await makeService(owner._id, { price: 200, duration: 30 }) }))();
        await paidBooking(service);
        await paidBooking(svc2, { name: 'Ben Iipinge' });
        await User.updateOne({ _id: owner._id }, { $set: { payoutAccount: { ...ACCOUNT, accountNumber: '80041234821' } } });

        const r = await request(app).get('/api/payments/admin/balances').set(authHeader(admin));
        expect(r.status).toBe(200);
        expect(r.body.totalOwedCents).toBe(30000);
        const mine = r.body.data.find((x) => String(x.providerId) === String(owner._id));
        expect(mine).toMatchObject({ balanceOwedCents: 20000, bankName: 'Bank Windhoek', accountNumberMasked: '•••• 4821', payoutAccountMissing: false, businessName: 'Vibe Cuts' });
        const other = r.body.data.find((x) => String(x.providerId) === String(otherOwner._id));
        expect(other).toMatchObject({ balanceOwedCents: 10000, payoutAccountMissing: true, accountNumberMasked: null });
        expect(JSON.stringify(r.body)).not.toContain('80041234821');

        expect((await request(app).get('/api/payments/admin/balances').set(authHeader(owner))).status).toBe(403);
        expect((await request(app).get('/api/payments/admin/balances').set(authHeader(staff))).status).toBe(403);
        const list = await request(app).get(`/api/payments/admin/payments?providerId=${owner._id}&status=paid`).set(authHeader(admin));
        expect(list.body.total).toBe(1);
        const led = await request(app).get(`/api/payments/admin/providers/${owner._id}/ledger`).set(authHeader(admin));
        expect(led.body.balanceOwedCents).toBe(20000);
    });

    it('a payout cannot exceed the balance or go to a business without a bank account, unless overridden', async () => {
        const { owner, admin, service } = await world();
        await paidBooking(service);

        const noAccount = await request(app).post('/api/payments/admin/payouts').set(authHeader(admin)).send({ providerId: String(owner._id), amountCents: 5000 });
        expect(noAccount.status).toBe(409);
        expect(noAccount.body.code).toBe('payout_account_missing');
        await User.updateOne({ _id: owner._id }, { $set: { payoutAccount: { ...ACCOUNT, accountNumber: '80041234821' } } });

        const over = await request(app).post('/api/payments/admin/payouts').set(authHeader(admin)).send({ providerId: String(owner._id), amountCents: 20001 });
        expect(over.status).toBe(409);
        expect(over.body).toMatchObject({ code: 'exceeds_balance', balanceOwedCents: 20000 });

        const ok = await request(app).post('/api/payments/admin/payouts').set(authHeader(admin)).send({ providerId: String(owner._id), amountCents: 20000, reference: 'EFT-1' });
        expect(ok.status).toBe(201);
        expect(ok.body.data).toMatchObject({ amountCents: 20000, status: 'paid', bankName: 'Bank Windhoek', accountNumberMasked: '•••• 4821' });
        expect(ok.body.balanceOwedCents).toBe(0);
        expect(await payments.balanceOf(owner._id)).toBe(0);

        const forced = await request(app).post('/api/payments/admin/payouts').set(authHeader(admin))
            .send({ providerId: String(owner._id), amountCents: 100, allowOverdraw: true, note: 'advance' });
        expect(forced.status).toBe(201);
        expect(forced.body.data.overrides).toEqual(['balance']);
        expect(await payments.balanceOf(owner._id)).toBe(-100);
        expect(await LedgerEntry.countDocuments({ type: 'payout' })).toBe(2);

        // Owners can't record payouts; bad input is refused.
        expect((await request(app).post('/api/payments/admin/payouts').set(authHeader(owner)).send({ providerId: String(owner._id), amountCents: 1 })).status).toBe(403);
        expect((await request(app).post('/api/payments/admin/payouts').set(authHeader(admin)).send({ providerId: String(owner._id), amountCents: 1.5 })).status).toBe(400);
        expect((await request(app).post('/api/payments/admin/payouts').set(authHeader(admin)).send({ providerId: 'x', amountCents: 1 })).status).toBe(400);
        const payouts = await request(app).get('/api/payments/admin/payouts').set(authHeader(admin));
        expect(payouts.body.total).toBe(2);
        expect(await Payout.countDocuments()).toBe(2);
    });
});
