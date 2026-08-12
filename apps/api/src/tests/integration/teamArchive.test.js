/**
 * Archiving a team member instead of deleting them.
 *
 * Appointments, earnings and reviews all reference the TeamMember _id, so a
 * hard delete stripped the staff member's name off every booking they had ever
 * done and broke per-staff reporting — the business lost its own records the
 * moment someone left. These pin the two halves of the fix: the history
 * survives, and their working life here still ends.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Appointment = require('../../models/Appointment');
const User = require('../../models/User');
const { resolveBookingStaff } = require('../../utils/staffBooking');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const service = await makeService(provider._id);
    const member = await TeamMember.create({ provider: provider._id, name: 'Moses Hamalwa', role: 'Barber' });
    return { provider, customer, service, member };
};

describe('archiving a team member', () => {
    it('keeps the roster row so past bookings still resolve their staff', async () => {
        const { provider, customer, service, member } = await setup();
        const appt = await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'completed',
        });

        const res = await request(app).delete(`/api/team/${member._id}`).set(authHeader(provider));
        expect(res.status).toBe(200);

        // The row is still there — this is the whole point.
        const after = await TeamMember.findById(member._id);
        expect(after).not.toBeNull();
        expect(after.name).toBe('Moses Hamalwa');
        expect(after.isActive).toBe(false);
        expect(after.archivedAt).toBeInstanceOf(Date);

        // And the completed booking can still say who did it.
        const booking = await Appointment.findById(appt._id).populate('teamMember', 'name');
        expect(booking.teamMember).not.toBeNull();
        expect(booking.teamMember.name).toBe('Moses Hamalwa');
    });

    // Drives the real resolver rather than re-running its query here: asserting
    // `TeamMember.find({isActive:true})` from the test only proves Mongo can
    // filter, and would still pass with the isActive filter deleted from
    // utils/staffBooking — the very line it claims to cover.
    it('stops them taking new bookings', async () => {
        const { provider, customer, service, member } = await setup();
        await request(app).delete(`/api/team/${member._id}`).set(authHeader(provider));

        const res = await resolveBookingStaff({
            svc: service, providerId: provider._id, appointmentDate: '2026-09-16',
            startTime: '10:00', endTime: '10:30',
            requestedTeamMember: member._id, requester: { role: 'customer', _id: customer._id },
        });

        expect(res.teamMember).toBeUndefined();
        expect(res.error).toMatch(/unknown team member/i);
    });

    it('clears the refresh-token list as well as the access tokens', async () => {
        const { provider, member } = await setup();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id, email: 'moses-jti@test.com' });
        await User.updateOne({ _id: staff._id }, { $set: { refreshTokenJtis: ['a', 'b'] } });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: staff._id } });

        await request(app).delete(`/api/team/${member._id}`).set(authHeader(provider));

        // `refreshTokenJtis` is `select: false`, so it has to be asked for
        // explicitly — reading it off a plain findById returns undefined and the
        // assertion passes or fails for the wrong reason.
        const after = await User.findById(staff._id).select('+refreshTokenJtis');
        // Bumping tokenVersion alone would leave refresh working.
        expect(after.refreshTokenJtis).toEqual([]);
    });

    it('still revokes their login', async () => {
        const { provider, member } = await setup();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id, email: 'moses@test.com' });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: staff._id } });
        const versionBefore = staff.tokenVersion || 0;

        await request(app).delete(`/api/team/${member._id}`).set(authHeader(provider));

        const after = await User.findById(staff._id);
        expect(after.tokenVersion).toBeGreaterThan(versionBefore);
        expect(after.staffOf ?? null).toBeNull();
    });

    it('refuses to archive another provider\'s member', async () => {
        const { member } = await setup();
        const intruder = await makeProvider();

        const res = await request(app).delete(`/api/team/${member._id}`).set(authHeader(intruder));

        expect(res.status).toBe(404);
        expect((await TeamMember.findById(member._id)).isActive).toBe(true);
    });
});

describe('restoring an archived member', () => {
    it('puts them back on the roster', async () => {
        const { provider, member } = await setup();
        await request(app).delete(`/api/team/${member._id}`).set(authHeader(provider));

        const res = await request(app).post(`/api/team/${member._id}/restore`).set(authHeader(provider));

        expect(res.status).toBe(200);
        const after = await TeamMember.findById(member._id);
        expect(after.isActive).toBe(true);
        expect(after.archivedAt).toBeNull();
    });

    // Archiving revoked their tokens and severed staffOf. Handing that back
    // silently would make archiving a weaker action than it appears; re-inviting
    // is the explicit way to restore access.
    it('does not hand their login back', async () => {
        const { provider, member } = await setup();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id, email: 'moses2@test.com' });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: staff._id } });

        await request(app).delete(`/api/team/${member._id}`).set(authHeader(provider));
        await request(app).post(`/api/team/${member._id}/restore`).set(authHeader(provider));

        const after = await User.findById(staff._id);
        expect(after.staffOf ?? null).toBeNull();
    });

    // The recovery path the restore doc comment promises. It used to be a dead
    // end: archive left member.user set, so invite refused "already has a login"
    // while permissions 404'd on the severed staffOf — the email was permanently
    // unusable as a staff login without DB surgery.
    it('can be re-invited after archive and restore', async () => {
        const { provider, member } = await setup();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id, email: 'moses-reinvite@test.com' });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: staff._id } });

        await request(app).delete(`/api/team/${member._id}`).set(authHeader(provider));
        await request(app).post(`/api/team/${member._id}/restore`).set(authHeader(provider));

        const res = await request(app)
            .post(`/api/team/${member._id}/invite`)
            .set(authHeader(provider))
            .send({ email: 'moses-reinvite@test.com' });

        expect(res.status).toBe(200);
        // Relinked and working for this business again.
        const relinked = await User.findById(staff._id);
        expect(relinked.staffOf.toString()).toBe(provider._id.toString());
        expect((await TeamMember.findById(member._id)).user.toString()).toBe(staff._id.toString());
    });

    // Re-attaching a severed link must not become a way to claim any account
    // that happens to share the email.
    it('still refuses an email belonging to somebody else', async () => {
        const { provider, member } = await setup();
        await makeUser({ role: 'customer', email: 'stranger@test.com' });

        const res = await request(app)
            .post(`/api/team/${member._id}/invite`)
            .set(authHeader(provider))
            .send({ email: 'stranger@test.com' });

        expect(res.status).toBe(409);
    });

    it('refuses another provider\'s member', async () => {
        const { provider, member } = await setup();
        await request(app).delete(`/api/team/${member._id}`).set(authHeader(provider));
        const intruder = await makeProvider();

        const res = await request(app).post(`/api/team/${member._id}/restore`).set(authHeader(intruder));

        expect(res.status).toBe(404);
        expect((await TeamMember.findById(member._id)).isActive).toBe(false);
    });
});
