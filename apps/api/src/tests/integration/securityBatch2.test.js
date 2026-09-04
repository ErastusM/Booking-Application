/**
 * Batch 2 — security blockers from the audit:
 *   A. Staff-role booking gate: a role:'staff' token used to skip every
 *      customer-side guard (hours, blocked time, past-slot) on ANY provider's
 *      calendar. Staff must now be held to the same checks as a customer.
 *   B. Verification-token leak: PUT /auth/profile echoed the live 24h
 *      verificationToken, enabling self-verification / account hijack. It must
 *      never appear in a user response.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const Availability = require('../../models/Availability');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => {
    const s = {};
    DAYS.forEach((d) => { s[d] = { enabled: true, slots: [{ start, end }] }; });
    return s;
};
const DATE = '2026-12-16';

describe('A — staff-role tokens are held to the customer booking guards', () => {
    it('rejects a staff booking outside the provider\'s published hours (no bypass)', async () => {
        const target = await makeProvider();
        await Availability.create({ provider: target._id, schedule: everyDay('08:00', '17:00') });
        const svc = await makeService(target._id, { price: 100, duration: 60 });

        // A staff principal of SOME business (even a different one) tries to book
        // the target's service at 20:00 — outside 08:00–17:00.
        const otherBiz = await makeProvider();
        const staff = await makeUser({ role: 'staff', staffOf: otherBiz._id });

        const res = await request(app).post('/api/appointments').set(authHeader(staff)).send({
            service: svc._id.toString(), appointmentDate: DATE, startTime: '20:00', endTime: '21:00',
        });

        // Before the fix a staff token skipped the hours check and got 201.
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/schedule|available/i);
    });

    it('still lets the OWNING provider book their own service outside hours (override intact)', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '17:00') });
        const svc = await makeService(provider._id, { price: 100, duration: 60 });
        const client = await makeUser();
        // Give the provider an existing-client relationship isn't needed for a walk-in.
        const res = await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: DATE, startTime: '20:00', endTime: '21:00',
            walkInName: 'Walk-in',
        });
        expect(res.status).toBe(201); // owner override still works
    });
});

describe('B — the verification token is never returned to the client', () => {
    it('PUT /auth/profile does not leak verificationToken', async () => {
        const user = await makeUser({ role: 'customer' });
        // Simulate an outstanding verification token on the account.
        await User.updateOne({ _id: user._id }, { $set: { verificationToken: 'SECRET_TOKEN_1234', isVerified: false } });

        const res = await request(app).put('/api/auth/profile').set(authHeader(user)).send({ name: 'New Name' });

        expect(res.status).toBe(200);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.verificationToken).toBeUndefined();
        expect(res.body.data.password).toBeUndefined();
    });
});
