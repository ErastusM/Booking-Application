/**
 * Security regression (finding #24): joinWaitingList must NOT trust a `provider`
 * id from the request body. The provider is a property of the service
 * (svc.provider), so a forged body value must be ignored — otherwise a caller
 * could:
 *   1. inject a waitlist row + in-app/push notification onto ANY account, and
 *   2. (on promotion) write a REAL confirmed appointment onto a victim
 *      provider's calendar for a service the victim does not own.
 * See waitingListController.joinWaitingList and utils/waitingListHelper.js.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const Notification = require('../../models/Notification');
const WaitingList = require('../../models/WaitingList');
const Appointment = require('../../models/Appointment');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduledClient: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const soon = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('Waiting list — provider mass-assignment guard', () => {
    it('ignores an attacker-supplied provider id and targets only the real service owner', async () => {
        const victim = await makeProvider();   // uninvolved account the attacker forges
        const owner = await makeProvider();     // the service's real owner
        const svc = await makeService(owner._id);
        const booker = await makeUser();
        const attacker = await makeUser();
        const date = soon();

        // Booker takes the slot on the owner's service.
        const booked = await request(app).post('/api/appointments').set(authHeader(booker))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30' });
        expect(booked.status).toBe(201);

        // Attacker joins the (taken) waitlist but forges provider = victim.
        const join = await request(app).post('/api/waitinglist').set(authHeader(attacker))
            .send({
                service: svc._id.toString(),
                provider: victim._id.toString(), // forged — must be ignored
                appointmentDate: date,
                startTime: '10:00',
                endTime: '10:30',
            });
        expect(join.status).toBe(201);

        // The persisted row must carry the SERVICE'S owner, never the forged id.
        const entry = await WaitingList.findOne({ customer: attacker._id });
        expect(String(entry.provider)).toBe(String(owner._id));
        expect(String(entry.provider)).not.toBe(String(victim._id));

        // No notification/push row may reach the forged victim...
        const victimNotifs = await Notification.find({ user: victim._id, type: 'waiting_list' });
        expect(victimNotifs.length).toBe(0);
        // ...and the real owner IS notified.
        const ownerNotifs = await Notification.find({ user: owner._id, type: 'waiting_list' });
        expect(ownerNotifs.length).toBeGreaterThan(0);
    });

    it('a forged provider cannot get a confirmed appointment written onto the victim calendar on promotion', async () => {
        const victim = await makeProvider();
        const owner = await makeProvider();
        const svc = await makeService(owner._id);
        const booker = await makeUser();
        const attacker = await makeUser();
        const date = soon();

        const booked = await request(app).post('/api/appointments').set(authHeader(booker))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '11:00', endTime: '11:30' });
        const apptId = booked.body.data._id;

        await request(app).post('/api/waitinglist').set(authHeader(attacker))
            .send({
                service: svc._id.toString(),
                provider: victim._id.toString(), // forged
                appointmentDate: date,
                startTime: '11:00',
                endTime: '11:30',
            });

        // Booker cancels → the attacker is promoted and auto-booked.
        const cancel = await request(app).delete(`/api/appointments/${apptId}`).set(authHeader(booker))
            .send({ cancellationReason: 'changed my mind' });
        expect(cancel.status).toBe(200);

        const entry = await WaitingList.findOne({ customer: attacker._id });
        expect(entry.status).toBe('promoted');

        // The promoted booking must land on the REAL owner, never the victim.
        const promoted = await Appointment.findOne({ customer: attacker._id, status: 'confirmed' });
        expect(promoted).not.toBeNull();
        expect(String(promoted.provider)).toBe(String(owner._id));

        // The victim's calendar must have gained nothing.
        const victimAppts = await Appointment.find({ provider: victim._id });
        expect(victimAppts.length).toBe(0);
    });
});
