/**
 * CRM client list: a customer who books online appears automatically, AND a
 * walk-in logged by the provider (name only, no account) appears as its own
 * client instead of being hidden under the provider.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Appointment = require('../../models/Appointment');
const { makeProvider, makeUser, makeService, makeAppointment, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('GET /api/crm/clients', () => {
    it('lists registered bookers and walk-ins, but not the provider themselves', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const customer = await makeUser({ name: 'Real Customer' });

        // Registered online booking
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed' });
        // Walk-in logged by the provider (customer = provider id + walkInName)
        await Appointment.create({
            customer: provider._id, service: svc._id, provider: provider._id,
            appointmentDate: new Date(Date.now() + 3 * 864e5), startTime: '11:00', endTime: '11:30',
            totalPrice: 50, status: 'completed', walkInName: 'Jane Walk-in',
        });

        const res = await request(app).get('/api/crm/clients').set(authHeader(provider));
        expect(res.status).toBe(200);
        const names = res.body.data.map((c) => c.customer.name).sort();
        expect(names).toEqual(['Jane Walk-in', 'Real Customer']);
        // Provider must not be listed as their own client
        expect(names).not.toContain(provider.name);

        const walkin = res.body.data.find((c) => c.customer.name === 'Jane Walk-in');
        expect(walkin.isWalkIn).toBe(true);
        expect(walkin.visits).toBe(1);
        expect(String(walkin.customer._id)).toMatch(/^walkin:/);
    });

    it('resolves a walk-in client detail by name (no note)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        await Appointment.create({
            customer: provider._id, service: svc._id, provider: provider._id,
            appointmentDate: new Date(Date.now() + 3 * 864e5), startTime: '09:00', endTime: '09:30',
            totalPrice: 50, status: 'completed', walkInName: 'Jane Walk-in',
        });

        const res = await request(app).get('/api/crm/clients/walkin:jane walk-in').set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.appointments).toHaveLength(1);
        expect(res.body.data.note).toBeNull();
    });
});
