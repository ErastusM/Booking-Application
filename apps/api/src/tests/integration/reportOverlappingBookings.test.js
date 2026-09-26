/**
 * The read-only deploy report (scripts/report_overlapping_bookings.js): how many
 * upcoming bookings overlap another booking of the same person, per business id.
 * It must count exactly the double bookings the booking rule forbids — not
 * touching bookings, not colleagues at the same time, not the rows of one group
 * — print counts and ids only, and change nothing.
 */
const { futureDate } = require('../helpers/dates');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService, makeAppointment } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Appointment = require('../../models/Appointment');
const { countOverlaps, reportOverlappingBookings, report } = require('../../../scripts/report_overlapping_bookings');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const day = new Date(`${futureDate(0)}T00:00:00.000Z`);

describe('deploy report: overlapping bookings per business (read-only, counts only)', () => {
    it('counts bookings that overlap another of the same person; touching, colleagues and group rows do not count', () => {
        const d = new Date('2030-01-02T00:00:00.000Z');
        const A = 'biz-a'; const B = 'biz-b';
        const out = countOverlaps([
            { _id: 1, provider: A, appointmentDate: d, teamMember: 'm1', startTime: '14:00', endTime: '15:00' },
            { _id: 2, provider: A, appointmentDate: d, teamMember: 'm1', startTime: '14:30', endTime: '16:00' }, // overlaps 1
            { _id: 3, provider: A, appointmentDate: d, teamMember: 'm1', startTime: '16:00', endTime: '17:00' }, // touches 2
            { _id: 4, provider: A, appointmentDate: d, teamMember: 'm2', startTime: '15:30', endTime: '16:30' }, // a colleague, same time as 2
            { _id: 5, provider: A, appointmentDate: d, teamMember: null, startTime: '09:00', endTime: '10:00', groupId: 'g' },
            { _id: 6, provider: A, appointmentDate: d, teamMember: null, startTime: '09:00', endTime: '10:00', groupId: 'g' },
            // A segment of m2's ticket on m1 at 14:45 overlaps 1 and 2.
            { _id: 7, provider: A, appointmentDate: d, teamMember: 'm2', startTime: '13:45', endTime: '15:15',
                services: [{ teamMember: 'm2', startTime: '13:45', endTime: '14:45' }, { teamMember: 'm1', startTime: '14:45', endTime: '15:15' }] },
            { _id: 8, provider: B, appointmentDate: d, teamMember: null, startTime: '10:00', endTime: '11:00' },
        ]);
        expect(out).toEqual({ [A]: 3 });
    });

    it('reads upcoming pending/confirmed bookings and prints ids and counts only', async () => {
        const provider = await makeProvider({ name: 'Vido Barber' });
        const cut = await makeService(provider._id, { name: 'Cut', duration: 60 });
        const erastus = await TeamMember.create({ provider: provider._id, name: 'Erastus' });
        const seed = (startTime, endTime, status = 'confirmed') => makeAppointment(null, cut._id, provider._id, {
            walkInName: 'Existing', teamMember: erastus._id, appointmentDate: day, startTime, endTime, status,
        });
        await seed('14:00', '15:00');
        await seed('14:30', '16:00', 'pending');
        await seed('14:00', '16:00', 'cancelled');
        // In the past: not upcoming, never counted.
        await makeAppointment(null, cut._id, provider._id, {
            walkInName: 'Existing', teamMember: erastus._id, appointmentDate: new Date(Date.now() - 7 * 864e5), startTime: '14:00', endTime: '15:00', status: 'confirmed',
        });
        await makeAppointment(null, cut._id, provider._id, {
            walkInName: 'Existing', teamMember: erastus._id, appointmentDate: new Date(Date.now() - 7 * 864e5), startTime: '14:00', endTime: '15:00', status: 'confirmed',
        });
        const before = await Appointment.countDocuments();
        const r = await reportOverlappingBookings();
        expect(r.byBusiness).toEqual({ [String(provider._id)]: 2 });
        const lines = report(r).join('\n');
        expect(lines).toContain(`business ${provider._id}: 2`);
        expect(lines).not.toMatch(/Existing|Erastus|Vido|@/);
        expect(await Appointment.countDocuments()).toBe(before); // read-only
    });
});
