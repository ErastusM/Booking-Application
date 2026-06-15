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
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

const User = require('../../models/User');
const Availability = require('../../models/Availability');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const nextWeekday = () => {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('Become a provider (account upgrade)', () => {
    it('flips a customer to provider and seeds default availability', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .put('/api/auth/become-provider')
            .set(authHeader(customer))
            .send({ providerCategory: 'Barbering' });

        expect(res.status).toBe(200);
        expect(res.body.data.role).toBe('provider');

        const fresh = await User.findById(customer._id);
        expect(fresh.role).toBe('provider');
        expect(fresh.providerCategory).toBe('Barbering');

        const av = await Availability.findOne({ provider: customer._id });
        expect(av).toBeTruthy();
    });

    it('rejects without a category', async () => {
        const customer = await makeUser();
        const res = await request(app).put('/api/auth/become-provider').set(authHeader(customer)).send({});
        expect(res.status).toBe(400);
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
