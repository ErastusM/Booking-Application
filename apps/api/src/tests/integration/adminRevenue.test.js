/**
 * Admin per-provider revenue endpoints.
 * Revenue = completed-appointment service value + package/membership sales.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const ClientPackage = require('../../models/ClientPackage');
const {
    makeUser, makeProvider, makeAdmin,
    makeService, makeAppointment, authHeader,
} = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const makeClientPackage = (customerId, providerId, price) => ClientPackage.create({
    customer: customerId,
    package: new mongoose.Types.ObjectId(),
    provider: providerId,
    sessionsTotal: 5,
    sessionsRemaining: 5,
    purchasePrice: price,
    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    status: 'active',
});

describe('GET /api/analytics/admin/providers', () => {
    it('returns a revenue leaderboard and platform roll-up', async () => {
        const admin = await makeAdmin();
        const customer = await makeUser();
        const provA = await makeProvider();
        const provB = await makeProvider();
        const svcA = await makeService(provA._id, { price: 100 });
        const svcB = await makeService(provB._id, { price: 100 });

        await makeAppointment(customer._id, svcA._id, provA._id, { status: 'completed', totalPrice: 100, appointmentDate: new Date() });
        await makeAppointment(customer._id, svcA._id, provA._id, { status: 'completed', totalPrice: 150, appointmentDate: new Date() });
        await makeAppointment(customer._id, svcB._id, provB._id, { status: 'completed', totalPrice: 500, appointmentDate: new Date() });
        await makeAppointment(customer._id, svcA._id, provA._id, { status: 'pending', totalPrice: 999, appointmentDate: new Date() });
        await makeClientPackage(customer._id, provA._id, 300);

        const res = await request(app).get('/api/analytics/admin/providers').set(authHeader(admin));
        expect(res.status).toBe(200);

        const { platform, providers } = res.body.data;
        // Provider A: 250 services + 300 package = 550; B: 500. A ranks first.
        expect(providers[0]._id).toBe(String(provA._id));
        expect(providers[0].totalRevenue).toBe(550);
        expect(providers[0].servicesRevenue).toBe(250);
        expect(providers[0].packageRevenue).toBe(300);
        expect(providers[0].completedCount).toBe(2);
        expect(providers[1].totalRevenue).toBe(500);

        expect(platform.servicesRevenue).toBe(750);
        expect(platform.packageRevenue).toBe(300);
        expect(platform.totalRevenue).toBe(1050);
        expect(platform.completedCount).toBe(3);
        expect(platform.providerCount).toBe(2);
    });

    it('rejects non-admins', async () => {
        const provider = await makeProvider();
        const res = await request(app).get('/api/analytics/admin/providers').set(authHeader(provider));
        expect(res.status).toBe(403);
    });
});

describe('GET /api/analytics/admin/providers/:id', () => {
    it('returns a full revenue breakdown for one provider', async () => {
        const admin = await makeAdmin();
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100, name: 'Cut' });

        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 100, appointmentDate: new Date() });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 200, appointmentDate: new Date() });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'cancelled', totalPrice: 100, appointmentDate: new Date() });
        await makeClientPackage(customer._id, provider._id, 300);

        const res = await request(app).get(`/api/analytics/admin/providers/${provider._id}`).set(authHeader(admin));
        expect(res.status).toBe(200);

        const d = res.body.data;
        expect(d.provider.name).toBe(provider.name);
        expect(d.revenue.services).toBe(300);
        expect(d.revenue.packages).toBe(300);
        expect(d.revenue.total).toBe(600);
        expect(d.revenue.avgTicket).toBe(150);
        expect(d.appointments.completed).toBe(2);
        expect(d.appointments.byStatus.completed).toBe(2);
        expect(d.appointments.byStatus.cancelled).toBe(1);
        expect(d.appointments.uniqueClients).toBe(1);
        expect(d.packages.count).toBe(1);
        expect(d.packages.active).toBe(1);
        expect(d.topServices[0]).toMatchObject({ name: 'Cut', revenue: 300, count: 2 });
        expect(d.monthly).toHaveLength(6);
    });

    it('400s on an invalid id and 404s on an unknown provider', async () => {
        const admin = await makeAdmin();
        const bad = await request(app).get('/api/analytics/admin/providers/not-an-id').set(authHeader(admin));
        expect(bad.status).toBe(400);
        const missing = await request(app).get(`/api/analytics/admin/providers/${new mongoose.Types.ObjectId()}`).set(authHeader(admin));
        expect(missing.status).toBe(404);
    });
});
