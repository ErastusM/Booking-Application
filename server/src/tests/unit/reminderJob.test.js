/**
 * Background job / reminder service tests.
 * Directly tests the reminder time-window logic + double-send prevention
 * without running cron — we call the query logic inline.
 *
 * Waiting list promotion is also tested here (unit style with real DB).
 */
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');
const WaitingList = require('../../models/WaitingList');
const { promoteFromWaitingList } = require('../../utils/waitingListHelper');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendReminder24h: jest.fn().mockResolvedValue(true),
    sendReminder1h: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../utils/notificationhelper', () => ({
    createNotification: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// ─────────────────────────────────────────────────────────────────────────────
// Reminder time-window queries (unit test against DB)
// ─────────────────────────────────────────────────────────────────────────────
describe('Reminder cron – 24h window', () => {
    it('finds an appointment in the 23–25h window', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: in24h,
            startTime: '10:00',
            endTime: '10:30',
            status: 'confirmed',
            reminderSent24h: false,
        });

        const now = new Date();
        const win24Low = new Date(now.getTime() + 23 * 60 * 60 * 1000);
        const win24High = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        const appts = await Appointment.find({
            status: { $in: ['confirmed', 'pending'] },
            reminderSent24h: false,
            appointmentDate: { $gte: win24Low, $lte: win24High },
        });

        expect(appts.length).toBe(1);
    });

    it('does NOT find an appointment that has already been reminded', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: in24h,
            startTime: '10:00',
            endTime: '10:30',
            status: 'confirmed',
            reminderSent24h: true, // already sent
        });

        const now = new Date();
        const win24Low = new Date(now.getTime() + 23 * 60 * 60 * 1000);
        const win24High = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        const appts = await Appointment.find({
            status: { $in: ['confirmed', 'pending'] },
            reminderSent24h: false,
            appointmentDate: { $gte: win24Low, $lte: win24High },
        });

        expect(appts.length).toBe(0);
    });

    it('does NOT find a cancelled appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: in24h,
            startTime: '10:00',
            endTime: '10:30',
            status: 'cancelled',
            reminderSent24h: false,
        });

        const now = new Date();
        const win24Low = new Date(now.getTime() + 23 * 60 * 60 * 1000);
        const win24High = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        const appts = await Appointment.find({
            status: { $in: ['confirmed', 'pending'] },
            reminderSent24h: false,
            appointmentDate: { $gte: win24Low, $lte: win24High },
        });

        expect(appts.length).toBe(0);
    });
});

describe('Reminder cron – 1h window', () => {
    it('finds an appointment in the 50–70 min window', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
        await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: inOneHour,
            startTime: '10:00',
            endTime: '10:30',
            status: 'confirmed',
            reminderSent1h: false,
        });

        const now = new Date();
        const win1Low = new Date(now.getTime() + 50 * 60 * 1000);
        const win1High = new Date(now.getTime() + 70 * 60 * 1000);

        const appts = await Appointment.find({
            status: { $in: ['confirmed', 'pending'] },
            reminderSent1h: false,
            appointmentDate: { $gte: win1Low, $lte: win1High },
        });

        expect(appts.length).toBe(1);
    });

    it('appointment outside the 1h window is NOT returned', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        // 3 hours away — outside window
        const inThreeHours = new Date(Date.now() + 3 * 60 * 60 * 1000);
        await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: inThreeHours,
            startTime: '10:00',
            endTime: '10:30',
            status: 'confirmed',
            reminderSent1h: false,
        });

        const now = new Date();
        const win1Low = new Date(now.getTime() + 50 * 60 * 1000);
        const win1High = new Date(now.getTime() + 70 * 60 * 1000);

        const appts = await Appointment.find({
            status: { $in: ['confirmed', 'pending'] },
            reminderSent1h: false,
            appointmentDate: { $gte: win1Low, $lte: win1High },
        });

        expect(appts.length).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Waiting List Promotion
// ─────────────────────────────────────────────────────────────────────────────
describe('promoteFromWaitingList', () => {
    it('promotes position-1 entry and creates a confirmed appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const apptDate = new Date();
        apptDate.setDate(apptDate.getDate() + 2);

        await WaitingList.create({
            customer: customer._id,
            service: svc._id,
            appointmentDate: apptDate,
            startTime: '09:00',
            endTime: '09:30',
            status: 'waiting',
            position: 1,
        });

        await promoteFromWaitingList(svc._id, apptDate, '09:00', '09:30');

        const appt = await Appointment.findOne({ customer: customer._id, service: svc._id });
        expect(appt).toBeTruthy();
        expect(appt.status).toBe('confirmed');

        const wl = await WaitingList.findOne({ customer: customer._id });
        expect(wl.status).toBe('promoted');
    });

    it('does nothing when waiting list is empty', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const apptDate = new Date();

        // Should not throw
        await expect(promoteFromWaitingList(svc._id, apptDate, '10:00', '10:30')).resolves.not.toThrow();
    });

    it('shifts remaining positions after promotion', async () => {
        const customerA = await makeUser();
        const customerB = await makeUser();
        const customerC = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const apptDate = new Date();
        apptDate.setDate(apptDate.getDate() + 3);

        await WaitingList.create([
            { customer: customerA._id, service: svc._id, appointmentDate: apptDate, startTime: '09:00', endTime: '09:30', status: 'waiting', position: 1 },
            { customer: customerB._id, service: svc._id, appointmentDate: apptDate, startTime: '09:00', endTime: '09:30', status: 'waiting', position: 2 },
            { customer: customerC._id, service: svc._id, appointmentDate: apptDate, startTime: '09:00', endTime: '09:30', status: 'waiting', position: 3 },
        ]);

        await promoteFromWaitingList(svc._id, apptDate, '09:00', '09:30');

        const bEntry = await WaitingList.findOne({ customer: customerB._id });
        const cEntry = await WaitingList.findOne({ customer: customerC._id });

        expect(bEntry.position).toBe(1);
        expect(cEntry.position).toBe(2);
    });
});
