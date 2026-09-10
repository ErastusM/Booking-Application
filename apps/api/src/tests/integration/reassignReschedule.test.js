/**
 * Provider reschedule can REASSIGN the performer (backend for drag-to-reassign).
 *
 * PUT /api/appointments/:id/provider-reschedule accepts an optional teamMember.
 * When it changes the performer the new member is validated explicitly — on the
 * owner's roster, active, bookable, and performs the service — and the
 * conflict/race checks scope to the destination member (so a lost race rolls the
 * booking back onto its ORIGINAL member, no double-book). Owner-only;
 * single-service only. This suite pins:
 *   - a valid reassign persists the new performer
 *   - a non-performer is refused
 *   - a target already booked at that time is refused (no double-book)
 *   - a multi-service booking is refused (segment reassign is out of scope)
 *   - reassigning to the owner column (unassigned) clears teamMember
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Appointment = require('../../models/Appointment');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// 3 days out (past the default cancellation window), a fixed clock time.
const dateStr = () => { const d = new Date(); d.setDate(d.getDate() + 3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATE = dateStr();

const reschedule = (as, id, body) =>
    request(app).put(`/api/appointments/${id}/provider-reschedule`).set(authHeader(as)).send(body);

const setup = async () => {
    const provider = await makeProvider();
    const svc = await makeService(provider._id, { duration: 30 });
    const customer = await makeUser();
    // A member who performs everything (bookable, active).
    const doer = await TeamMember.create({ provider: provider._id, name: 'Doer', offersAllServices: true });
    const appt = await makeAppointment(customer._id, svc._id, provider._id, {
        teamMember: null, appointmentDate: new Date(DATE), startTime: '14:00', endTime: '14:30',
    });
    return { provider, svc, customer, doer, appt };
};

describe('provider-reschedule reassignment', () => {
    it('reassigns a single-service booking to a member who performs it', async () => {
        const { provider, doer, appt } = await setup();
        const res = await reschedule(provider, appt._id, { appointmentDate: DATE, startTime: '14:00', teamMember: String(doer._id) });
        expect(res.status).toBe(200);
        expect(String(res.body.data.teamMember)).toBe(String(doer._id));
        expect(String((await Appointment.findById(appt._id)).teamMember)).toBe(String(doer._id));
    });

    it('refuses a member who does not perform the service', async () => {
        const { provider, appt } = await setup();
        // offersAllServices:false + empty services = performs nothing.
        const nonPerformer = await TeamMember.create({ provider: appt.provider, name: 'Desk', offersAllServices: false, services: [] });
        const res = await reschedule(provider, appt._id, { appointmentDate: DATE, startTime: '14:00', teamMember: String(nonPerformer._id) });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/doesn't perform this service/i); // refused for the RIGHT reason
        expect(String((await Appointment.findById(appt._id)).teamMember || '')).toBe(''); // unchanged (still owner column)
    });

    it('refuses a member who is not bookable (e.g. a receptionist)', async () => {
        const { provider, appt } = await setup();
        const desk = await TeamMember.create({ provider: appt.provider, name: 'Reception', offersAllServices: true, bookable: false });
        const res = await reschedule(provider, appt._id, { appointmentDate: DATE, startTime: '14:00', teamMember: String(desk._id) });
        expect(res.status).toBe(400);
        expect(String((await Appointment.findById(appt._id)).teamMember || '')).toBe(''); // unchanged
    });

    it('refuses reassigning onto a member already booked at that time (no double-book)', async () => {
        const { provider, svc, doer, appt } = await setup();
        const other = await makeUser();
        // Doer already has a booking overlapping 14:00.
        await makeAppointment(other._id, svc._id, provider._id, {
            teamMember: doer._id, appointmentDate: new Date(DATE), startTime: '14:00', endTime: '14:30',
        });
        const res = await reschedule(provider, appt._id, { appointmentDate: DATE, startTime: '14:00', teamMember: String(doer._id) });
        expect(res.status).toBe(400);
    });

    it('refuses reassigning a multi-service booking', async () => {
        const { provider, svc, customer } = await setup();
        const doer = await TeamMember.create({ provider: provider._id, name: 'Doer2', offersAllServices: true });
        const multi = await makeAppointment(customer._id, svc._id, provider._id, {
            teamMember: null, appointmentDate: new Date(DATE), startTime: '15:00', endTime: '15:30',
            services: [{ service: svc._id, teamMember: null, startTime: '15:00', endTime: '15:30', price: 50 }],
        });
        const res = await reschedule(provider, multi._id, { appointmentDate: DATE, startTime: '15:00', teamMember: String(doer._id) });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/one service at a time/i);
    });

    it('reassigning to the owner column (unassigned) clears the performer', async () => {
        const { provider, svc, customer, doer } = await setup();
        const assigned = await makeAppointment(customer._id, svc._id, provider._id, {
            teamMember: doer._id, appointmentDate: new Date(DATE), startTime: '16:00', endTime: '16:30',
        });
        const res = await reschedule(provider, assigned._id, { appointmentDate: DATE, startTime: '16:00', teamMember: '' });
        expect(res.status).toBe(200);
        expect(res.body.data.teamMember == null).toBe(true);
    });

    it('a plain reschedule with no teamMember leaves the performer untouched', async () => {
        const { provider, svc, customer, doer } = await setup();
        const assigned = await makeAppointment(customer._id, svc._id, provider._id, {
            teamMember: doer._id, appointmentDate: new Date(DATE), startTime: '11:00', endTime: '11:30',
        });
        const res = await reschedule(provider, assigned._id, { appointmentDate: DATE, startTime: '12:00' });
        expect(res.status).toBe(200);
        expect(String(res.body.data.teamMember)).toBe(String(doer._id)); // unchanged
    });
});
