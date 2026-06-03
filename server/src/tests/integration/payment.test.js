/**
 * Payment integration tests.
 * Stripe SDK is mocked to avoid real API calls.
 * Key concern: IDOR – confirm payment must reject if appointment owner != caller.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const {
    makeUser, makeProvider, makeAdmin,
    makeService, makeAppointment,
    authHeader,
} = require('../helpers/factories');

// ─── Stripe mock ──────────────────────────────────────────────────────────────
jest.mock('stripe', () => {
    const mockCreate = jest.fn().mockResolvedValue({
        client_secret: 'pi_test_secret',
        id: 'pi_test_id',
        status: 'succeeded',
    });
    const mockRetrieve = jest.fn().mockResolvedValue({
        id: 'pi_test_id',
        status: 'succeeded',
    });
    return jest.fn(() => ({
        paymentIntents: { create: mockCreate, retrieve: mockRetrieve },
    }));
});

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// ─────────────────────────────────────────────────────────────────────────────
// Create Payment Intent
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/payments/create-payment-intent', () => {
    it('returns clientSecret for a valid service', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 75 });

        const res = await request(app)
            .post('/api/payments/create-payment-intent')
            .set(authHeader(customer))
            .send({ serviceId: svc._id.toString() });

        expect(res.status).toBe(200);
        expect(res.body.clientSecret).toBeTruthy();
        expect(res.body.amount).toBe(7500); // 75 USD → 7500 cents
    });

    it('returns 404 for a non-existent service', async () => {
        const customer = await makeUser();
        const { Types: { ObjectId } } = require('mongoose');
        const res = await request(app)
            .post('/api/payments/create-payment-intent')
            .set(authHeader(customer))
            .send({ serviceId: new ObjectId().toString() });
        expect(res.status).toBe(404);
    });

    it('returns 403 for a provider (customer-only route)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const res = await request(app)
            .post('/api/payments/create-payment-intent')
            .set(authHeader(provider))
            .send({ serviceId: svc._id.toString() });
        expect(res.status).toBe(403);
    });

    it('returns 401 with no auth token', async () => {
        const res = await request(app)
            .post('/api/payments/create-payment-intent')
            .send({ serviceId: 'irrelevant' });
        expect(res.status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Payment – IDOR protection
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/payments/confirm – IDOR protection', () => {
    it('returns 403 when a different customer tries to confirm another\'s appointment', async () => {
        const ownerCustomer = await makeUser();
        const attackerCustomer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(ownerCustomer._id, svc._id, provider._id);

        const res = await request(app)
            .post('/api/payments/confirm')
            .set(authHeader(attackerCustomer))
            .send({ paymentIntentId: 'pi_test_id', appointmentId: appt._id.toString() });

        expect(res.status).toBe(403);
    });

    it('owner can confirm their own appointment payment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id);

        const res = await request(app)
            .post('/api/payments/confirm')
            .set(authHeader(customer))
            .send({ paymentIntentId: 'pi_test_id', appointmentId: appt._id.toString() });

        expect(res.status).toBe(200);
        expect(res.body.data.paymentStatus).toBe('paid');
        expect(res.body.data.status).toBe('confirmed');
    });

    it('returns 404 for a non-existent appointment', async () => {
        const customer = await makeUser();
        const { Types: { ObjectId } } = require('mongoose');
        const res = await request(app)
            .post('/api/payments/confirm')
            .set(authHeader(customer))
            .send({ paymentIntentId: 'pi_test_id', appointmentId: new ObjectId().toString() });
        expect(res.status).toBe(404);
    });

    it('returns 400 when payment has not succeeded', async () => {
        // Override Stripe retrieve mock to return pending status
        const stripe = require('stripe');
        stripe().paymentIntents.retrieve.mockResolvedValueOnce({ id: 'pi_pending', status: 'requires_payment_method' });

        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id);

        const res = await request(app)
            .post('/api/payments/confirm')
            .set(authHeader(customer))
            .send({ paymentIntentId: 'pi_pending', appointmentId: appt._id.toString() });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/not completed/i);
    });
});
