/**
 * Bookplus's money controls: two-step sign-in for admins, finance and director
 * roles, the plan's price settings and the launch checklist, and the
 * append-only audit log. (Bookplus takes card payments only for business
 * subscriptions; no booking payments, no commission.)
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
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const mfa = require('../../utils/mfa');
const {
    makeProvider, makeAdmin, makeFinanceAdmin, authHeader, financeHeader,
} = require('../helpers/factories');
const { refreshCookieOf } = require('../helpers/cookies');

beforeAll(async () => { await testDb.connect(); });
afterAll(async () => { await testDb.closeDatabase(); });
afterEach(async () => { await testDb.clearDatabase(); });

// The code an authenticator app would show for this secret, `offset` steps away.
const codeFor = (secret, offset = 0) => mfa.totpAt(mfa.base32Decode(secret), Math.floor(Date.now() / 30000) + offset);

const director = () => makeFinanceAdmin({ adminRoles: ['director'] });
const financeOnly = () => makeFinanceAdmin({ adminRoles: ['finance'] });

describe('two-step sign-in for admins', () => {
    it('set up, turn on, then a password alone no longer opens the account', async () => {
        const admin = await makeAdmin({ password: 'Password1!' }, { twoStep: false });
        const setup = await request(app).post('/api/auth/mfa/setup').set(authHeader(admin));
        expect(setup.status).toBe(200);
        expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Bookplus/);
        expect(setup.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
        const { secret } = setup.body.data;

        // Not on until a code proves the app has it.
        expect((await request(app).post('/api/auth/mfa/enable').set(authHeader(admin)).send({ code: '000000' })).status).toBe(400);
        // Kept as sent: recomputing it later can land in the next 30-second step.
        const enableCode = codeFor(secret);
        const on = await request(app).post('/api/auth/mfa/enable').set(authHeader(admin)).send({ code: enableCode });
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
        const replay = await request(app).post('/api/auth/mfa/login').send({ mfaToken: login.body.data.mfaToken, code: enableCode });
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
        const admin = await makeAdmin({ password: 'Password1!' }, { twoStep: false });
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
        const admin = await makeAdmin({}, { twoStep: false });
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
        const owner = await makeProvider();
        expect((await request(app).post('/api/auth/mfa/setup').set(authHeader(owner))).status).toBe(403);
        expect((await request(app).get('/api/admin/finance/settings').set(financeHeader(owner))).status).toBe(403);
    });
});

describe('plan price settings and the launch checklist', () => {
    it('starts with the specification\'s plan; finance reads, only a director changes, always with a reason', async () => {
        const fin = await financeOnly();
        const dir = await director();
        const r = await request(app).get('/api/admin/finance/settings').set(financeHeader(fin));
        expect(r.status).toBe(200);
        expect(r.body.data.settings.plans.basic).toMatchObject({ trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999, priceChangeNoticeDays: 14 });
        // No commission, no booking payments.
        expect(r.body.data.settings.plans.basic.commissionBps).toBeUndefined();
        expect(r.body.data.settings.plans.standard).toBeUndefined();
        expect(r.body.data.simulator).toBeUndefined();
        expect(r.body.data.launch.ready).toBe(false);
        expect(r.body.data.launch.items.map((i) => i.key)).toEqual(['providerApproved', 'pricingApproved', 'legalCleared', 'termsReviewed', 'liveTestPassed']);

        const change = { changes: { plans: { basic: { priceCents: 15999 } } }, reason: 'New price list' };
        const byFinance = await request(app).put('/api/admin/finance/settings').set(financeHeader(fin)).send(change);
        expect(byFinance.status).toBe(403);
        expect(byFinance.body.code).toBe('finance_role_required');
        expect((await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: change.changes })).body.code).toBe('reason_required');
        expect((await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: { launch: { legalCleared: true } }, reason: 'x' })).body.code).toBe('unknown_setting');
        // Commission settings are gone.
        expect((await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: { plans: { basic: { commissionBps: 150 } } }, reason: 'x' })).body.code).toBe('unknown_setting');
        expect((await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: { plans: { basic: { priceCents: -5 } } }, reason: 'x' })).body.code).toBe('bad_value');

        const ok = await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send(change);
        expect(ok.status).toBe(200);
        expect(ok.body.data.settings.plans.basic.priceCents).toBe(15999);
        const entry = await FinancialAuditLog.findOne({ action: 'settings.update' }).lean();
        expect(entry).toMatchObject({ actorRole: 'director', reason: 'New price list' });
        expect(entry.details.changes).toEqual([{ path: 'plans.basic.priceCents', from: 14999, to: 15999 }]);

        // A launch item needs a note saying what confirmed it.
        expect((await request(app).post('/api/admin/finance/launch/providerApproved').set(financeHeader(dir)).send({})).body.code).toBe('note_required');
        const gate = await request(app).post('/api/admin/finance/launch/providerApproved').set(financeHeader(dir)).send({ note: 'PayGate email, 2 Nov' });
        expect(gate.body.data.launch.items.find((i) => i.key === 'providerApproved')).toMatchObject({ done: true, note: 'PayGate email, 2 Nov' });
        expect((await request(app).post('/api/admin/finance/launch/payoutScheduleConfirmed').set(financeHeader(dir)).send({ note: 'x' })).status).toBe(404);
    });

    it('the booking-payment and commission routes are gone', async () => {
        const dir = await director();
        for (const [method, url] of [
            ['get', '/api/admin/finance/simulate'], ['get', '/api/admin/finance/payments'], ['get', '/api/admin/finance/payouts'],
            ['get', '/api/admin/finance/approvals'], ['get', '/api/admin/finance/disputes'], ['get', '/api/admin/finance/dashboard'],
            ['get', '/api/admin/finance/requests'], ['get', '/api/payments/policy/0123456789abcdef01234567'],
        ]) {
            expect((await request(app)[method](url).set(financeHeader(dir))).status).toBe(404);
        }
    });
});

describe('audit log and roles', () => {
    it('entries can not be changed or deleted', async () => {
        const dir = await director();
        await request(app).put('/api/admin/finance/settings').set(financeHeader(dir)).send({ changes: { plans: { basic: { trialDays: 14 } } }, reason: 'Floor' });
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
    it('shuts out an admin nobody recognises, by id: suspended, signed out, listed as such, recorded', async () => {
        const { lockAdmin, listAdmins } = require('../../../scripts/reset_admin_mfa');
        const stranger = await makeFinanceAdmin({ email: 'stranger@bookplus.pro' });
        const main = await makeFinanceAdmin({ email: 'main@bookplus.pro' });
        const before = await User.findById(stranger._id).lean();
        const owner = process.env.ADMIN_EMAIL;
        process.env.ADMIN_EMAIL = 'Main@bookplus.pro ';
        try {
            expect((await lockAdmin(String(main._id), 'x')).ok).toBe(false); // never the main admin
            expect((await lockAdmin('stranger@bookplus.pro', 'x')).ok).toBe(false); // ids only, never an email
            expect((await lockAdmin('0123456789abcdef01234567', 'x')).ok).toBe(false);
            const r = await lockAdmin(String(stranger._id), 'Unknown admin');
            expect(r).toMatchObject({ ok: true });
            expect(r.message).toBe(`Admin ${stranger._id} is suspended and signed out.`);
        } finally { process.env.ADMIN_EMAIL = owner; }
        const after = await User.findById(stranger._id).select('+refreshTokenJtis').lean();
        expect(after).toMatchObject({ role: 'admin', isActive: false, deactivatedAt: null, refreshTokenJtis: [] });
        expect(after.tokenVersion).toBe((before.tokenVersion || 0) + 1);
        expect((await listAdmins()).find((a) => a.email === 'stranger@bookplus.pro')).toMatchObject({ id: String(stranger._id), suspended: true });
        expect(await FinancialAuditLog.findOne({ action: 'security.admin_locked' }).lean()).toMatchObject({ actorRole: 'system', reference: 'stranger@bookplus.pro', reason: 'Server script: Unknown admin' });
        // Its old session no longer works.
        expect((await request(app).get('/api/auth/profile').set(authHeader(stranger))).status).toBe(403);
    });

    it('lists every admin and whether two-step is on', async () => {
        const { listAdmins } = require('../../../scripts/reset_admin_mfa');
        await makeFinanceAdmin({ email: 'b.admin@bookplus.pro' });
        const off = await makeFinanceAdmin({ email: 'a.admin@bookplus.pro' });
        await User.updateOne({ _id: off._id }, { $unset: { mfa: '' } });
        const listed = (await listAdmins()).filter((a) => /^[ab]\.admin@/.test(a.email));
        expect(listed).toEqual([
            { id: String(off._id), email: 'a.admin@bookplus.pro', twoStep: false, suspended: false },
            { id: expect.stringMatching(/^[0-9a-f]{24}$/), email: 'b.admin@bookplus.pro', twoStep: true, suspended: false },
        ]);
    });
});
