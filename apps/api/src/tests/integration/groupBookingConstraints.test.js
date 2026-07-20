/**
 * Regression: POST /api/appointments/group used to run Appointment.insertMany with
 * NO validation at all, while the sibling single-booking path enforced every guard.
 * Flipping the dashboard's "Group booking" toggle was therefore enough to write
 * straight over an existing client's slot, or to reference another business's
 * service. These lock the guards in.
 */
const request = require('supertest');

// A broken mailer must never affect booking outcomes (see providerBooking.test.js).
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
const Appointment = require('../../models/Appointment');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const nextWeekday = () => {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('Group booking enforces the same constraints as a single booking', () => {
    it('refuses to double-book a slot that already holds an appointment', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });
        const date = nextWeekday();

        const first = await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: date,
            startTime: '10:00', endTime: '11:00', walkInName: 'First Client',
        });
        expect(first.status).toBe(201);

        const res = await request(app).post('/api/appointments/group').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: date,
            startTime: '10:00', endTime: '11:00',
            clients: [{ name: 'Group A' }, { name: 'Group B' }],
        });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already booked/i);
        // The original booking must survive and nothing may be written on top of it.
        expect(await Appointment.countDocuments({})).toBe(1);
    });

    it('rejects a service that belongs to another business', async () => {
        const provider = await makeProvider();
        const other = await makeProvider();
        const otherSvc = await makeService(other._id, { duration: 60 });

        const res = await request(app).post('/api/appointments/group').set(authHeader(provider)).send({
            service: otherSvc._id.toString(), appointmentDate: nextWeekday(),
            startTime: '10:00', endTime: '11:00', clients: [{ name: 'Group A' }],
        });

        expect(res.status).toBe(403);
        expect(await Appointment.countDocuments({})).toBe(0);
    });

    it('still allows a genuine group booking into a free slot', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 60 });

        const res = await request(app).post('/api/appointments/group').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: nextWeekday(),
            startTime: '10:00', endTime: '11:00',
            clients: [{ name: 'Group A' }, { name: 'Group B' }, { name: 'Group C' }],
        });

        // Several clients sharing ONE slot is the whole point of a group booking —
        // the overlap guard must not reject the group against its own members.
        expect(res.status).toBe(201);
        expect(res.body.data).toHaveLength(3);
        const all = await Appointment.find({});
        expect(all).toHaveLength(3);
        expect(new Set(all.map(a => String(a.groupId))).size).toBe(1);
        expect(all.map(a => a.walkInName).sort()).toEqual(['Group A', 'Group B', 'Group C']);
    });
});
