/**
 * One account, both modes: a customer can upgrade to provider (no second
 * signup), and a provider can act as a customer (book + reschedule).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduledClient: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

const User = require('../../models/User');
const Availability = require('../../models/Availability');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// 3+ days out: clears the default 24h cancellation window at any time of day.
const nextWeekday = () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('Become a provider (adds a business account)', () => {
    // Listing a business must ADD an account, never convert the one they are
    // signed into. Converting left people with no customer profile at all —
    // their bookings, wallet and reviews sat on a document the customer site
    // would no longer sign in, with no way back.
    it('creates a SECOND account and leaves the customer account intact', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .put('/api/auth/become-provider')
            .set(authHeader(customer))
            .send({ providerCategory: 'Barbering' });

        expect(res.status).toBe(200);
        expect(res.body.data.role).toBe('provider');
        expect(res.body.data.accountType).toBe('business');

        const stillACustomer = await User.findById(customer._id);
        expect(stillACustomer.role).toBe('customer');
        expect(stillACustomer.accountType).toBe('customer');

        const business = await User.findOne({ email: customer.email, role: 'provider' });
        expect(business).toBeTruthy();
        expect(business.providerCategory).toBe('Barbering');
        expect(String(business._id)).not.toBe(String(customer._id));

        // Availability belongs to the new business, not the customer document.
        expect(await Availability.findOne({ provider: business._id })).toBeTruthy();
        expect(await Availability.findOne({ provider: customer._id })).toBeNull();
    });

    it('shares the password, so both sides sign in and the website can carry them across', async () => {
        const customer = await makeUser({ password: 'Password1!' });
        await request(app).put('/api/auth/become-provider')
            .set(authHeader(customer)).send({ providerCategory: 'Barbering' });

        const asBusiness = await request(app).post('/api/auth/login')
            .send({ email: customer.email, password: 'Password1!', accountType: 'business' });
        expect(asBusiness.status).toBe(200);
        expect(asBusiness.body.data.user.role).toBe('provider');

        const asCustomer = await request(app).post('/api/auth/login')
            .send({ email: customer.email, password: 'Password1!', accountType: 'customer' });
        expect(asCustomer.status).toBe(200);
        expect(asCustomer.body.data.otherSide).toEqual({ accountType: 'business', sameCredentials: true });
    });

    it('returns a one-time code that signs them into the business app', async () => {
        const customer = await makeUser();
        const res = await request(app).put('/api/auth/become-provider')
            .set(authHeader(customer)).send({ providerCategory: 'Barbering' });

        const code = res.body.data.handoffCode;
        expect(typeof code).toBe('string');

        const exchanged = await request(app).post('/api/auth/exchange-code').send({ code });
        expect(exchanged.status).toBe(200);
        expect(exchanged.body.data.user.role).toBe('provider');

        // Single use.
        const replay = await request(app).post('/api/auth/exchange-code').send({ code });
        expect(replay.status).toBe(400);
    });

    it('refuses when a business account already holds the email', async () => {
        const customer = await makeUser();
        await makeProvider({ email: customer.email });
        const res = await request(app).put('/api/auth/become-provider')
            .set(authHeader(customer)).send({ providerCategory: 'Barbering' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already exists/i);
    });

    it('rejects without a category', async () => {
        const customer = await makeUser();
        const res = await request(app).put('/api/auth/become-provider').set(authHeader(customer)).send({});
        expect(res.status).toBe(400);
    });

    // A Google-signed-up customer is created the way production makes them:
    // googleId set, NO password, and provider left at the schema default
    // 'local' (passport never writes provider:'google'). The business account
    // must carry the Google identity across, or Google sign-in on the business
    // app can never reach it. A fixture that sets provider:'google' would pass
    // vacuously against the old bug — so this one deliberately does not.
    it('copies the Google identity for a Google-only customer', async () => {
        const customer = await makeUser({ password: undefined, isVerified: true });
        await User.updateOne({ _id: customer._id }, { $set: { googleId: 'g-bp-1' }, $unset: { password: '' } });

        const res = await request(app).put('/api/auth/become-provider')
            .set(authHeader(customer)).send({ providerCategory: 'Barbering' });
        expect(res.status).toBe(200);

        const business = await User.findOne({ email: customer.email, role: 'provider' }).select('+password');
        expect(business.googleId).toBe('g-bp-1');
        // No known password was invented for them: they sign in with Google.
        expect(business.password).toBeFalsy();
    });

    it('refuses a caller who is already a business account (no 500 on the unique index)', async () => {
        const provider = await makeProvider();
        const res = await request(app).put('/api/auth/become-provider')
            .set(authHeader(provider)).send({ providerCategory: 'Barbering' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already a business account/i);
    });

    // SEC-1: the shared password is a CLONED hash. Changing it on the customer
    // side must revoke the clone, or the old password opens the business twin
    // forever.
    it('a customer password change revokes the cloned business credential', async () => {
        const customer = await makeUser({ password: 'Password1!' });
        await request(app).put('/api/auth/become-provider')
            .set(authHeader(customer)).send({ providerCategory: 'Barbering' });

        // Old password opens the business side today.
        expect((await request(app).post('/api/auth/login')
            .send({ email: customer.email, password: 'Password1!', accountType: 'business' })).status).toBe(200);

        // Change it on the customer side.
        const changed = await request(app).put('/api/auth/change-password')
            .set(authHeader(customer)).send({ currentPassword: 'Password1!', newPassword: 'Brand-New1!' });
        expect(changed.status).toBe(200);

        // The OLD password no longer opens the business twin; the NEW one does.
        expect((await request(app).post('/api/auth/login')
            .send({ email: customer.email, password: 'Password1!', accountType: 'business' })).status).not.toBe(200);
        expect((await request(app).post('/api/auth/login')
            .send({ email: customer.email, password: 'Brand-New1!', accountType: 'business' })).status).toBe(200);
    });
});

// ux-1: a dual account typing the WRONG side's password on a door must get a
// plain 401 — never a "wrong side" 403 that hands them off and bounces them
// off the door they chose.
describe('a wrong-side password on a dual account is just a wrong password', () => {
    it('does not offer the other side when an account exists on the side asked for', async () => {
        const customer = await makeUser({ email: 'both@x.com', password: 'CustPass1!', isVerified: true });
        await makeProvider({ email: 'both@x.com', password: 'BizPass1!', isVerified: true });
        void customer;

        // Customer password on the BUSINESS door: a business account exists, so
        // this is simply wrong — 401, no accountType hint, no hand-off.
        const res = await request(app).post('/api/auth/login')
            .send({ email: 'both@x.com', password: 'CustPass1!', accountType: 'business' });
        expect(res.status).toBe(401);
        expect(res.body.accountType).toBeUndefined();
    });

    it('still hands off when NO account exists on the side asked for', async () => {
        await makeProvider({ email: 'bizonly@x.com', password: 'BizPass1!', isVerified: true });
        const res = await request(app).post('/api/auth/login')
            .send({ email: 'bizonly@x.com', password: 'BizPass1!', accountType: 'customer' });
        expect(res.status).toBe(403);
        expect(res.body.accountType).toBe('business');
    });
});

describe('Provider acting as a customer', () => {
    it('lets a provider book and reschedule an appointment with another business', async () => {
        const business = await makeProvider();           // the provider being booked
        const svc = await makeService(business._id);
        const me = await makeProvider();                 // a provider acting as a customer

        const booked = await request(app)
            .post('/api/appointments')
            .set(authHeader(me))
            .send({ service: svc._id.toString(), appointmentDate: nextWeekday(), startTime: '10:00', endTime: '10:30' });
        expect(booked.status).toBe(201);
        const id = booked.body.data._id;

        const resched = await request(app)
            .put(`/api/appointments/${id}/reschedule`)
            .set(authHeader(me))
            .send({ appointmentDate: nextWeekday(), startTime: '11:00' });
        expect(resched.status).toBe(200);
    });
});
