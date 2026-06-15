/**
 * Calendar & waitlist robustness tests.
 * Covers the hardening added for "zero-fault" scheduling:
 *  - customers cannot book a past time
 *  - customers cannot book outside the provider's published availability
 *  - editing an appointment cannot move it onto another booking (conflict)
 *  - waiting-list promotion assigns the provider AND emails the customer
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const {
    makeUser, makeProvider, makeAdmin,
    makeService, makeAppointment, authHeader,
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

const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');
const WaitingList = require('../../models/WaitingList');
const emailService = require('../../utils/emailService');
const { promoteFromWaitingList } = require('../../utils/waitingListHelper');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => {
    await testDb.clearDatabase();
    jest.clearAllMocks();
});

// Next weekday in local parts (inside the default Mon–Fri availability).
const nextWeekday = () => {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const todayStr = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('Past-time protection', () => {
    it('rejects a customer booking a time earlier today', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: todayStr(), startTime: '00:00', endTime: '00:30' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/passed/i);
    });
});

describe('Availability enforcement on booking', () => {
    const allDays = (slots) => ({
        monday: { enabled: true, slots }, tuesday: { enabled: true, slots },
        wednesday: { enabled: true, slots }, thursday: { enabled: true, slots },
        friday: { enabled: true, slots }, saturday: { enabled: true, slots },
        sunday: { enabled: true, slots },
    });

    it('rejects a booking outside the published hours', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        await Availability.create({ provider: provider._id, schedule: allDays([{ start: '09:00', end: '12:00' }]) });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: nextWeekday(), startTime: '14:00', endTime: '14:30' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/availability|schedule/i);
    });

    it('accepts a booking inside the published hours', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        await Availability.create({ provider: provider._id, schedule: allDays([{ start: '09:00', end: '12:00' }]) });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: nextWeekday(), startTime: '10:00', endTime: '10:30' });

        expect(res.status).toBe(201);
    });

    it('honours an afternoon block of a split shift', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        await Availability.create({
            provider: provider._id,
            schedule: allDays([{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }]),
        });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: nextWeekday(), startTime: '14:00', endTime: '14:30' });

        expect(res.status).toBe(201);
    });

    it('rejects a time that falls in the lunch break of a split shift', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        await Availability.create({
            provider: provider._id,
            schedule: allDays([{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }]),
        });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: nextWeekday(), startTime: '12:15', endTime: '12:45' });

        expect(res.status).toBe(400);
    });
});

describe('Edit cannot create a conflict', () => {
    it('blocks moving an appointment onto another booking', async () => {
        const admin = await makeAdmin();
        const customerA = await makeUser();
        const customerB = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const date = nextWeekday();

        const apptA = await makeAppointment(customerA._id, svc._id, provider._id, { appointmentDate: new Date(date), startTime: '10:00', endTime: '10:30', status: 'confirmed' });
        const apptB = await makeAppointment(customerB._id, svc._id, provider._id, { appointmentDate: new Date(date), startTime: '11:00', endTime: '11:30', status: 'confirmed' });

        // Move B onto A's slot
        const res = await request(app)
            .put(`/api/appointments/${apptB._id}`)
            .set(authHeader(admin))
            .send({ startTime: '10:00' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already booked/i);

        // B is unchanged
        const fresh = await Appointment.findById(apptB._id);
        expect(fresh.startTime).toBe('11:00');
        expect(apptA.startTime).toBe('10:00');
    });
});

describe('Waiting-list promotion', () => {
    it('assigns the provider and emails the promoted customer', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 80 });

        const apptDate = new Date();
        apptDate.setDate(apptDate.getDate() + 4);

        await WaitingList.create({
            customer: customer._id, service: svc._id, provider: provider._id,
            appointmentDate: apptDate, startTime: '09:00', endTime: '09:30',
            status: 'waiting', position: 1,
        });

        await promoteFromWaitingList(svc._id, apptDate, '09:00', '09:30');

        const appt = await Appointment.findOne({ customer: customer._id, service: svc._id });
        expect(appt).toBeTruthy();
        expect(appt.status).toBe('confirmed');
        expect(appt.provider.toString()).toBe(provider._id.toString());
        expect(appt.totalPrice).toBe(80);

        expect(emailService.sendAppointmentConfirmed).toHaveBeenCalledTimes(1);
        const calledEmail = emailService.sendAppointmentConfirmed.mock.calls[0][0];
        expect(calledEmail).toBe(customer.email);
    });

    it('does not promote into a slot that is no longer free', async () => {
        const waiter = await makeUser();
        const booked = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const apptDate = new Date();
        apptDate.setDate(apptDate.getDate() + 5);

        // Slot is already taken by an active appointment
        await makeAppointment(booked._id, svc._id, provider._id, { appointmentDate: apptDate, startTime: '09:00', endTime: '09:30', status: 'confirmed' });
        await WaitingList.create({
            customer: waiter._id, service: svc._id, provider: provider._id,
            appointmentDate: apptDate, startTime: '09:00', endTime: '09:30',
            status: 'waiting', position: 1,
        });

        await promoteFromWaitingList(svc._id, apptDate, '09:00', '09:30');

        const waiterAppt = await Appointment.findOne({ customer: waiter._id });
        expect(waiterAppt).toBeNull();
        const wl = await WaitingList.findOne({ customer: waiter._id });
        expect(wl.status).toBe('waiting'); // still waiting, not promoted
    });
});
