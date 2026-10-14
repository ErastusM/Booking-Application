/**
 * The open items from the payment-readiness audit:
 *   - refresh tokens live only in per-side httpOnly cookies (never in a body);
 *   - one-time sign-in codes only work in the browser that asked for them;
 *   - per-account back-off after repeated wrong passwords;
 *   - guests can't book repeat series or hold more than a few upcoming bookings;
 *   - paying online needs a confirmed email;
 *   - unknown API addresses answer 404 (not a 500 that pages the alert hook).
 */
const crypto = require('crypto');
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const User = require('../../models/User');
const { makeUser, makeProvider, makeService, authHeader, APPROVED_FOR_PAYMENTS } = require('../helpers/factories');
const { futureDate } = require('../helpers/dates');
const { refreshCookieOf } = require('../helpers/cookies');
const { createFakePaygate } = require('../helpers/fakePaygate');

const gw = createFakePaygate();
beforeAll(async () => { gw.install(); await testDb.connect(); });
afterAll(async () => { gw.uninstall(); await testDb.closeDatabase(); });
afterEach(async () => { gw.reset(); await testDb.clearDatabase(); });

const PASSWORD = 'Password1!';
const cookieHeader = (res, name) => {
    const c = (res.headers['set-cookie'] || []).find((v) => v.startsWith(`${name}=`));
    return c ? c.split(';')[0] : null;
};
const login = (email, password = PASSWORD, accountType) => request(app)
    .post('/api/auth/login').send({ email, password, ...(accountType ? { accountType } : {}) });

describe('refresh tokens: one httpOnly cookie per side, never in a body', () => {
    it('keeps a customer session and a business session in the same browser apart', async () => {
        const customer = await makeUser({ email: 'twin@example.com' });
        const business = await makeProvider({ email: 'owner@example.com' });
        const c = await login(customer.email, PASSWORD, 'customer');
        const b = await login(business.email, PASSWORD, 'business');
        expect(c.body.data.refreshToken).toBeUndefined();
        const jar = [cookieHeader(c, 'bp_rt_c'), cookieHeader(b, 'bp_rt_b')].join('; ');

        const asBusiness = await request(app).post('/api/auth/refresh').set('Cookie', jar).send({ accountType: 'business' });
        expect(asBusiness.status).toBe(200);
        expect(cookieHeader(asBusiness, 'bp_rt_b')).toBeTruthy();
        const asCustomer = await request(app).post('/api/auth/refresh').set('Cookie', jar).send({ accountType: 'customer' });
        expect(asCustomer.status).toBe(200);
        expect(cookieHeader(asCustomer, 'bp_rt_c')).toBeTruthy();
    });

    it('prefers a good cookie over a stale token an older app version kept in storage', async () => {
        const user = await makeUser();
        const first = await login(user.email);
        const stale = refreshCookieOf(first);
        await request(app).post('/api/auth/logout').set(authHeader(user)); // revokes every earlier token
        const fresh = await login(user.email);
        const res = await request(app).post('/api/auth/refresh')
            .set('Cookie', cookieHeader(fresh, 'bp_rt_c'))
            .send({ accountType: 'customer', refreshToken: stale });
        expect(res.status).toBe(200);
    });

    it('still accepts the old shared bp_rt cookie, for the right side only', async () => {
        const user = await makeUser();
        const res = await login(user.email);
        const legacy = `bp_rt=${encodeURIComponent(refreshCookieOf(res))}`;
        expect((await request(app).post('/api/auth/refresh').set('Cookie', legacy).send({ accountType: 'customer' })).status).toBe(200);
        expect((await request(app).post('/api/auth/refresh').set('Cookie', legacy).send({ accountType: 'business' })).status).toBe(403);
    });

    it('logout signs out only that side', async () => {
        const user = await makeUser();
        const res = await request(app).post('/api/auth/logout').set(authHeader(user));
        const set = (res.headers['set-cookie'] || []).join('\n');
        expect(set).toMatch(/bp_rt_c=; Max-Age=0/);
        expect(set).not.toMatch(/bp_rt_b=/);
    });
});

