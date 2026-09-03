/**
 * Permanent removal (DELETE /api/team/:id/permanent) — the terminal counterpart
 * to archive. When a member leaves for good, everything involving them is
 * purged: the roster row, their upcoming bookings, schedule, shifts, time off,
 * personal blocks and login. The ONE thing kept is money that already changed
 * hands — completed or paid appointments survive, snapshotted as "former staff"
 * so earnings and the client's own record stay intact.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Appointment = require('../../models/Appointment');
const StaffAvailability = require('../../models/StaffAvailability');
const Shift = require('../../models/Shift');
const TimeOff = require('../../models/TimeOff');
const BlockedTime = require('../../models/BlockedTime');
const User = require('../../models/User');
const { resolveBookingStaff } = require('../../utils/staffBooking');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => {
    const s = {};
    DAYS.forEach((d) => { s[d] = { enabled: true, slots: [{ start, end }] }; });
    return s;
};

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const service = await makeService(provider._id, { price: 100, duration: 60 });
    const member = await TeamMember.create({ provider: provider._id, name: 'Erastus M', role: 'Barber' });
    await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: everyDay('08:00', '17:00') });
    await Shift.create({ provider: provider._id, teamMember: member._id, date: '2026-09-16', slots: [{ start: '08:00', end: '12:00' }], breaks: [] });
    await TimeOff.create({ provider: provider._id, teamMember: member._id, startDate: '2026-09-20', endDate: '2026-09-22', type: 'vacation', status: 'approved' });
    await BlockedTime.create({ provider: provider._id, teamMember: member._id, date: '2026-09-16', startTime: '13:00', endTime: '14:00' });
    return { provider, customer, service, member };
};

const remove = (provider, member) => request(app)
    .delete(`/api/team/${member._id}/permanent`).set(authHeader(provider));

describe('permanently removing a team member', () => {
    it('deletes the roster row and everything operational tied to them', async () => {
        const { provider, customer, service, member } = await setup();
        const upcoming = await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'confirmed', paymentStatus: 'unpaid',
        });

        const res = await remove(provider, member);
        expect(res.status).toBe(200);

        expect(await TeamMember.findById(member._id)).toBeNull();
        expect(await StaffAvailability.findOne({ teamMember: member._id })).toBeNull();
        expect(await Shift.findOne({ teamMember: member._id })).toBeNull();
        expect(await TimeOff.findOne({ teamMember: member._id })).toBeNull();
        expect(await BlockedTime.findOne({ teamMember: member._id })).toBeNull();
        // The upcoming, unpaid booking is purged.
        expect(await Appointment.findById(upcoming._id)).toBeNull();
    });

    it('keeps completed AND paid history, snapshotted as "former staff"', async () => {
        const { provider, customer, service, member } = await setup();
        const done = await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'completed', totalPrice: 100,
        });
        const paidUpcoming = await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'confirmed', paymentStatus: 'paid', totalPrice: 100,
        });

        expect((await remove(provider, member)).status).toBe(200);

        for (const id of [done._id, paidUpcoming._id]) {
            const kept = await Appointment.findById(id);
            expect(kept).not.toBeNull();               // money is preserved
            expect(kept.totalPrice).toBe(100);         // earnings intact
            expect(kept.staffRemoved).toBe(true);
            expect(kept.formerStaffName).toBe('Erastus M'); // name survives the row
        }
    });

    it('ends the linked login (staffOf severed, tokens bumped)', async () => {
        const { provider, member } = await setup();
        const staffUser = await makeUser({ role: 'staff', staffOf: provider._id, tokenVersion: 0 });
        member.user = staffUser._id;
        await member.save();

        expect((await remove(provider, member)).status).toBe(200);

        const after = await User.findById(staffUser._id);
        expect(after).not.toBeNull();          // the account itself is kept
        expect(after.staffOf).toBeNull();      // but its link to this business is gone
        expect(after.tokenVersion).toBe(1);    // and every issued token is invalidated
    });

    it('stops them taking new bookings (the row is really gone)', async () => {
        const { provider, customer, service, member } = await setup();
        expect((await remove(provider, member)).status).toBe(200);

        const res = await resolveBookingStaff({
            svc: service, providerId: provider._id, appointmentDate: '2026-09-16',
            startTime: '10:00', endTime: '10:30',
            requestedTeamMember: member._id, requester: { role: 'customer', _id: customer._id },
        });
        expect(res.teamMember).toBeUndefined();
    });

    it("won't remove another business's member", async () => {
        const { member } = await setup();
        const intruder = await makeProvider();
        expect((await remove(intruder, member)).status).toBe(404);
        expect(await TeamMember.findById(member._id)).not.toBeNull();
    });
});
