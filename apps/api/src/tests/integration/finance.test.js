/**
 * Bookplus's money controls (payment specification sections 1, 2, 7 and 15):
 * two-step sign-in for admins, finance and director roles, the pricing
 * settings and launch checklist, second-person approval of refunds and
 * adjustments, the append-only audit log, and the fee lines a paid booking
 * writes to the business's ledger.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendStaffBookingAlert: jest.fn().mockResolvedValue(true),
}));

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const User = require('../../models/User');
const Payment = require('../../models/Payment');
const LedgerEntry = require('../../models/LedgerEntry');
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const FinanceRequest = require('../../models/FinanceRequest');
const PlatformSettings = require('../../models/PlatformSettings');
const payments = require('../../services/paymentService');
const mfa = require('../../utils/mfa');
const {
    makeProvider, makeAdmin, makeFinanceAdmin, makeService, authHeader, financeHeader, APPROVED_FOR_PAYMENTS,
} = require('../helpers/factories');
const { refreshCookieOf } = require('../helpers/cookies');
const { futureDate } = require('../helpers/dates');
const { createFakePaygate } = require('../helpers/fakePaygate');

const gw = createFakePaygate();

beforeAll(async () => { gw.install(); await testDb.connect(); });
afterAll(async () => { gw.uninstall(); await testDb.closeDatabase(); });
afterEach(async () => { gw.reset(); await testDb.clearDatabase(); });

// The code an authenticator app would show for this secret, `offset` steps away.
const codeFor = (secret, offset = 0) => mfa.totpAt(mfa.base32Decode(secret), Math.floor(Date.now() / 30000) + offset);

const paidBooking = async (service, { start = '10:00', end = '10:30', name = 'Ana Shilongo' } = {}) => {
    const res = await request(app).post('/api/appointments')
        .send({ service: service._id, appointmentDate: futureDate(0), startTime: start, endTime: end, guestName: name, guestEmail: 'ana@example.com' });
    expect(res.status).toBe(201);
    gw.setStatus(res.body.payment.reference, 1);
    await request(app).post('/api/payments/paygate/notify').type('form').send(gw.notifyBody(res.body.payment.reference));
    return Payment.findOne({ reference: res.body.payment.reference }).lean();
};

const business = async (pricing) => {
    const owner = await makeProvider({ businessProfile: { businessName: 'Vibe Cuts', currency: 'NAD' }, paymentSettings: { mode: 'full' }, paymentsApproval: { ...APPROVED_FOR_PAYMENTS }, ...(pricing ? { pricing } : {}) });
    const service = await makeService(owner._id, { name: 'Taper Fade', price: 200, duration: 30 });
    return { owner, service };
};

const director = () => makeFinanceAdmin({ adminRoles: ['director'] });
const financeOnly = () => makeFinanceAdmin({ adminRoles: ['finance'] });

describe('two-step sign-in for admins', () => {
    it('set up, turn on, then a password alone no longer opens the account', async () => {
        const admin = await makeAdmin({ password: 'Password1!' });
        const setup = await request(app).post('/api/auth/mfa/setup').set(authHeader(admin));
        expect(setup.status).toBe(200);
        expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Bookplus/);
        expect(setup.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
        const { secret } = setup.body.data;

        // Not on until a code proves the app has it.
        expect((await request(app).post('/api/auth/mfa/enable').set(authHeader(admin)).send({ code: '000000' })).status).toBe(400);
        const on = await request(app).post('/api/auth/mfa/enable').set(authHeader(admin)).send({ code: codeFor(secret) });
        expect(on.status).toBe(200);
        expect(on.body.data.recoveryCodes).toHaveLength(8);
        // The session that turned it on is confirmed.
        expect(jwt.decode(on.body.data.token)).toMatchObject({ mfa: true });
        expect((await request(app).get('/api/admin/finance/settings').set({ Authorization: `Bearer ${on.body.data.token}` })).status).toBe(200);

        // Nothing secret reaches the apps.
        const stored = await User.findById(admin._id).select('+mfa.secretEnc +mfa.recoveryHashes').lean();
        expect(stored.mfa.secretEnc).not.toContain(secret);
        expect(stored.mfa.recoveryHashes).not.toContain(on.body.data.recoveryCodes[0]);
        const profile = await request(app).get('/api/auth/profile').set(authHeader(admin));
        expect(JSON.stringify(profile.body)).not.toMatch(/secretEnc|recoveryHashes|lastStep/);

        // Password sign-in now stops at the code step: no token, no cookie.
        const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Password1!', accountType: 'business' });
        expect(login.status).toBe(200);
        expect(login.body.data).toMatchObject({ mfaRequired: true });
        expect(login.body.data.token).toBeUndefined();
        expect(refreshCookieOf(login)).toBeFalsy();
        // The ticket is not a session token.
        expect((await request(app).get('/api/auth/profile').set({ Authorization: `Bearer ${login.body.data.mfaToken}` })).status).toBe(401);

        const wrong = await request(app).post('/api/auth/mfa/login').send({ mfaToken: login.body.data.mfaToken, code: '123456' });
        expect(wrong.status).toBe(401);
        // The code already used to turn it on can't be used again.
        const replay = await request(app).post('/api/auth/mfa/login').send({ mfaToken: login.body.data.mfaToken, code: codeFor(secret) });
        expect(replay.status).toBe(401);
        const ok = await request(app).post('/api/auth/mfa/login').send({ mfaToken: login.body.data.mfaToken, code: codeFor(secret, 1) });
        expect(ok.status).toBe(200);
        expect(ok.body.data.user.role).toBe('admin');
        expect(jwt.decode(ok.body.data.token)).toMatchObject({ mfa: true });
        const cookie = refreshCookieOf(ok);
        expect(cookie).toBeTruthy();

        // A renewed session stays confirmed.
        const renewed = await request(app).post('/api/auth/refresh').set('Cookie', `bp_rt_b=${cookie}`).send({ accountType: 'business' });
        expect(renewed.status).toBe(200);
        expect(jwt.decode(renewed.body.data.token)).toMatchObject({ mfa: true });
    });

    it('recovery codes work once; five wrong codes pause it; Google and the switcher can not skip it', async () => {
        const admin = await makeAdmin({ password: 'Password1!' });
        const { body: { data: { secret } } } = await request(app).post('/api/auth/mfa/setup').set(authHeader(admin));
        const on = await request(app).post('/api/auth/mfa/enable').set(authHeader(admin)).send({ code: codeFor(secret) });
        const [recovery] = on.body.data.recoveryCodes;

        const ticket = async () => (await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Password1!', accountType: 'business' })).body.data.mfaToken;
        const viaRecovery = await request(app).post('/api/auth/mfa/login').send({ mfaToken: await ticket(), code: recovery.toLowerCase() });
        expect(viaRecovery.status).toBe(200);
        expect(viaRecovery.body.data).toMatchObject({ usedRecoveryCode: true, recoveryCodesLeft: 7 });
        expect((await request(app).post('/api/auth/mfa/login').send({ mfaToken: await ticket(), code: recovery })).status).toBe(401);

        const t = await ticket();
        for (let i = 0; i < 4; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await request(app).post('/api/auth/mfa/login').send({ mfaToken: t, code: '000000' });
        }
        const locked = await request(app).post('/api/auth/mfa/login').send({ mfaToken: t, code: codeFor(secret, 1) });
        expect(locked.status).toBe(429);
        expect(locked.body.code).toBe('mfa_locked');

        // A one-time sign-in code (Google / account switcher) is refused.
        const code = crypto.randomBytes(32).toString('hex');
        await User.updateOne({ _id: admin._id }, { $set: { oauthCode: crypto.createHash('sha256').update(code).digest('hex'), oauthCodeExpiry: new Date(Date.now() + 60000) } });
        const ex = await request(app).post('/api/auth/exchange-code').send({ code });
        expect(ex.status).toBe(403);
        expect(ex.body.code).toBe('mfa_password_login');
    });

    it('a session over 12 hours old confirms with a code again', async () => {
        const admin = await makeAdmin();
        const { body: { data: { secret } } } = await request(app).post('/api/auth/mfa/setup').set(authHeader(admin));
        await request(app).post('/api/auth/mfa/enable').set(authHeader(admin)).send({ code: codeFor(secret) });
        const fresh = await User.findById(admin._id);
        const old = financeHeader(fresh, Math.floor(Date.now() / 1000) - 13 * 3600);
        const status = await request(app).get('/api/auth/mfa').set(old);
        expect(status.body.data).toMatchObject({ enabled: true, sessionConfirmed: false, recoveryCodesLeft: 8 });
        expect((await request(app).get('/api/admin/finance/settings').set(old)).body.code).toBe('mfa_required');
        const confirm = await request(app).post('/api/auth/mfa/confirm').set(old).send({ code: codeFor(secret, 1) });
        expect(confirm.status).toBe(200);
        expect((await request(app).get('/api/admin/finance/settings').set({ Authorization: `Bearer ${confirm.body.data.token}` })).status).toBe(200);
    });

    it('only admins; business accounts never reach it', async () => {
        const { owner } = await business();
        expect((await request(app).post('/api/auth/mfa/setup').set(authHeader(owner))).status).toBe(403);
        expect((await request(app).get('/api/admin/finance/settings').set(financeHeader(owner))).status).toBe(403);
    });
});

describe('pricing settings and the launch checklist', () => {
    it('starts with the specification\'s plans; finance reads, only a director changes, always with a reason', async () => {
        const fin = await financeOnly();
        const dir = await director();
        const r = await request(app).get('/api/admin/finance/settings').set(financeHeader(fin));
        expect(r.status).toBe(200);
        expect(r.body.data.settings.plans.basic).toMatchObject({ trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999, commissionBps: 150, fixedFeeCents: 0 });
        expect(r.body.data.settings.plans.standard).toMatchObject({ priceCents: 0, commissionBps: 300, fixedFeeCents: 150 });
        // Nothing is ready until PayGate's real fees and every approval are in.
        expect(r.body.data.launch.ready).toBe(false);
        expect(r.body.data.simulator.processingFeeKnown).toBe(false);

        const change = { changes: { processingFee: { bps: 350, fixedCents: 200 } }, reason: 'PayGate quote of 1 Oct' };
        const byFinance = await request(app).put('/api/admin/finance/settings').set(financeHeader(fin)).send(change);
        expect(byFinance.status).toBe(403);
        expect(byFinance.body.code).toBe('finance_role_required');
        expect((await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: change.changes })).body.code).toBe('reason_required');
        expect((await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: { launch: { legalCleared: true } }, reason: 'x' })).body.code).toBe('unknown_setting');
        expect((await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: { plans: { basic: { commissionBps: -5 } } }, reason: 'x' })).body.code).toBe('bad_value');

        const ok = await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send(change);
        expect(ok.status).toBe(200);
        expect(ok.body.data.settings.processingFee).toMatchObject({ bps: 350, fixedCents: 200 });
        expect(ok.body.data.simulator.processingFeeKnown).toBe(true);
        const entry = await FinancialAuditLog.findOne({ action: 'settings.update' }).lean();
        expect(entry).toMatchObject({ actorRole: 'director', reason: 'PayGate quote of 1 Oct' });
        expect(entry.details.changes).toEqual(expect.arrayContaining([{ path: 'processingFee.bps', from: null, to: 350 }]));

        // A launch item needs a note saying what confirmed it.
        expect((await request(app).post('/api/admin/finance/launch/providerApproved').set(financeHeader(dir)).send({})).body.code).toBe('note_required');
        const gate = await request(app).post('/api/admin/finance/launch/providerApproved').set(financeHeader(dir)).send({ note: 'PayGate email, 2 Nov' });
        expect(gate.body.data.launch.items.find((i) => i.key === 'providerApproved')).toMatchObject({ done: true, note: 'PayGate email, 2 Nov' });
    });

    it('a business keeps the rates it agreed until it is moved on purpose', async () => {
        const dir = await director();
        const { owner } = await business();
        const set = await request(app).put(`/api/admin/finance/businesses/${owner._id}/pricing`).set(financeHeader(dir)).send({ plan: 'standard', reason: 'Chose Standard' });
        expect(set.status).toBe(200);
        expect(set.body.data.rates).toMatchObject({ plan: 'standard', commissionBps: 300, fixedFeeCents: 150 });

        await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: { plans: { standard: { commissionBps: 350 } } }, reason: 'New price list' });
        const kept = await request(app).put(`/api/admin/finance/businesses/${owner._id}/pricing`).set(financeHeader(dir)).send({ override: { fixedFeeCents: 100 }, reason: 'Launch partner' });
        expect(kept.body.data.rates).toMatchObject({ commissionBps: 300, fixedFeeCents: 100 });
        const moved = await request(app).put(`/api/admin/finance/businesses/${owner._id}/pricing`).set(financeHeader(dir)).send({ migrate: true, override: null, reason: 'Notice period over' });
        expect(moved.body.data.rates).toMatchObject({ commissionBps: 350, fixedFeeCents: 150 });
        expect(await FinancialAuditLog.countDocuments({ action: 'business.pricing', provider: owner._id })).toBe(3);
    });
});

describe('fees on a paid booking', () => {
    it('Standard plan: commission, fixed fee and processing fee lines; refunds return commission, the fixed fee only in full, never the processing fee', async () => {
        const dir = await director();
        await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: { processingFee: { bps: 300 } }, reason: 'test' });
        const { owner, service } = await business({ plan: 'standard', rates: { commissionBps: 300, fixedFeeCents: 150 } });
        const payment = await paidBooking(service);
        expect(payment.fees).toMatchObject({ plan: 'standard', commissionCents: 750, fixedFeeCents: 150, processingFeeCents: 600, businessShareCents: 18650 });

        const lines = async () => (await LedgerEntry.find({ provider: owner._id }).sort({ _id: 1 }).lean()).map((e) => [e.type, e.amountCents]);
        expect(await lines()).toEqual([['payment', 20000], ['commission', -600], ['fixed_fee', -150], ['processing_fee', -600]]);
        expect(await payments.balanceOf(owner._id)).toBe(18650);

        // Half back: half the commission returns; the fixed fee stays.
        const half = await request(app).post(`/api/admin/finance/payments/${payment._id}/refund`).set(financeHeader(dir)).send({ amountCents: 10000, reason: 'Half the service' });
        expect(half.status).toBe(200);
        // The rest: the other half of the commission and now the fixed fee.
        await request(app).post(`/api/admin/finance/payments/${payment._id}/refund`).set(financeHeader(dir)).send({ reason: 'Not provided' });
        expect((await lines()).slice(4)).toEqual([['refund', -10000], ['commission', 300], ['refund', -10000], ['commission', 300], ['fixed_fee', 150]]);
        // The card company keeps its fee, so a fully refunded booking costs the business exactly that.
        expect(await payments.balanceOf(owner._id)).toBe(-600);
    });

    it('a business with no plan yet is unchanged; below the minimum online value, no online payment is asked', async () => {
        const { owner, service } = await business();
        const payment = await paidBooking(service);
        expect(payment.fees).toMatchObject({ plan: null, commissionCents: 0 });
        expect(await payments.balanceOf(owner._id)).toBe(20000);

        await PlatformSettings.updateOne({ key: 'platform' }, { $set: { minOnlineBookingCents: 30000 } });
        expect(await payments.planForBooking(owner._id, 200)).toBeNull();
        expect(await payments.planForBooking(owner._id, 300)).toMatchObject({ amountCents: 30000 });
    });

    it('an owner can refund only up to what Bookplus holds for them', async () => {
        const { owner, service } = await business({ plan: 'standard', rates: { commissionBps: 300, fixedFeeCents: 150 } });
        const payment = await paidBooking(service);
        const tooMuch = await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(owner)).send({});
        expect(tooMuch.status).toBe(409);
        expect(tooMuch.body.code).toBe('balance_too_low');
        const ok = await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(owner)).send({ amountCents: 5000, reason: 'Started late' });
        expect(ok.status).toBe(200);
        expect(await FinancialAuditLog.findOne({ action: 'refund.owner' }).lean()).toMatchObject({ actorRole: 'provider', amountCents: 5000, reason: 'Started late' });
    });
});

describe('second-person approval', () => {
    it('a refund above the limit waits for a director who did not prepare it', async () => {
        const fin = await financeOnly();
        const dir = await director();
        const { service } = await business();
        await PlatformSettings.updateOne({ key: 'platform' }, { $set: { 'approvals.refundThresholdCents': 5000 } }, { upsert: true });
        const payment = await paidBooking(service);

        const prep = await request(app).post(`/api/admin/finance/payments/${payment._id}/refund`).set(financeHeader(fin)).send({ amountCents: 15000, reason: 'Wrong service booked' });
        expect(prep.status).toBe(202);
        expect(prep.body.code).toBe('approval_required');
        expect((await Payment.findById(payment._id)).refundedCents).toBe(0);
        const id = prep.body.data._id;

        // Finance can't approve; the preparer can't approve their own.
        expect((await request(app).post(`/api/admin/finance/requests/${id}/approve`).set(financeHeader(fin))).body.code).toBe('finance_role_required');
        const fin2 = await makeFinanceAdmin({ adminRoles: ['director'] });
        const own = await request(app).post(`/api/admin/finance/payments/${payment._id}/refund`).set(financeHeader(fin2)).send({ amountCents: 4999 * 2, reason: 'x' });
        expect((await request(app).post(`/api/admin/finance/requests/${own.body.data._id}/approve`).set(financeHeader(fin2))).body.code).toBe('same_person');

        const approved = await request(app).post(`/api/admin/finance/requests/${id}/approve`).set(financeHeader(dir)).send({ note: 'Checked the booking' });
        expect(approved.status).toBe(200);
        expect(approved.body.data.status).toBe('executed');
        expect((await Payment.findById(payment._id)).refundedCents).toBe(15000);
        // Decided once only.
        expect((await request(app).post(`/api/admin/finance/requests/${id}/approve`).set(financeHeader(dir))).body.code).toBe('already_decided');
        const actions = (await FinancialAuditLog.find({ request: id }).sort({ _id: 1 }).lean()).map((e) => e.action);
        expect(actions).toEqual(['refund.request', 'refund.approve', 'refund.execute']);
    });

    it('adjustments always need approval; a rejection needs a reason and writes nothing', async () => {
        const fin = await financeOnly();
        const dir = await director();
        const { owner } = await business();
        const prep = await request(app).post('/api/admin/finance/adjustments').set(financeHeader(fin)).send({ providerId: String(owner._id), amountCents: 2500, reason: 'Goodwill credit' });
        expect(prep.status).toBe(202);
        expect(await LedgerEntry.countDocuments({ type: 'adjustment' })).toBe(0);
        expect((await request(app).post(`/api/admin/finance/requests/${prep.body.data._id}/reject`).set(financeHeader(dir)).send({})).body.code).toBe('reason_required');
        const rej = await request(app).post(`/api/admin/finance/requests/${prep.body.data._id}/reject`).set(financeHeader(dir)).send({ note: 'Not agreed' });
        expect(rej.body.data.status).toBe('rejected');
        expect(await LedgerEntry.countDocuments({ type: 'adjustment' })).toBe(0);

        const again = await request(app).post('/api/admin/finance/adjustments').set(financeHeader(fin)).send({ providerId: String(owner._id), amountCents: -1000, reason: 'Duplicate payout correction' });
        await request(app).post(`/api/admin/finance/requests/${again.body.data._id}/approve`).set(financeHeader(dir));
        expect(await payments.balanceOf(owner._id)).toBe(-1000);
        const pending = await request(app).get('/api/admin/finance/requests?status=executed').set(financeHeader(fin));
        expect(pending.body.data).toHaveLength(1);
    });
});

describe('audit log and roles', () => {
    it('entries can not be changed or deleted', async () => {
        const dir = await director();
        await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: { minCommissionCents: 100 }, reason: 'Floor' });
        const entry = await FinancialAuditLog.findOne();
        await expect(FinancialAuditLog.updateOne({ _id: entry._id }, { $set: { reason: 'edited' } })).rejects.toThrow(/append-only/);
        await expect(FinancialAuditLog.deleteOne({ _id: entry._id })).rejects.toThrow(/append-only/);
        entry.reason = 'edited';
        await expect(entry.save()).rejects.toThrow(/append-only/);
        const list = await request(app).get('/api/admin/finance/audit').set(financeHeader(dir));
        expect(list.body.data[0]).toMatchObject({ action: 'settings.update', reason: 'Floor' });
    });

    it('directors set roles (never demoting themselves) and reset another admin\'s two-step sign-in', async () => {
        const dir = await director();
        const other = await makeFinanceAdmin();
        expect((await request(app).put(`/api/admin/finance/admins/${dir._id}/roles`).set(financeHeader(dir)).send({ roles: ['finance'] })).body.code).toBe('self_demotion');
        const set = await request(app).put(`/api/admin/finance/admins/${other._id}/roles`).set(financeHeader(dir)).send({ roles: ['finance'] });
        expect(set.body.data.roles).toEqual(['finance']);
        const list = await request(app).get('/api/admin/finance/admins').set(financeHeader(dir));
        expect(list.body.data.find((a) => String(a._id) === String(other._id))).toMatchObject({ roles: ['finance'], mfaEnabled: true });

        expect((await request(app).post(`/api/admin/finance/admins/${dir._id}/reset-mfa`).set(financeHeader(dir)).send({ reason: 'x' })).body.code).toBe('same_person');
        const reset = await request(app).post(`/api/admin/finance/admins/${other._id}/reset-mfa`).set(financeHeader(dir)).send({ reason: 'Lost phone' });
        expect(reset.status).toBe(200);
        const after = await User.findById(other._id).lean();
        expect(after.mfa).toBeUndefined();
        expect(after.tokenVersion).toBe((other.tokenVersion || 0) + 1);
        expect(await FinancialAuditLog.countDocuments({ action: 'security.mfa_reset' })).toBe(1);
    });
});

describe('server reset script', () => {
    it('turns two-step sign-in off for one admin and records it', async () => {
        const { resetAdminMfa } = require('../../../scripts/reset_admin_mfa');
        const admin = await makeFinanceAdmin({ email: 'Only.Admin@bookplus.pro' });
        expect((await resetAdminMfa('nobody@bookplus.pro', 'x')).ok).toBe(false);
        expect((await resetAdminMfa(' only.admin@bookplus.pro ', 'Lost phone')).ok).toBe(true);
        const after = await User.findById(admin._id).lean();
        expect(after.mfa).toBeUndefined();
        expect(await FinancialAuditLog.findOne({ action: 'security.mfa_reset' }).lean()).toMatchObject({ actorRole: 'system', reason: 'Server script: Lost phone' });
    });
});
