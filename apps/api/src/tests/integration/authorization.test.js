/**
 * Authorization / RBAC integration tests.
 * Verifies that every role-restricted route correctly blocks unauthorized roles,
 * and prevents IDOR (cross-user data access).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const {
    makeUser, makeProvider, makeAdmin,
    makeService, makeAppointment,
    authHeader,
} = require('../helpers/factories');

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
// Admin-only routes
// ─────────────────────────────────────────────────────────────────────────────
describe('Admin-only routes', () => {
    it('GET /api/users returns 403 for a customer', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .get('/api/users')
            .set(authHeader(customer));
        expect(res.status).toBe(403);
    });

    it('GET /api/users returns 403 for a provider', async () => {
        const provider = await makeProvider();
        const res = await request(app)
            .get('/api/users')
            .set(authHeader(provider));
        expect(res.status).toBe(403);
    });

    it('GET /api/users returns 200 for an admin', async () => {
        const admin = await makeAdmin();
        const res = await request(app)
            .get('/api/users')
            .set(authHeader(admin));
        expect(res.status).toBe(200);
    });

    it('PUT /api/users/:id/role returns 403 for a customer', async () => {
        const customer = await makeUser();
        const target = await makeUser();
        const res = await request(app)
            .put(`/api/users/${target._id}/role`)
            .set(authHeader(customer))
            .send({ role: 'admin' });
        expect(res.status).toBe(403);
    });

    it('DELETE /api/users/:id returns 403 for a customer', async () => {
        const customer = await makeUser();
        const target = await makeUser();
        const res = await request(app)
            .delete(`/api/users/${target._id}`)
            .set(authHeader(customer));
        expect(res.status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider-only routes
// ─────────────────────────────────────────────────────────────────────────────
describe('Provider-only routes', () => {
    it('GET /api/services/my-services returns 403 for a customer', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .get('/api/services/my-services')
            .set(authHeader(customer));
        expect(res.status).toBe(403);
    });

    it('POST /api/services/my-services returns 403 for a customer', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .post('/api/services/my-services')
            .set(authHeader(customer))
            .send({ name: 'Haircut', price: 20, duration: 30 });
        expect(res.status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Booking routes — customers and providers may book (providers create
// walk-in bookings); the route is authorize('customer', 'provider')
// ─────────────────────────────────────────────────────────────────────────────
describe('Booking routes', () => {
    it('POST /api/appointments allows a provider (walk-in booking)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(provider))
            .send({
                service: svc._id,
                appointmentDate: tomorrow,
                startTime: '10:00',
                endTime: '10:30',
                walkInName: 'Walk-in Client',
            });
        expect(res.status).toBe(201);
        expect(res.body.data.walkInName).toBe('Walk-in Client');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// IDOR – cross-user appointment access
// ─────────────────────────────────────────────────────────────────────────────
describe('IDOR – appointment ownership', () => {
    it('customer A cannot cancel customer B\'s appointment', async () => {
        const customerA = await makeUser();
        const customerB = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customerB._id, svc._id, provider._id);

        const res = await request(app)
            .delete(`/api/appointments/${appt._id}`)
            .set(authHeader(customerA));
        expect(res.status).toBe(403);
    });

    it('customer can cancel their own appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id);

        const res = await request(app)
            .delete(`/api/appointments/${appt._id}`)
            .set(authHeader(customer));
        expect(res.status).toBe(200);
    });

    it('provider cannot see another provider\'s appointments via GET /api/appointments', async () => {
        const providerA = await makeProvider();
        const providerB = await makeProvider();
        const customer = await makeUser();
        const svcA = await makeService(providerA._id);
        await makeAppointment(customer._id, svcA._id, providerA._id);

        const res = await request(app)
            .get('/api/appointments')
            .set(authHeader(providerB));
        expect(res.status).toBe(200);
        // providerB should see zero appointments (all belong to providerA)
        expect(res.body.data.length).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unauthenticated requests
// ─────────────────────────────────────────────────────────────────────────────
describe('Unauthenticated requests', () => {
    it('GET /api/appointments returns 401', async () => {
        const res = await request(app).get('/api/appointments');
        expect(res.status).toBe(401);
    });

    it('GET /api/users returns 401', async () => {
        const res = await request(app).get('/api/users');
        expect(res.status).toBe(401);
    });

    it('GET /api/services (public) returns 200 without auth', async () => {
        const res = await request(app).get('/api/services');
        expect(res.status).toBe(200);
    });

    it('Malformed Bearer token returns 401', async () => {
        const res = await request(app)
            .get('/api/appointments')
            .set('Authorization', 'Bearer not.a.jwt');
        expect(res.status).toBe(401);
    });
});
