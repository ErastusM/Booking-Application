/**
 * Bookplus's day-to-day money work (payment specification, sections 8 to 10):
 * payments that need a look and "ask PayGate", the payout run (prepared,
 * paid, returned by the bank, the bank file), and disputes (chargebacks and
 * complaints: evidence, refund the client, recover a lost chargeback once).
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
const Payout = require('../../models/Payout');
const Dispute = require('../../models/Dispute');
const LedgerEntry = require('../../models/LedgerEntry');
const Appointment = require('../../models/Appointment');
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const FinanceRequest = require('../../models/FinanceRequest');
const Notification = require('../../models/Notification');
const PlatformSettings = require('../../models/PlatformSettings');
const payments = require('../../services/paymentService');
const pricing = require('../../services/pricing');
const {
    makeProvider, makeFinanceAdmin, makeService, authHeader, financeHeader, APPROVED_FOR_PAYMENTS,
} = require('../helpers/factories');
const { futureDate } = require('../helpers/dates');
const { createFakePaygate } = require('../helpers/fakePaygate');

const gw = createFakePaygate();
const CLOUD = 'e2e-cloud';

beforeAll(async () => { gw.install(); await testDb.connect(); });
afterAll(async () => { gw.uninstall(); await testDb.closeDatabase(); });
beforeEach(() => { process.env.CLOUDINARY_URL = `cloudinary://key123:secret456@${CLOUD}`; });
afterEach(async () => { delete process.env.CLOUDINARY_URL; gw.reset(); await testDb.clearDatabase(); });

const ACCOUNT = { accountHolder: 'Vibe Cuts CC', bankName: 'Bank Windhoek', branchCode: '483872', accountNumber: '80041234821', updatedAt: new Date(Date.now() - 86400000) };

// Standard plan (3% + N$1.50), full price online; N$200 pays the business N$192.50.
const business = async (name = 'Vibe Cuts', { account = true } = {}) => {
    const owner = await makeProvider({
        businessProfile: { businessName: name, currency: 'NAD' }, paymentSettings: { mode: 'full' },
        paymentsApproval: { ...APPROVED_FOR_PAYMENTS }, pricing: { plan: 'standard', rates: { commissionBps: 300, fixedFeeCents: 150 } },
        ...(account ? { payoutAccount: ACCOUNT } : {}),
    });
    const service = await makeService(owner._id, { name: 'Taper Fade', price: 200, duration: 30 });
    return { owner, service };
};

let slot = 0;
const book = async (service, { pay = true } = {}) => {
    slot += 1;
    const start = `${String(8 + (slot % 9)).padStart(2, '0')}:00`;
    const end = `${String(8 + (slot % 9)).padStart(2, '0')}:30`;
    const res = await request(app).post('/api/appointments')
        .send({ service: service._id, appointmentDate: futureDate(slot), startTime: start, endTime: end, guestName: 'Ana Shilongo', guestEmail: 'ana@example.com' });
    expect(res.status).toBe(201);
    if (pay) {
        gw.setStatus(res.body.payment.reference, 1);
        await request(app).post('/api/payments/paygate/notify').type('form').send(gw.notifyBody(res.body.payment.reference));
    }
    return Payment.findOne({ reference: res.body.payment.reference }).lean();
};

// Change a setting on top of the defaults (an upsert alone would leave the plans out).
const setSettings = async (set) => {
    await pricing.getSettings({ fresh: true });
    await PlatformSettings.updateOne({ key: 'platform' }, { $set: set });
};

const director = () => makeFinanceAdmin({ adminRoles: ['director'] });
const financeOnly = () => makeFinanceAdmin({ adminRoles: ['finance'] });

describe('payments that need a look', () => {
    it('lists stuck, flagged and refund problems; "ask PayGate" settles a stuck one and books it', async () => {
        const fin = await financeOnly();
        const { owner, service } = await business();
        const stuck = await book(service, { pay: false });
        // (createdAt is immutable through the model.)
        await Payment.collection.updateOne({ _id: stuck._id }, { $set: { createdAt: new Date(Date.now() - 20 * 60 * 1000) } });
        await book(service, { pay: false }); // fresh: still within its time
        const paid = await book(service);
        await Payment.updateOne({ _id: paid._id }, { $set: { flagged: true, flagReason: 'amount mismatch' } });

        const list = await request(app).get('/api/admin/finance/payments?view=attention').set(financeHeader(fin));
        expect(list.status).toBe(200);
        expect(list.body.data.map((p) => String(p._id)).sort()).toEqual([String(stuck._id), String(paid._id)].sort());

        // The client paid, but the notify never came: PayGate knows.
        gw.setStatus(stuck.reference, 1);
        const sync = await request(app).post(`/api/admin/finance/payments/${stuck._id}/sync`).set(financeHeader(fin));
        expect(sync.status).toBe(200);
        expect(sync.body.message).toMatch(/initiated → paid/);
        expect(sync.body.data.status).toBe('paid');
        expect((await Appointment.findById(stuck.appointment)).status).toBe('confirmed');
        expect(await LedgerEntry.countDocuments({ payment: stuck._id, type: 'payment' })).toBe(1);
        expect(await FinancialAuditLog.findOne({ action: 'payment.sync' }).lean()).toMatchObject({ details: { before: 'initiated', after: 'paid' } });
        expect(await payments.balanceOf(owner._id)).toBe(2 * 19250);

        // A business can't use the admin money routes.
        expect((await request(app).get('/api/admin/finance/payments').set(authHeader(owner))).status).toBe(403);
    });
});

describe('payout run', () => {
    it('who is due, prepare, the bank file, paid, returned by the bank', async () => {
        const fin = await financeOnly();
        const a = await business('Vibe Cuts');
        const b = await business('Glow Nails');
        const c = await business('No Account', { account: false });
        await book(a.service);
        await book(a.service);
        await book(b.service);
        await book(c.service);

        const due = await request(app).get('/api/admin/finance/payouts/due').set(financeHeader(fin));
        expect(due.status).toBe(200);
        expect(due.body.schedule).toMatchObject({ frequency: 'weekly', weekday: 5, weekdayName: 'Friday' });
        expect(new Date(due.body.schedule.nextRunDate).getUTCDay()).toBe(5);
        const row = (id) => due.body.data.find((r) => String(r.providerId) === String(id));
        expect(row(a.owner._id)).toMatchObject({ amountCents: 38500, payable: true, accountNumberMasked: '•••• 4821' });
        expect(row(c.owner._id)).toMatchObject({ payable: false, blockedBy: 'payout_account_missing' });
        expect(due.body.totalPayableCents).toBe(38500 + 19250);

        const run = await request(app).post('/api/admin/finance/payouts/run').set(financeHeader(fin))
            .send({ providerIds: [a.owner._id, b.owner._id, c.owner._id] });
        expect(run.status).toBe(201);
        expect(run.body.data.created).toHaveLength(2);
        expect(run.body.data.skipped).toEqual([{ providerId: String(c.owner._id), reason: 'payout_account_missing' }]);
        const pa = run.body.data.created.find((p) => String(p.provider) === String(a.owner._id));
        expect(pa).toMatchObject({ status: 'pending', amountCents: 38500, ourReference: expect.stringMatching(/^BPP[0-9A-F]{10}$/) });
        // The money is on its way: off the balance at once, and not prepared twice.
        expect(await payments.balanceOf(a.owner._id)).toBe(0);
        expect((await payments.balanceSummary(a.owner._id)).payoutsOnTheirWayCents).toBe(38500);
        const again = await request(app).post('/api/admin/finance/payouts/run').set(financeHeader(fin)).send({ providerIds: [a.owner._id] });
        expect(again.body.data.created).toHaveLength(0);
        // Nor can the business be deleted while a payout is on its way.
        expect((await payments.outstandingFor(a.owner._id)).open).toBe(true);

        // The bank file has the full account numbers; a changed account is held back.
        await User.updateOne({ _id: b.owner._id }, { $set: { 'payoutAccount.accountNumber': '62000000001', 'payoutAccount.updatedAt': new Date() } });
        const file = await request(app).get('/api/admin/finance/payouts/bank-file.csv').set(financeHeader(fin));
        expect(file.status).toBe(200);
        expect(file.headers['content-type']).toMatch(/text\/csv/);
        const lines = file.text.trim().split('\r\n');
        expect(lines[0]).toBe('Business,Account holder,Bank,Branch code,Account number,Amount (NAD),Reference,Check');
        expect(lines.find((l) => l.startsWith('Vibe Cuts,'))).toBe(`Vibe Cuts,Vibe Cuts CC,Bank Windhoek,483872,80041234821,385.00,${pa.ourReference},OK`);
        const glow = lines.find((l) => l.startsWith('Glow Nails,'));
        expect(glow).not.toContain('62000000001');
        expect(glow).toContain('do not pay, check first');
        expect(await FinancialAuditLog.findOne({ action: 'payout.bank_file' }).lean()).toMatchObject({ amountCents: 38500 + 19250 });

        // Paid: the business is told, with the reference on the transfer.
        expect((await request(app).post(`/api/admin/finance/payouts/${pa._id}/paid`).set(financeHeader(fin)).send({})).body.code).toBe('reference_required');
        const paid = await request(app).post(`/api/admin/finance/payouts/${pa._id}/paid`).set(financeHeader(fin)).send({ bankReference: 'BW-77812' });
        expect(paid.status).toBe(200);
        expect(paid.body.data).toMatchObject({ status: 'paid', reference: 'BW-77812' });
        expect(await Notification.findOne({ user: a.owner._id, message: /paid N\$385.00 into your bank account/ })).not.toBeNull();
        const summary = await payments.balanceSummary(a.owner._id);
        expect(summary).toMatchObject({ paidOutThisMonthCents: 38500, payoutsOnTheirWayCents: 0, lastPayout: { amountCents: 38500, reference: 'BW-77812' } });

        // Returned by the bank: the money is owed again, once.
        const pb = run.body.data.created.find((p) => String(p.provider) === String(b.owner._id));
        const back = await request(app).post(`/api/admin/finance/payouts/${pb._id}/failed`).set(financeHeader(fin)).send({ reason: 'Account closed' });
        expect(back.status).toBe(200);
        expect(await payments.balanceOf(b.owner._id)).toBe(19250);
        expect((await request(app).post(`/api/admin/finance/payouts/${pb._id}/failed`).set(financeHeader(fin)).send({ reason: 'Again' })).status).toBe(409);
        expect(await payments.balanceOf(b.owner._id)).toBe(19250);
        expect(await Notification.findOne({ user: b.owner._id, message: /could not be paid into your bank account: Account closed/ })).not.toBeNull();
        const statement = await request(app).get('/api/payments/me/ledger').set(authHeader(b.owner));
        expect(statement.body.data[0]).toMatchObject({ type: 'payout_reversal', description: 'Payout returned by the bank: Account closed', amountCents: 19250 });
    });

    it('a refund the business asked Bookplus to approve is held back from the payout', async () => {
        const fin = await financeOnly();
        const a = await business();
        const p1 = await book(a.service);
        await book(a.service);
        // N$60 is over the N$50 limit: it waits for a director, and is not paid out.
        await setSettings({ 'approvals.refundThresholdCents': 5000 });
        const asked = await request(app).post(`/api/payments/${p1._id}/refund`).set(authHeader(a.owner)).send({ amountCents: 6000, reason: 'Wrong colour' });
        expect(asked.status).toBe(202);
        const due = await request(app).get('/api/admin/finance/payouts/due').set(financeHeader(fin));
        expect(due.body.data[0]).toMatchObject({ balanceOwedCents: 38500, amountCents: 32500, payable: true });
        const run = await request(app).post('/api/admin/finance/payouts/run').set(financeHeader(fin)).send({ providerIds: [a.owner._id] });
        expect(run.body.data.created[0].amountCents).toBe(32500);
        expect(await payments.balanceOf(a.owner._id)).toBe(6000);
    });

    it('a business owed less than the threshold is not due', async () => {
        const fin = await financeOnly();
        const a = await business();
        await book(a.service);
        await setSettings({ 'payout.minThresholdCents': 50000 });
        const due = await request(app).get('/api/admin/finance/payouts/due').set(financeHeader(fin));
        expect(due.body.data).toEqual([]);
        const run = await request(app).post('/api/admin/finance/payouts/run').set(financeHeader(fin)).send({ providerIds: [a.owner._id] });
        expect(run.body.data.skipped).toEqual([{ providerId: String(a.owner._id), reason: 'below_threshold' }]);
    });
});

describe('disputes', () => {
    it('a lost chargeback: evidence, then recovered from the business once, with a director\'s approval', async () => {
        const fin = await financeOnly();
        const dir = await director();
        const { owner, service } = await business();
        await setSettings({ chargebackFeeCents: 15000 });
        const p = await book(service);

        const noSummary = await request(app).post('/api/admin/finance/disputes').set(financeHeader(fin)).send({ paymentId: p._id, kind: 'chargeback' });
        expect(noSummary.body.code).toBe('summary_required');
        const open = await request(app).post('/api/admin/finance/disputes').set(financeHeader(fin))
            .send({ paymentId: p._id, kind: 'chargeback', summary: 'Client says they were never there', caseReference: 'CB-1001', deadlineAt: '2026-11-30' });
        expect(open.status).toBe(201);
        expect(open.body.data).toMatchObject({ status: 'open', amountCents: 20000, feeCents: 15000, caseReference: 'CB-1001' });
        const id = open.body.data._id;
        expect((await request(app).post('/api/admin/finance/disputes').set(financeHeader(fin)).send({ paymentId: p._id, kind: 'chargeback', summary: 'x' })).body.code).toBe('dispute_open');
        expect(await Notification.findOne({ user: owner._id, message: /disputed a card payment of N\$200.00/ })).not.toBeNull();

        // Notes and private evidence.
        expect((await request(app).post(`/api/admin/finance/disputes/${id}/notes`).set(financeHeader(fin)).send({ text: 'Asked the business for the booking log' })).status).toBe(201);
        const up = await request(app).post(`/api/admin/finance/disputes/${id}/evidence/upload`).set(financeHeader(fin));
        expect(up.status).toBe(200);
        expect(up.body.data).toMatchObject({ folder: `bookplus/disputes/${id}`, type: 'authenticated' });
        const wrongFolder = await request(app).post(`/api/admin/finance/disputes/${id}/evidence`).set(financeHeader(fin))
            .send({ name: 'log.pdf', ref: { publicId: 'bookplus/disputes/other/x', resourceType: 'image', format: 'pdf' } });
        expect(wrongFolder.body.code).toBe('bad_ref');
        expect((await request(app).post(`/api/admin/finance/disputes/${id}/evidence`).set(financeHeader(fin))
            .send({ name: 'log.pdf', ref: { publicId: `bookplus/disputes/${id}/log`, resourceType: 'image', format: 'pdf' } })).status).toBe(201);
        const detail = await request(app).get(`/api/admin/finance/disputes/${id}`).set(financeHeader(fin));
        expect(detail.body.data.notes[0]).toMatchObject({ text: 'Asked the business for the booking log' });
        expect(detail.body.data.evidence[0]).toMatchObject({ name: 'log.pdf' });
        expect(JSON.stringify(detail.body.data)).not.toContain('publicId');
        const link = await request(app).get(`/api/admin/finance/disputes/${id}/evidence/${detail.body.data.evidence[0]._id}`).set(financeHeader(fin));
        expect(link.body.data.url).toContain(`api.cloudinary.com/v1_1/${CLOUD}/image/download?public_id=bookplus%2Fdisputes%2F${id}%2Flog`);
        expect(await FinancialAuditLog.countDocuments({ action: 'dispute.evidence_view' })).toBe(1);

        // A chargeback is not refunded by Bookplus (the card company does it).
        expect((await request(app).post(`/api/admin/finance/disputes/${id}/refund`).set(financeHeader(fin)).send({ reason: 'x' })).body.code).toBe('chargeback');

        // Lost: recover the amount and the fee, once a director approves.
        const lost = await request(app).post(`/api/admin/finance/disputes/${id}/close`).set(financeHeader(fin))
            .send({ outcome: 'lost', note: 'Bank sided with the client', recover: {} });
        expect(lost.status).toBe(200);
        expect(lost.body.data).toMatchObject({ status: 'lost', recovery: { status: 'pending', amountCents: 35000 } });
        expect(await payments.balanceOf(owner._id)).toBe(19250);
        const reqId = lost.body.data.recovery.request;
        expect((await request(app).post(`/api/admin/finance/requests/${reqId}/approve`).set(financeHeader(fin)).send({})).status).toBe(403);
        const yes = await request(app).post(`/api/admin/finance/requests/${reqId}/approve`).set(financeHeader(dir)).send({});
        expect(yes.body.data).toMatchObject({ status: 'executed', result: { ledgerKey: `chargeback:${id}` } });
        expect(await payments.balanceOf(owner._id)).toBe(19250 - 35000);
        expect((await Dispute.findById(id)).recovery.status).toBe('done');
        expect(await Notification.findOne({ user: owner._id, message: /N\$350.00 from your balance for a card chargeback/ })).not.toBeNull();

        // Never twice, even through a second request.
        const twin = await FinanceRequest.create({ type: 'recovery', provider: owner._id, payment: p._id, dispute: id, amountCents: 35000, reason: 'again', preparedBy: fin._id });
        const second = await request(app).post(`/api/admin/finance/requests/${twin._id}/approve`).set(financeHeader(dir)).send({});
        expect(second.body.data).toMatchObject({ status: 'failed', result: { code: 'already_recovered' } });
        expect(await payments.balanceOf(owner._id)).toBe(19250 - 35000);
        expect(await LedgerEntry.countDocuments({ type: 'chargeback' })).toBe(1);

        // Closed is closed.
        expect((await request(app).post(`/api/admin/finance/disputes/${id}/close`).set(financeHeader(fin)).send({ outcome: 'won', note: 'x' })).status).toBe(409);
    });

    it('a complaint that the service was not provided: refund the client (with approval above the limit)', async () => {
        const fin = await financeOnly();
        const dir = await director();
        const { service } = await business();
        await setSettings({ 'approvals.refundThresholdCents': 5000 });
        const p = await book(service);
        const open = await request(app).post('/api/admin/finance/disputes').set(financeHeader(fin))
            .send({ paymentId: p._id, kind: 'service_not_provided', summary: 'Business was closed when the client arrived' });
        const id = open.body.data._id;
        expect(open.body.data.feeCents).toBe(0);
        // Won/lost is for chargebacks.
        expect((await request(app).post(`/api/admin/finance/disputes/${id}/close`).set(financeHeader(fin)).send({ outcome: 'won', note: 'x' })).body.code).toBe('bad_outcome');

        const r = await request(app).post(`/api/admin/finance/disputes/${id}/refund`).set(financeHeader(fin)).send({ reason: 'Business was closed' });
        expect(r.status).toBe(202);
        expect(r.body.code).toBe('approval_required');
        expect(r.body.data.dispute).toBe(id);
        expect((await request(app).post(`/api/admin/finance/disputes/${id}/refund`).set(financeHeader(fin)).send({ reason: 'again' })).body.code).toBe('request_pending');
        await request(app).post(`/api/admin/finance/requests/${r.body.data._id}/approve`).set(financeHeader(dir)).send({});
        expect((await Payment.findById(p._id)).refundedCents).toBe(20000);
        expect((await Dispute.findById(id)).status).toBe('refunded');
    });

    it('a small complaint refund runs at once and closes the case', async () => {
        const fin = await financeOnly();
        const { service } = await business();
        const p = await book(service);
        const open = await request(app).post('/api/admin/finance/disputes').set(financeHeader(fin))
            .send({ paymentId: p._id, kind: 'service_not_provided', summary: 'Half the service', amountCents: 10000 });
        const r = await request(app).post(`/api/admin/finance/disputes/${open.body.data._id}/refund`).set(financeHeader(fin)).send({ amountCents: 10000, reason: 'Half done' });
        expect(r.status).toBe(200);
        expect((await Dispute.findById(open.body.data._id)).status).toBe('refunded');
        const list = await request(app).get('/api/admin/finance/disputes?status=closed').set(financeHeader(fin));
        expect(list.body.data).toHaveLength(1);
    });
});
