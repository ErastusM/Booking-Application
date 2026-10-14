/**
 * A business applies to take online payments and Bookplus reviews it (payment
 * specification, section 6): plan, details, private documents, payout account,
 * terms; send; approve / ask for more / reject; the business's own switch and
 * Bookplus's override; a changed bank account held for checking; and nothing
 * is asked online until all of that says yes. Cloudinary is mocked (fetch).
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
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const Notification = require('../../models/Notification');
const payments = require('../../services/paymentService');
const {
    makeProvider, makeUser, makeAdmin, makeFinanceAdmin, makeService, authHeader, financeHeader,
} = require('../helpers/factories');

const CLOUD = 'bookplus-test';
const realFetch = global.fetch;
let fetchCalls;

beforeAll(() => testDb.connect());
beforeEach(() => {
    process.env.CLOUDINARY_URL = `cloudinary://key123:secret456@${CLOUD}`;
    fetchCalls = [];
    global.fetch = jest.fn(async (url, opts = {}) => {
        fetchCalls.push({ url: String(url), opts });
        return { ok: true, status: 200, json: async () => ({ result: 'ok' }) };
    });
});
afterEach(async () => {
    global.fetch = realFetch;
    delete process.env.CLOUDINARY_URL;
    await testDb.clearDatabase();
});
afterAll(() => testDb.closeDatabase());

const ACCOUNT = { accountHolder: 'Vibe Cuts CC', bankName: 'Bank Windhoek', branchCode: '483872', accountNumber: '8004 123 4821' };
const ref = (owner, name) => ({ publicId: `bookplus/verification/${owner._id}/${name}`, resourceType: 'image', format: 'pdf' });

const business = async () => {
    const owner = await makeProvider({ businessProfile: { businessName: 'Vibe Cuts', currency: 'NAD' }, paymentSettings: { mode: 'full' } });
    const service = await makeService(owner._id, { name: 'Taper Fade', price: 200, duration: 30 });
    return { owner, service };
};

// A complete application, sent.
const apply = async (owner) => {
    const h = authHeader(owner);
    await request(app).put('/api/payments/onboarding').set(h).send({
        plan: 'standard',
        legal: { businessType: 'cc', registeredName: 'Vibe Cuts CC', registrationNumber: 'CC/2021/01234', ownerName: 'Ndapewa Shilongo', ownerIdNumber: '85010100123' },
    });
    for (const kind of ['owner_id', 'registration', 'bank_letter']) {
        // eslint-disable-next-line no-await-in-loop
        await request(app).post('/api/payments/onboarding/documents').set(h).send({ kind, name: `${kind}.pdf`, ref: ref(owner, kind) });
    }
    await request(app).put('/api/payments/payout-account').set(h).send(ACCOUNT);
    const sent = await request(app).post('/api/payments/onboarding/submit').set(h).send({ acceptTerms: true });
    expect(sent.status).toBe(200);
    return sent;
};

describe('the business applies', () => {
    it('sees every cost, fills it in step by step, and can only send it complete with the terms accepted', async () => {
        await makeAdmin(); // told when it is sent
        const { owner } = await business();
        const h = authHeader(owner);
        const first = await request(app).get('/api/payments/onboarding').set(h);
        expect(first.status).toBe(200);
        expect(first.body.data).toMatchObject({ status: 'draft', editable: true, canSubmit: false, takingPayments: false });
        expect(first.body.data.plans).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'basic', trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999, commissionBps: 150, fixedFeeCents: 0 }),
            expect.objectContaining({ key: 'standard', priceCents: 0, commissionBps: 300, fixedFeeCents: 150 }),
        ]));
        expect(first.body.data.processingFee).toMatchObject({ known: false, payer: 'business' });
        expect(first.body.data.missing).toEqual(expect.arrayContaining(['plan', 'ownerIdNumber', 'doc_owner_id', 'doc_bank_letter', 'payoutAccount']));

        expect((await request(app).put('/api/payments/onboarding').set(h).send({ plan: 'gold' })).body.code).toBe('bad_plan');
        expect((await request(app).put('/api/payments/onboarding').set(h).send({ legal: { ownerIdNumber: '<script>' } })).body.code).toBe('bad_id_number');

        // Uploads are private, into this business's own folder only.
        const params = await request(app).post('/api/payments/onboarding/upload').set(h);
        expect(params.body.data).toMatchObject({ type: 'authenticated', folder: `bookplus/verification/${owner._id}`, allowed_formats: 'jpg,jpeg,png,pdf' });
        const other = await makeProvider();
        const theirs = await request(app).post('/api/payments/onboarding/documents').set(h).send({ kind: 'owner_id', ref: ref(other, 'id') });
        expect(theirs.body.code).toBe('bad_upload');
        const proofFolder = await request(app).post('/api/payments/onboarding/documents').set(h)
            .send({ kind: 'owner_id', ref: { publicId: `bookplus/proofs/${owner._id}/x`, resourceType: 'image', format: 'pdf' } });
        expect(proofFolder.body.code).toBe('bad_upload');

        // A sole trader needs no company registration.
        await request(app).put('/api/payments/onboarding').set(h).send({ plan: 'basic', legal: { businessType: 'sole_trader', registeredName: 'Vibe Cuts', ownerName: 'Ndapewa Shilongo', ownerIdNumber: '85010100123' } });
        await request(app).post('/api/payments/onboarding/documents').set(h).send({ kind: 'owner_id', name: 'id.pdf', ref: ref(owner, 'id') });
        const added = await request(app).post('/api/payments/onboarding/documents').set(h).send({ kind: 'bank_letter', name: 'bank.pdf', ref: ref(owner, 'bank') });
        expect(added.status).toBe(201);
        expect(added.body.data.missing).toEqual(['payoutAccount']);
        // The ID number is masked back to the business; nothing secret in the payload.
        expect(added.body.data.legal.ownerIdNumberMasked).toBe('••••••••123');
        expect(JSON.stringify(added.body)).not.toMatch(/85010100123|publicId|verification\//);

        expect((await request(app).post('/api/payments/onboarding/submit').set(h).send({ acceptTerms: true })).body).toMatchObject({ code: 'incomplete', missing: ['payoutAccount'] });
        await request(app).put('/api/payments/payout-account').set(h).send(ACCOUNT);
        expect((await request(app).post('/api/payments/onboarding/submit').set(h).send({})).body.code).toBe('terms_required');
        const sent = await request(app).post('/api/payments/onboarding/submit').set(h).send({ acceptTerms: true });
        expect(sent.body.data).toMatchObject({ status: 'submitted', editable: false });

        // With Bookplus now: no changes (the bank account included), no second send.
        const swap = await request(app).put('/api/payments/payout-account').set(h).send({ ...ACCOUNT, accountNumber: '62000111222' });
        expect(swap.status).toBe(409);
        expect(swap.body.code).toBe('application_under_review');
        expect((await User.findById(owner._id).select('+payoutAccount').lean()).payoutAccount.accountNumber).toBe('80041234821');
        expect((await request(app).put('/api/payments/onboarding').set(h).send({ plan: 'standard' })).body.code).toBe('not_editable');
        expect((await request(app).post('/api/payments/onboarding/submit').set(h).send({ acceptTerms: true })).body.code).toBe('not_editable');
        expect(await FinancialAuditLog.countDocuments({ action: 'approval.submit', provider: owner._id })).toBe(1);
        expect(await Notification.countDocuments({ message: /Vibe Cuts applied to take online payments/ })).toBeGreaterThan(0);
        // Not in the profile payload.
        const me = await request(app).get('/api/auth/profile').set(h);
        expect(JSON.stringify(me.body)).not.toMatch(/paymentsApproval|85010100123/);
    });

    it('only the owner: staff, customers and admins are refused', async () => {
        const { owner } = await business();
        const staff = await makeUser({ role: 'staff', staffOf: owner._id });
        for (const who of [staff, await makeUser(), await makeAdmin()]) {
            // eslint-disable-next-line no-await-in-loop
            expect((await request(app).get('/api/payments/onboarding').set(authHeader(who))).status).toBe(403);
        }
    });

    it('without file storage set up, uploads are refused rather than made public', async () => {
        delete process.env.CLOUDINARY_URL;
        const { owner } = await business();
        const r = await request(app).post('/api/payments/onboarding/upload').set(authHeader(owner));
        expect(r.status).toBe(503);
        expect(r.body.code).toBe('uploads_unavailable');
    });
});

describe('Bookplus reviews it', () => {
    it('finance sees the full details and opens documents through short-lived links (audited)', async () => {
        const { owner } = await business();
        await apply(owner);
        const fin = await makeFinanceAdmin({ adminRoles: ['finance'] });
        const list = await request(app).get('/api/admin/finance/approvals').set(financeHeader(fin));
        expect(list.body.data).toEqual([expect.objectContaining({ _id: String(owner._id), status: 'submitted', plan: 'standard', businessName: 'Vibe Cuts' })]);
        const one = await request(app).get(`/api/admin/finance/approvals/${owner._id}`).set(financeHeader(fin));
        expect(one.body.data.application.legal.ownerIdNumber).toBe('85010100123');
        expect(one.body.data.payoutAccount.accountNumber).toBe('80041234821');
        expect(one.body.data.missing).toEqual([]);
        const doc = one.body.data.application.documents.find((d) => d.kind === 'registration');
        const link = await request(app).get(`/api/admin/finance/approvals/${owner._id}/documents/${doc._id}`).set(financeHeader(fin));
        expect(link.status).toBe(200);
        expect(link.body.data.url).toMatch(new RegExp(`^https://api\\.cloudinary\\.com/v1_1/${CLOUD}/image/download\\?`));
        expect(link.body.data.url).toContain('expires_at=');
        expect(await FinancialAuditLog.countDocuments({ action: 'approval.document_view', provider: owner._id })).toBe(1);
        // Seeing the full ID and bank numbers is recorded too.
        expect(await FinancialAuditLog.countDocuments({ action: 'approval.view', provider: owner._id, actor: fin._id })).toBe(1);
        // Without a confirmed session or the role: no.
        expect((await request(app).get('/api/admin/finance/approvals').set(authHeader(fin))).body.code).toBe('mfa_required');
        expect((await request(app).get('/api/admin/finance/approvals').set(authHeader(owner))).status).toBe(403);
    });

    it('asks for more, the business sends it again, and approval gives it the plan at today\'s rates', async () => {
        const { owner } = await business();
        await apply(owner);
        const fin = await makeFinanceAdmin();
        const h = authHeader(owner);
        expect((await request(app).post(`/api/admin/finance/approvals/${owner._id}/decision`).set(financeHeader(fin)).send({ decision: 'request_info' })).body.code).toBe('reason_required');
        const more = await request(app).post(`/api/admin/finance/approvals/${owner._id}/decision`).set(financeHeader(fin)).send({ decision: 'request_info', note: 'The bank letter is older than 3 months' });
        expect(more.body.data.status).toBe('info_requested');
        const seen = await request(app).get('/api/payments/onboarding').set(h);
        expect(seen.body.data).toMatchObject({ status: 'info_requested', editable: true, decisionNote: 'The bank letter is older than 3 months' });
        const oldLetter = seen.body.data.documents.find((d) => d.kind === 'bank_letter');
        await request(app).delete(`/api/payments/onboarding/documents/${oldLetter._id}`).set(h);
        expect(fetchCalls.some((c) => c.url.includes('/image/destroy'))).toBe(true);
        await request(app).post('/api/payments/onboarding/documents').set(h).send({ kind: 'bank_letter', name: 'new.pdf', ref: ref(owner, 'bank2') });
        expect((await request(app).post('/api/payments/onboarding/submit').set(h).send({ acceptTerms: true })).body.data.status).toBe('submitted');

        const ok = await request(app).post(`/api/admin/finance/approvals/${owner._id}/decision`).set(financeHeader(fin)).send({ decision: 'approve' });
        expect(ok.status).toBe(200);
        expect(ok.body.data.status).toBe('approved');
        const after = await User.findById(owner._id).lean();
        expect(after.pricing).toMatchObject({ plan: 'standard', rates: { commissionBps: 300, fixedFeeCents: 150 } });
        const approvedEntry = await FinancialAuditLog.findOne({ action: 'approval.approve', provider: owner._id }).lean();
        expect(approvedEntry.details).toMatchObject({ pricingBefore: null, pricingAfter: { plan: 'standard', rates: { commissionBps: 300, fixedFeeCents: 150 } } });
        // Decided once only.
        expect((await request(app).post(`/api/admin/finance/approvals/${owner._id}/decision`).set(financeHeader(fin)).send({ decision: 'approve' })).body.code).toBe('not_submitted');
        expect(await Notification.countDocuments({ user: owner._id, message: /approved your business/ })).toBe(1);

        // Approved but switched off: still paid at the appointment.
        expect(await payments.planForBooking(owner._id, 200)).toBeNull();
        expect((await request(app).get(`/api/payments/policy/${owner._id}?priceCents=20000`)).body.data).toMatchObject({ onlinePayment: false, amountDueOnlineCents: 0 });
        const on = await request(app).put('/api/payments/onboarding/switch').set(h).send({ on: true });
        expect(on.body.data.takingPayments).toBe(true);
        expect(await payments.planForBooking(owner._id, 200)).toMatchObject({ kind: 'full', amountCents: 20000 });
        expect((await request(app).get(`/api/payments/policy/${owner._id}?priceCents=20000`)).body.data).toMatchObject({ onlinePayment: true, amountDueOnlineCents: 20000 });

        // Bookplus switches it off: the business can't switch it back on.
        expect((await request(app).post(`/api/admin/finance/approvals/${owner._id}/switch`).set(financeHeader(fin)).send({ off: true })).body.code).toBe('reason_required');
        await request(app).post(`/api/admin/finance/approvals/${owner._id}/switch`).set(financeHeader(fin)).send({ off: true, reason: 'Chargeback investigation' });
        expect(await payments.planForBooking(owner._id, 200)).toBeNull();
        expect((await request(app).put('/api/payments/onboarding/switch').set(h).send({ on: true })).body.code).toBe('admin_off');
        expect((await request(app).get('/api/payments/onboarding').set(h)).body.data).toMatchObject({ adminOff: true, adminOffReason: 'Chargeback investigation', takingPayments: false });
        await request(app).post(`/api/admin/finance/approvals/${owner._id}/switch`).set(financeHeader(fin)).send({ off: false, reason: 'Resolved' });
        expect(await payments.planForBooking(owner._id, 200)).not.toBeNull();
        const actions = (await FinancialAuditLog.find({ provider: owner._id }).sort({ _id: 1 }).lean()).map((e) => e.action);
        expect(actions).toEqual(expect.arrayContaining(['approval.request_info', 'approval.approve', 'payments.switch_on', 'payments.admin_off', 'payments.admin_on']));
    });

    it('a rejection says why and deletes the documents; the business can start again', async () => {
        const { owner } = await business();
        await apply(owner);
        const fin = await makeFinanceAdmin();
        expect((await request(app).post(`/api/admin/finance/approvals/${owner._id}/decision`).set(financeHeader(fin)).send({ decision: 'reject' })).body.code).toBe('reason_required');
        fetchCalls = [];
        await request(app).post(`/api/admin/finance/approvals/${owner._id}/decision`).set(financeHeader(fin)).send({ decision: 'reject', note: 'The ID does not match the owner' });
        const stored = await User.findById(owner._id).select('+paymentsApproval').lean();
        expect(stored.paymentsApproval.documents).toEqual([]);
        await new Promise((r) => setTimeout(r, 50));
        expect(fetchCalls.filter((c) => c.url.includes('/destroy'))).toHaveLength(3);
        // ...and anything else in its private folder (uploaded but never attached).
        const byPrefix = fetchCalls.filter((c) => c.opts.method === 'DELETE' && c.url.includes(`prefix=${encodeURIComponent(`bookplus/verification/${owner._id}/`)}`));
        expect(byPrefix.map((c) => c.url.match(/resources\/(image|raw)\/authenticated/)?.[1]).sort()).toEqual(['image', 'raw']);
        const h = authHeader(owner);
        const view = await request(app).get('/api/payments/onboarding').set(h);
        expect(view.body.data).toMatchObject({ status: 'rejected', editable: true, decisionNote: 'The ID does not match the owner' });
        await request(app).put('/api/payments/onboarding').set(h).send({ plan: 'basic' });
        expect((await request(app).get('/api/payments/onboarding').set(h)).body.data.status).toBe('draft');
    });

    it('a new bank account after approval holds payouts until Bookplus checks it', async () => {
        const { owner } = await business();
        await apply(owner);
        const fin = await makeFinanceAdmin();
        await request(app).post(`/api/admin/finance/approvals/${owner._id}/decision`).set(financeHeader(fin)).send({ decision: 'approve' });
        const changed = await request(app).put('/api/payments/payout-account').set(authHeader(owner)).send({ ...ACCOUNT, accountNumber: '62000111222' });
        expect(changed.body.data.heldForReview).toBe(true);
        await payments.writeEntry({ provider: owner._id, type: 'adjustment', amountCents: 5000, currency: 'NAD', key: 'test-credit' });
        const payout = await request(app).post('/api/payments/admin/payouts').set(financeHeader(fin)).send({ providerId: String(owner._id), amountCents: 5000 });
        expect(payout.status).toBe(409);
        expect(payout.body.code).toBe('payout_account_unchecked');
        expect((await request(app).get('/api/admin/finance/approvals').set(financeHeader(fin))).body.data[0]).toMatchObject({ payoutAccountReviewNeeded: true });
        expect((await request(app).post(`/api/admin/finance/approvals/${owner._id}/payout-account-checked`).set(financeHeader(fin)).send({})).body.code).toBe('reason_required');
        // The reviewer confirms the version they looked at...
        const seen = (await request(app).get(`/api/admin/finance/approvals/${owner._id}`).set(financeHeader(fin))).body.data.payoutAccount;
        expect(seen.accountNumber).toBe('62000111222');
        // ...and if the business changes it again meanwhile, nothing is confirmed.
        await new Promise((r) => setTimeout(r, 5));
        await request(app).put('/api/payments/payout-account').set(authHeader(owner)).send({ ...ACCOUNT, accountNumber: '73000999888' });
        const stale = await request(app).post(`/api/admin/finance/approvals/${owner._id}/payout-account-checked`).set(financeHeader(fin)).send({ note: 'Checked', accountUpdatedAt: seen.updatedAt });
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe('account_changed');
        const fresh = (await request(app).get(`/api/admin/finance/approvals/${owner._id}`).set(financeHeader(fin))).body.data.payoutAccount;
        await request(app).post(`/api/admin/finance/approvals/${owner._id}/payout-account-checked`).set(financeHeader(fin)).send({ note: 'New bank letter, called the owner', accountUpdatedAt: fresh.updatedAt });
        expect((await request(app).post('/api/payments/admin/payouts').set(financeHeader(fin)).send({ providerId: String(owner._id), amountCents: 5000 })).status).toBe(201);
        expect(await FinancialAuditLog.countDocuments({ action: 'payout_account.change' })).toBe(2);
        expect(await FinancialAuditLog.findOne({ action: 'payout_account.confirm' }).lean()).toMatchObject({ details: { account: { accountNumberMasked: '•••• 9888' } } });
    });
});

describe('deleting the business account', () => {
    it('removes the bank account, the application and its documents', async () => {
        const { owner } = await business();
        await apply(owner);
        fetchCalls = [];
        const del = await request(app).delete('/api/auth/account').set(authHeader(owner)).send({ password: 'Password1!' });
        expect(del.status).toBe(200);
        const stored = await User.findById(owner._id).select('+paymentsApproval +payoutAccount').lean();
        expect(stored.paymentsApproval).toBeUndefined();
        expect(stored.payoutAccount).toBeUndefined();
        await new Promise((r) => setTimeout(r, 50));
        expect(fetchCalls.filter((c) => c.url.includes('/destroy') && String(c.opts.body).includes('verification'))).toHaveLength(3);
    });
});

describe('after an admin deletes the business', () => {
    it('its documents are deleted from file storage too', async () => {
        const { owner } = await business();
        await apply(owner);
        const admin = await makeAdmin();
        fetchCalls = [];
        const del = await request(app).delete(`/api/users/${owner._id}`).set(authHeader(admin));
        expect(del.status).toBe(200);
        await new Promise((r) => setTimeout(r, 50));
        expect(fetchCalls.filter((c) => c.url.includes('/destroy') && String(c.opts.body).includes('verification'))).toHaveLength(3);
        expect(fetchCalls.some((c) => c.opts.method === 'DELETE' && c.url.includes(encodeURIComponent(`bookplus/verification/${owner._id}/`)))).toBe(true);
    });
});

describe('a booking still waiting for payment', () => {
    it('can not open a new card session once Bookplus switched the business off; the slot is let go', async () => {
        const Appointment = require('../../models/Appointment');
        const Payment = require('../../models/Payment');
        const { owner, service } = await business();
        await apply(owner);
        const fin = await makeFinanceAdmin();
        await request(app).post(`/api/admin/finance/approvals/${owner._id}/decision`).set(financeHeader(fin)).send({ decision: 'approve' });
        await request(app).put('/api/payments/onboarding/switch').set(authHeader(owner)).send({ on: true });
        const appt = await Appointment.create({
            service: service._id, provider: owner._id, guestName: 'Ana Shilongo', guestEmail: 'ana@example.com',
            appointmentDate: new Date(Date.now() + 3 * 86400000), startTime: '10:00', endTime: '10:30',
            status: 'pending_payment', totalPrice: 200, paymentHoldExpiresAt: new Date(Date.now() + 10 * 60000),
        });
        const payment = await Payment.create({
            appointment: appt._id, provider: owner._id, kind: 'full', amountCents: 20000, currency: 'NAD',
            reference: `BP${'A'.repeat(30)}`, status: 'failed',
        });
        await request(app).post(`/api/admin/finance/approvals/${owner._id}/switch`).set(financeHeader(fin)).send({ off: true, reason: 'Fraud check' });
        const r = await payments.retryCheckout(payment.reference);
        expect(r).toMatchObject({ ok: false, status: 409, code: 'payments_off' });
        expect((await Appointment.findById(appt._id)).status).toBe('cancelled');
    });
});

describe('money still open with Bookplus', () => {
    it('a business account can not be deleted, by the business or an admin, until it is settled', async () => {
        const { owner } = await business();
        await apply(owner);
        await payments.writeEntry({ provider: owner._id, type: 'adjustment', amountCents: 12500, currency: 'NAD', key: 'owed' });
        const self = await request(app).delete('/api/auth/account').set(authHeader(owner)).send({ password: 'Password1!' });
        expect(self.status).toBe(409);
        expect(self.body.code).toBe('balance_outstanding');
        expect(self.body.message).toMatch(/owes N\$125\.00/);
        const admin = await makeAdmin();
        const byAdmin = await request(app).delete(`/api/users/${owner._id}`).set(authHeader(admin));
        expect(byAdmin.status).toBe(409);
        // Nothing was removed.
        expect((await User.findById(owner._id).select('+payoutAccount').lean()).payoutAccount.accountNumber).toBe('80041234821');
        // Settled (paid out): now it can go.
        await payments.writeEntry({ provider: owner._id, type: 'payout', amountCents: -12500, currency: 'NAD', key: 'paid' });
        expect((await request(app).delete('/api/auth/account').set(authHeader(owner)).send({ password: 'Password1!' })).status).toBe(200);
    });
});

describe('Download my data', () => {
    it('includes the online payments application and the payout account, without storage references', async () => {
        const { owner } = await business();
        await apply(owner);
        const r = await request(app).get('/api/auth/account/export').set(authHeader(owner));
        expect(r.status).toBe(200);
        const data = JSON.parse(Buffer.isBuffer(r.body) ? r.body.toString('utf8') : r.text);
        const op = data.business.onlinePayments;
        expect(op.application).toMatchObject({ status: 'submitted', plan: 'standard', legal: { ownerIdNumber: '85010100123' } });
        expect(op.application.documents).toHaveLength(3);
        expect(op.payoutAccount.accountNumber).toBe('80041234821');
        expect(JSON.stringify(data)).not.toMatch(/bookplus\/verification|publicId/);
    });
});