describe('one-time sign-in codes are bound to the asking browser', () => {
    const mint = async (user) => {
        const code = crypto.randomBytes(32).toString('hex');
        const nonce = crypto.randomBytes(24).toString('hex');
        await User.updateOne({ _id: user._id }, {
            $set: {
                oauthCode: crypto.createHash('sha256').update(code).digest('hex'),
                oauthCodeExpiry: new Date(Date.now() + 10 * 60 * 1000),
                oauthCodeBinding: crypto.createHash('sha256').update(nonce).digest('hex'),
            },
        });
        return { code, nonce };
    };

    it('refuses the code from another browser and accepts it from the right one', async () => {
        const user = await makeUser();
        const { code, nonce } = await mint(user);
        const elsewhere = await request(app).post('/api/auth/exchange-code').send({ code });
        expect(elsewhere.status).toBe(400);
        expect(elsewhere.body.code).toBe('handoff_other_browser');
        const here = await request(app).post('/api/auth/exchange-code').set('Cookie', `bp_ho=${nonce}`).send({ code });
        expect(here.status).toBe(200);
        expect(here.body.data.token).toBeTruthy();
    });

    it('the account switcher sets the binding cookie, and the other app accepts the code with it', async () => {
        const customer = await makeUser({ email: 'both@example.com' });
        const provider = await makeProvider({ email: 'both@example.com' });
        // The same person's twin accounts share the byte-identical hash.
        const { password: hash } = await User.findById(customer._id).select('+password');
        await User.updateOne({ _id: provider._id }, { $set: { password: hash } });

        const res = await request(app).post('/api/auth/switch-side').set(authHeader(customer)).send({});
        expect(res.status).toBe(200);
        const binding = cookieHeader(res, 'bp_ho');
        expect(binding).toBeTruthy();
        const shared = await request(app).post('/api/auth/exchange-code').send({ code: res.body.data.handoffCode });
        expect(shared.status).toBe(400);
        const mine = await request(app).post('/api/auth/exchange-code').set('Cookie', binding).send({ code: res.body.data.handoffCode });
        expect(mine.status).toBe(200);
        expect(mine.body.data.user.role).toBe('provider');
    });
});

describe('per-account back-off after wrong passwords', () => {
    it('pauses the account after 5 misses, even for the right password, and a past pause resets on success', async () => {
        const user = await makeUser();
        for (let i = 0; i < 5; i++) expect((await login(user.email, 'Wrong1!pass')).status).toBe(401);
        const locked = await login(user.email);
        expect(locked.status).toBe(429);
        expect(locked.body.code).toBe('login_locked');
        expect(locked.body.message).toMatch(/wait 1 minute/);

        await User.updateOne({ _id: user._id }, { $set: { loginLockedUntil: new Date(Date.now() - 1000) } });
        expect((await login(user.email)).status).toBe(200);
        const after = await User.findById(user._id).select('+loginFailures +loginLockedUntil');
        expect(after.loginFailures).toBe(0);
        expect(after.loginLockedUntil).toBeNull();
    });

    it('never reveals the counters to the apps', async () => {
        const user = await makeUser();
        await login(user.email, 'Wrong1!pass');
        const me = await request(app).get('/api/auth/me').set(authHeader(user));
        expect(JSON.stringify(me.body)).not.toMatch(/loginFailures|loginLockedUntil|oauthCodeBinding/);
    });
});

describe('guests', () => {
    const setup = async () => {
        const provider = await makeProvider({ businessProfile: { businessName: 'Vibe Cuts', currency: 'NAD' } });
        const service = await makeService(provider._id, { price: 100, duration: 30 });
        return { provider, service };
    };
    const book = (service, extra = {}) => request(app).post('/api/appointments').send({
        service: service._id, appointmentDate: futureDate(0), startTime: '09:00', endTime: '09:30',
        guestName: 'Ana Shilongo', guestEmail: 'ana@example.com', ...extra,
    });

    it('cannot book a repeat series', async () => {
        const { service } = await setup();
        const res = await book(service, { isRecurring: true, recurrenceType: 'weekly', recurrenceInterval: 1 });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('guest_recurring_unsupported');
    });

    it('can hold at most 3 upcoming bookings per business with one email', async () => {
        const { service } = await setup();
        for (const t of ['09:00', '10:00', '11:00']) {
            expect((await book(service, { startTime: t, endTime: `${t.slice(0, 2)}:30` })).status).toBe(201);
        }
        const fourth = await book(service, { startTime: '12:00', endTime: '12:30', guestEmail: 'ANA@example.com' });
        expect(fourth.status).toBe(429);
        expect(fourth.body.code).toBe('guest_booking_limit');
    });
});

describe('paying online needs a confirmed email', () => {
    it('refuses a payment-required booking from an unconfirmed account', async () => {
        const provider = await makeProvider({
            businessProfile: { businessName: 'Vibe Cuts', currency: 'NAD' },
            paymentSettings: { mode: 'full' },
            paymentsApproval: { ...APPROVED_FOR_PAYMENTS },
        });
        const service = await makeService(provider._id, { price: 200, duration: 30 });
        const customer = await makeUser({ isVerified: false });
        const res = await request(app).post('/api/appointments').set(authHeader(customer)).send({
            service: service._id, appointmentDate: futureDate(0), startTime: '10:00', endTime: '10:30',
        });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('email_unverified');

        const confirmed = await makeUser({ email: 'ok@example.com' });
        const ok = await request(app).post('/api/appointments').set(authHeader(confirmed)).send({
            service: service._id, appointmentDate: futureDate(0), startTime: '11:00', endTime: '11:30',
        });
        expect(ok.status).toBe(201);
        expect(ok.body.code).toBe('payment_required');
    });
});

describe('unknown API addresses', () => {
    it('answer 404 without echoing the query string', async () => {
        const res = await request(app).get('/api/no-such-thing?token=secret-value');
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toMatch(/secret-value/);
    });
});
