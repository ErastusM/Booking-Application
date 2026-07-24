/**
 * Auto-completion of past appointments.
 * Confirmed appointments whose time has passed are marked completed so completion
 * rate, completed counts and earnings reflect reality. Pending and future ones are
 * left alone.
 */
const testDb = require('../helpers/testDb');
const Appointment = require('../../models/Appointment');
const { runAutoComplete } = require('../../utils/autoCompleteService');
const { makeUser, makeProvider, makeService, makeAppointment } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const daysAhead = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

describe('runAutoComplete', () => {
    it('completes past confirmed appointments only', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100 });

        const pastConfirmed = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed', appointmentDate: daysAgo(2), startTime: '10:00', endTime: '10:30' });
        const futureConfirmed = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed', appointmentDate: daysAhead(2), startTime: '10:00', endTime: '10:30' });
        const pastPending = await makeAppointment(customer._id, svc._id, provider._id, { status: 'pending', appointmentDate: daysAgo(2), startTime: '10:00', endTime: '10:30' });
        const pastCancelled = await makeAppointment(customer._id, svc._id, provider._id, { status: 'cancelled', appointmentDate: daysAgo(2), startTime: '10:00', endTime: '10:30' });

        const completed = await runAutoComplete();
        expect(completed).toBe(1);

        expect((await Appointment.findById(pastConfirmed._id)).status).toBe('completed');
        expect((await Appointment.findById(futureConfirmed._id)).status).toBe('confirmed');
        expect((await Appointment.findById(pastPending._id)).status).toBe('pending');
        expect((await Appointment.findById(pastCancelled._id)).status).toBe('cancelled');
    });

    it('records the completion in status history and is idempotent', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100 });
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed', appointmentDate: daysAgo(1), startTime: '09:00', endTime: '09:45' });

        expect(await runAutoComplete()).toBe(1);
        // A second sweep must not re-complete or duplicate history.
        expect(await runAutoComplete()).toBe(0);

        const doc = await Appointment.findById(appt._id);
        expect(doc.status).toBe('completed');
        const completions = doc.statusHistory.filter(h => h.status === 'completed');
        expect(completions).toHaveLength(1);
    });
});
