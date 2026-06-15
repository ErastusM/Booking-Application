/**
 * Status-update idempotency: repeating a status change must not stack duplicate
 * notifications / emails / history entries (regression for the "4 identical
 * 'marked as completed' notifications" bug).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

const Notification = require('../../models/Notification');
const Appointment = require('../../models/Appointment');
const emailService = require('../../utils/emailService');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

describe('PUT /api/appointments/:id/status — idempotent', () => {
    it('marking completed three times creates one notification, one email, one history entry', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed' });

        const url = `/api/appointments/${appt._id}/status`;
        const r1 = await request(app).put(url).set(authHeader(provider)).send({ status: 'completed' });
        const r2 = await request(app).put(url).set(authHeader(provider)).send({ status: 'completed' });
        const r3 = await request(app).put(url).set(authHeader(provider)).send({ status: 'completed' });

        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r3.status).toBe(200);

        const notes = await Notification.find({ user: customer._id, message: /completed/i });
        expect(notes.length).toBe(1);

        expect(emailService.sendAppointmentCompleted).toHaveBeenCalledTimes(1);

        const fresh = await Appointment.findById(appt._id);
        expect(fresh.statusHistory.filter(h => h.status === 'completed').length).toBe(1);
    });

    it('still notifies when the status genuinely changes', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed' });

        const url = `/api/appointments/${appt._id}/status`;
        await request(app).put(url).set(authHeader(provider)).send({ status: 'completed' });
        // a different status afterwards is a real change and should notify again
        await request(app).put(url).set(authHeader(provider)).send({ status: 'no-show' });

        const notes = await Notification.find({ user: customer._id });
        expect(notes.length).toBe(2);
    });
});
