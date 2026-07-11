/**
 * Waiting-list promotion must be exactly-once even under concurrency. Two cancels
 * (or a retried cancel) that fire promoteFromWaitingList for the same slot at the
 * same time must NOT book the sole waiting customer twice. The atomic
 * waiting→promoting claim in waitingListHelper is what guarantees this.
 */
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');
const WaitingList = require('../../models/WaitingList');

jest.mock('../../utils/emailService', () => ({
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../utils/notificationhelper', () => ({
    createNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../utils/pushService', () => ({
    sendToUser: jest.fn().mockResolvedValue(true),
}));

const { promoteFromWaitingList } = require('../../utils/waitingListHelper');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

describe('waiting-list promotion concurrency', () => {
    test('two concurrent promotions of the same slot book the customer only once', async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const service = await makeService(provider._id, { duration: 30 });
        const date = new Date();
        date.setDate(date.getDate() + 3);
        date.setHours(0, 0, 0, 0);

        await WaitingList.create({
            service: service._id,
            provider: provider._id,
            customer: customer._id,
            appointmentDate: date,
            startTime: '09:00',
            endTime: '09:30',
            position: 1,
            status: 'waiting',
        });

        // Fire the promotion twice at the same time for the same freed slot.
        await Promise.all([
            promoteFromWaitingList(service._id, date, '09:00', '09:30'),
            promoteFromWaitingList(service._id, date, '09:00', '09:30'),
        ]);

        const appts = await Appointment.find({ customer: customer._id, startTime: '09:00' });
        expect(appts).toHaveLength(1);

        const entry = await WaitingList.findOne({ customer: customer._id });
        expect(entry.status).toBe('promoted');
    });
});
