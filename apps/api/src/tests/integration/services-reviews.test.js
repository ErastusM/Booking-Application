/**
 * Services + Reviews integration tests.
 * Covers: service CRUD, email-leak prevention, mass-assignment,
 * review ownership enforcement, pagination.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const {
    makeUser, makeProvider, makeAdmin,
    makeService, makeAppointment, makeReview,
    authHeader,
} = require('../helpers/factories');
const Service = require('../../models/Service');
const Appointment = require('../../models/Appointment');

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
// SERVICES
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/services', () => {
    it('returns only active services', async () => {
        const provider = await makeProvider();
        await makeService(provider._id, { isActive: true });
        await makeService(provider._id, { isActive: false });

        const res = await request(app).get('/api/services');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(1);
    });

    it('does NOT expose provider email in service list', async () => {
        const provider = await makeProvider({ email: 'hidden@provider.com' });
        await makeService(provider._id, { isActive: true });

        const res = await request(app).get('/api/services');
        expect(JSON.stringify(res.body)).not.toContain('hidden@provider.com');
    });

    it('no auth required for public service listing', async () => {
        const res = await request(app).get('/api/services');
        expect(res.status).toBe(200);
    });
});

describe('POST /api/services/my-services – provider creates service', () => {
    it('provider can create their own service', async () => {
        const provider = await makeProvider();
        const res = await request(app)
            .post('/api/services/my-services')
            .set(authHeader(provider))
            .send({ name: 'Haircut', description: 'Clean cut', price: 30, duration: 30 });
        expect(res.status).toBe(201);
        expect(res.body.data.provider.toString()).toBe(provider._id.toString());
    });

    it('customer cannot create provider services', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .post('/api/services/my-services')
            .set(authHeader(customer))
            .send({ name: 'Haircut', price: 30, duration: 30 });
        expect(res.status).toBe(403);
    });
});

describe('PUT /api/services/:id – update service', () => {
    it('provider can update their own service fields', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { name: 'Old Name' });

        const res = await request(app)
            .put(`/api/services/${svc._id}`)
            .set(authHeader(provider))
            .send({ name: 'New Name', price: 60, duration: 45 });
        expect(res.status).toBe(200);
        expect(res.body.data.name).toBe('New Name');
    });

    it('provider cannot update another provider\'s service', async () => {
        const providerA = await makeProvider();
        const providerB = await makeProvider();
        const svc = await makeService(providerA._id);

        const res = await request(app)
            .put(`/api/services/${svc._id}`)
            .set(authHeader(providerB))
            .send({ name: 'Hijacked' });
        expect(res.status).toBe(403);
    });

    it('mass assignment: provider cannot change service.provider field', async () => {
        const provider = await makeProvider();
        const otherProvider = await makeProvider();
        const svc = await makeService(provider._id);

        await request(app)
            .put(`/api/services/${svc._id}`)
            .set(authHeader(provider))
            .send({ provider: otherProvider._id.toString(), name: 'Same Name' });

        const updated = await Service.findById(svc._id);
        expect(updated.provider.toString()).toBe(provider._id.toString());
    });

    it('returns 404 for non-existent service', async () => {
        const admin = await makeAdmin();
        const { Types: { ObjectId } } = require('mongoose');
        const res = await request(app)
            .put(`/api/services/${new ObjectId()}`)
            .set(authHeader(admin))
            .send({ name: 'Ghost' });
        expect(res.status).toBe(404);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWS
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/reviews – create review', () => {
    it('customer can review their completed appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed' });

        const res = await request(app)
            .post('/api/reviews')
            .set(authHeader(customer))
            .send({ appointmentId: appt._id.toString(), rating: 5, comment: 'Excellent!' });
        expect(res.status).toBe(201);
        expect(res.body.data.rating).toBe(5);
    });

    it('cannot review a pending (non-completed) appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'pending' });

        const res = await request(app)
            .post('/api/reviews')
            .set(authHeader(customer))
            .send({ appointmentId: appt._id.toString(), rating: 4, comment: 'Nice' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/completed/i);
    });

    it('different customer cannot review someone else\'s appointment (IDOR)', async () => {
        const customerA = await makeUser();
        const customerB = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customerA._id, svc._id, provider._id, { status: 'completed' });

        const res = await request(app)
            .post('/api/reviews')
            .set(authHeader(customerB))
            .send({ appointmentId: appt._id.toString(), rating: 1, comment: 'Fake review' });
        expect(res.status).toBe(403);
    });

    it('cannot submit duplicate review for the same appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed' });

        await request(app)
            .post('/api/reviews')
            .set(authHeader(customer))
            .send({ appointmentId: appt._id.toString(), rating: 5, comment: 'First review' });

        const res = await request(app)
            .post('/api/reviews')
            .set(authHeader(customer))
            .send({ appointmentId: appt._id.toString(), rating: 3, comment: 'Second attempt' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already reviewed/i);
    });

    it('returns 400 when required fields are missing', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .post('/api/reviews')
            .set(authHeader(customer))
            .send({ rating: 4 }); // missing appointmentId + comment
        expect(res.status).toBe(400);
    });
});

describe('GET /api/reviews/service/:serviceId – pagination', () => {
    it('paginates reviews correctly', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        // Create 7 reviews for the same service (via 7 different appointments)
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i + 1);
            const appt = await Appointment.create({
                customer: customer._id,
                service: svc._id,
                provider: provider._id,
                appointmentDate: d,
                startTime: `${9 + i}:00`,
                endTime: `${9 + i}:30`,
                totalPrice: 50,
                status: 'completed',
            });
            await makeReview(customer._id, svc._id, appt._id, { rating: 3 + (i % 3) });
        }

        const res = await request(app)
            .get(`/api/reviews/service/${svc._id}?page=1&limit=4`);
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(4);
        expect(res.body.total).toBe(7);

        const page2 = await request(app)
            .get(`/api/reviews/service/${svc._id}?page=2&limit=4`);
        expect(page2.body.data.length).toBe(3);
    });
});
