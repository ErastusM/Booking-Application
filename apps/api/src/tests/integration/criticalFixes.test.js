/**
 * Regression cover for the 6 CRITICAL findings from the adversarial QA audit.
 *   #1/#14 createAppointment trusted the client's booking window (shrink / inverted)
 *   #2     createAppointment never checked the provider owned the service
 *   #3/#5  add-on prices were trusted from the body (free wallet bookings, poisoned revenue)
 *   #4     Google SSO linked to an existing account by email alone (pre-hijack)
 * The #6 client half (stale endTime in the customer app) is covered by the server
 * window check below plus the UI reset in BookAppointment.jsx.
 */
const request = require('supertest');
const passport = require('passport');
const app = require('../../../server');
require('../../config/passport'); // register the Google strategy
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const BlockedTime = require('../../models/BlockedTime');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const soon = () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const book = (customer, body) =>
    request(app).post('/api/appointments').set(authHeader(customer))
        .send({ appointmentDate: soon(), startTime: '10:00', ...body });

describe('#1/#14 — booking window must match the service length', () => {
    it('rejects a window shorter than the service (shrink → invisible double-book)', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 120 });
        const res = await book(customer, { service: svc._id.toString(), startTime: '10:00', endTime: '10:15' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/service length|match/i);
    });

    it('rejects an inverted window (end before start)', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const res = await book(customer, { service: svc._id.toString(), startTime: '14:00', endTime: '09:00' });
        expect(res.status).toBe(400);
    });

    it('accepts a window that matches the service duration', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const res = await book(customer, { service: svc._id.toString(), startTime: '10:00', endTime: '11:00' });
        expect(res.status).toBe(201);
    });

    it('accepts a window matching a chosen service OPTION duration', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, {
            duration: 30,
            options: [{ name: 'Deluxe', price: 400, duration: 90 }],
        });
        // 90-min option window is valid even though base duration is 30.
        const res = await book(customer, { service: svc._id.toString(), startTime: '10:00', endTime: '11:30' });
        expect(res.status).toBe(201);
    });
});

describe('#2 — a provider gets override powers only on their OWN calendar', () => {
    // A provider CAN book another business (dual-role: acting as a customer), but
    // only as a customer — they must NOT get the override that lets them book over
    // that business's blocked time or log a walk-in on a stranger's calendar.
    it('denies a provider booking over ANOTHER business’s blocked time', async () => {
        const attacker = await makeProvider();
        const victim = await makeProvider();
        const victimSvc = await makeService(victim._id, { duration: 30 });
        await BlockedTime.create({
            provider: victim._id, date: soon(), startTime: '10:00', endTime: '11:00', teamMember: null,
        });
        const res = await request(app).post('/api/appointments').set(authHeader(attacker)).send({
            service: victimSvc._id.toString(), appointmentDate: soon(),
            startTime: '10:00', endTime: '10:30', walkInName: 'Ghost',
        });
        expect(res.status).toBe(400); // treated as a customer → blocked time is a hard stop
    });

    it('does not let a provider log a WALK-IN on another business’s calendar', async () => {
        const attacker = await makeProvider();
        const victim = await makeProvider();
        const victimSvc = await makeService(victim._id, { duration: 30 });
        const res = await request(app).post('/api/appointments').set(authHeader(attacker)).send({
            service: victimSvc._id.toString(), appointmentDate: soon(),
            startTime: '10:00', endTime: '10:30', walkInName: 'Ghost',
        });
        // Booking succeeds (provider is a valid customer of the other business) but the
        // walk-in override is ignored: the appointment belongs to the acting provider,
        // not an injected free-text name.
        expect(res.status).toBe(201);
        expect(res.body.data.walkInName).toBeFalsy();
        const custId = res.body.data.customer?._id || res.body.data.customer;
        expect(String(custId)).toBe(String(attacker._id));
    });
});

describe('#3/#5 — add-on prices come from the catalogue, not the request', () => {
    it('drops a negative injected add-on rather than zeroing the price', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 500, duration: 30 });
        const res = await book(customer, {
            service: svc._id.toString(), endTime: '10:30',
            selectedAddOns: [{ name: 'x', price: -500, duration: 0 }],
        });
        expect(res.status).toBe(201);
        expect(res.body.data.totalPrice).toBe(500); // injected -500 dropped, not applied
    });
});

describe('#4 — Google SSO does not pre-hijack an unverified local account', () => {
    const runVerify = (profile, state = 'customer') => new Promise((resolve, reject) => {
        const strat = passport._strategy('google');
        strat._verify({ query: { state } }, 'at', 'rt', profile, (err, user) => err ? reject(err) : resolve(user));
    });
    const profileFor = (email, verified = true) => ({
        id: 'g-' + Math.random().toString(36).slice(2),
        displayName: 'Real Owner',
        emails: [{ value: email, verified }],
        photos: [{ value: 'http://x/a.png' }],
        _json: { email_verified: verified },
    });

    it('takes over an unverified pre-registration and burns its credentials', async () => {
        const attacker = await User.create({
            name: 'Attacker', email: 'victim@example.com', password: 'Attacker1!',
            phone: '123', role: 'customer', isVerified: false,
        });
        const beforeHash = (await User.findById(attacker._id).select('+password')).password;

        const user = await runVerify(profileFor('victim@example.com', true));
        expect(String(user._id)).toBe(String(attacker._id)); // same record adopted
        const after = await User.findById(attacker._id).select('+password');
        expect(after.isVerified).toBe(true);
        expect(after.googleId).toBeTruthy();
        expect(after.tokenVersion).toBe((attacker.tokenVersion || 0) + 1); // sessions revoked
        expect(after.password).not.toBe(beforeHash); // attacker password invalidated
    });

    it('refuses to link when Google has NOT verified the email', async () => {
        await User.create({
            name: 'V', email: 'v2@example.com', password: 'Attacker1!',
            phone: '1', role: 'customer', isVerified: false,
        });
        const user = await runVerify(profileFor('v2@example.com', false));
        expect(user).toBeFalsy(); // done(null, false) → no session issued
    });

    it('links a VERIFIED existing account without touching its password', async () => {
        const legit = await User.create({
            name: 'Legit', email: 'legit@example.com', password: 'Legit123!',
            phone: '1', role: 'customer', isVerified: true,
        });
        const beforeHash = (await User.findById(legit._id).select('+password')).password;
        const user = await runVerify(profileFor('legit@example.com', true));
        expect(String(user._id)).toBe(String(legit._id));
        const after = await User.findById(legit._id).select('+password');
        expect(after.googleId).toBeTruthy();
        expect(after.password).toBe(beforeHash); // genuine owner's credentials preserved
        expect(after.tokenVersion).toBe(legit.tokenVersion || 0); // sessions NOT revoked
    });
});
