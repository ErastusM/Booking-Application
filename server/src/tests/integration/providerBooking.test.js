/**
 * Regression: provider creating an appointment from the calendar must not 500.
 * Root cause was email (EAUTH on bad Gmail creds) propagating into the request
 * path; emailService.safeSend now isolates that. A failing/absent mailer must
 * never break booking.
 */
const request = require('supertest');

// Simulate a broken mailer (e.g. EAUTH on bad Gmail creds). Booking must still succeed.
jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendWelcomeEmail: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendAppointmentConfirmed: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendAppointmentCompleted: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendAppointmentCancelled: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendAppointmentRescheduled: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendRebookingPrompt: jest.fn().mockRejectedValue(new Error('EAUTH')),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const nextWeekday = () => {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('Provider creates an appointment from the calendar', () => {
    it('creates a walk-in appointment (no 500)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(provider))
            .send({
                service: svc._id.toString(),
                appointmentDate: nextWeekday(),
                startTime: '10:00',
                endTime: '10:30',
                walkInName: 'Walk-in Client',
                notes: '',
                isRecurring: false,
            });
        expect(res.status).toBe(201);
        expect(res.body.data.walkInName).toBe('Walk-in Client');
    });
});
