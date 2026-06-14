/**
 * Per-staff scheduling: different team members can be booked concurrently;
 * the same team member cannot be double-booked.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const nextWeekday = () => {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const book = (provider, svc, date, teamMember) => request(app)
    .post('/api/appointments')
    .set(authHeader(provider))
    .send({ service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30', walkInName: 'C', teamMember });

describe('Per-staff scheduling', () => {
    it('allows two different staff at the same time', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const alice = await TeamMember.create({ provider: provider._id, name: 'Alice' });
        const bob = await TeamMember.create({ provider: provider._id, name: 'Bob' });
        const date = nextWeekday();

        const r1 = await book(provider, svc, date, alice._id.toString());
        const r2 = await book(provider, svc, date, bob._id.toString());
        expect(r1.status).toBe(201);
        expect(r2.status).toBe(201);
        expect(r1.body.data.teamMember.toString()).toBe(alice._id.toString());
    });

    it('blocks double-booking the same staff member', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const alice = await TeamMember.create({ provider: provider._id, name: 'Alice' });
        const date = nextWeekday();

        const r1 = await book(provider, svc, date, alice._id.toString());
        const r2 = await book(provider, svc, date, alice._id.toString());
        expect(r1.status).toBe(201);
        expect(r2.status).toBe(400);
        expect(r2.body.message).toMatch(/already booked/i);
    });
});
