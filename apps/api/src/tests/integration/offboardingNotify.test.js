/**
 * Offboarding client-notify: permanently removing a team member hard-deletes
 * their upcoming bookings (see removeTeamMember). Without a notice those
 * bookings simply vanish from the client's side. This pins that each affected
 * client is told — an in-app notification for a registered account, and the
 * response reports how many were notified — while completed/paid history is
 * kept and never triggers a spurious "cancelled" notice.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Appointment = require('../../models/Appointment');
const Notification = require('../../models/Notification');

// Capture the cancellation email so we can assert it was attempted per client.
const cancelMock = jest.fn().mockResolvedValue(true);
jest.mock('../../utils/emailService', () => new Proxy({}, {
    get: (_t, prop) => (prop === 'sendAppointmentCancelled' ? cancelMock : jest.fn().mockResolvedValue(true)),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

const future = (d = 3) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(0, 0, 0, 0); return x; };
const past = (d = 3) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(0, 0, 0, 0); return x; };

describe('offboarding client-notify — permanent removal', () => {
    it('notifies the client of an upcoming booking and reports the count', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const member = await TeamMember.create({ provider: provider._id, name: 'Moses' });
        const customer = await makeUser({ email: 'client@test.com', name: 'Client One' });
        const upcoming = await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'confirmed', appointmentDate: future(), startTime: '10:00', endTime: '10:30',
        });

        const res = await request(app)
            .delete(`/api/team/${member._id}/permanent`)
            .set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.notified).toBe(1);

        // The upcoming booking is gone…
        expect(await Appointment.findById(upcoming._id)).toBeNull();
        // …and the client got an in-app appointment notification + a cancel email.
        const notes = await Notification.find({ user: customer._id, type: 'appointment' });
        expect(notes.length).toBeGreaterThanOrEqual(1);
        expect(cancelMock).toHaveBeenCalledWith('client@test.com', 'Client One', expect.any(String), expect.any(String));
    });

    it('does not notify for completed/paid history (which is kept, not cancelled)', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const member = await TeamMember.create({ provider: provider._id, name: 'Moses' });
        const customer = await makeUser({ email: 'c2@test.com', name: 'Client Two' });
        const completed = await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'completed', totalPrice: 200, appointmentDate: past(), startTime: '09:00', endTime: '09:30',
        });

        const res = await request(app)
            .delete(`/api/team/${member._id}/permanent`)
            .set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.notified).toBe(0);            // nothing cancelled → nobody notified
        expect(cancelMock).not.toHaveBeenCalled();

        // Completed history survives, flagged as former staff.
        const kept = await Appointment.findById(completed._id);
        expect(kept).not.toBeNull();
        expect(kept.staffRemoved).toBe(true);
    });

    it('counts only bookings with a reachable client (a walk-in with no contact is skipped)', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const member = await TeamMember.create({ provider: provider._id, name: 'Moses' });
        // A walk-in booking with no customer account and no email.
        await makeAppointment(null, service._id, provider._id, {
            teamMember: member._id, status: 'confirmed', appointmentDate: future(), startTime: '11:00', endTime: '11:30',
            walkInName: 'Passer By',
        });

        const res = await request(app)
            .delete(`/api/team/${member._id}/permanent`)
            .set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.notified).toBe(0);
        expect(cancelMock).not.toHaveBeenCalled();
    });
});
