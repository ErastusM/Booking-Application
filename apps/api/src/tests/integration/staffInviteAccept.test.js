/**
 * Fresha-style staff invite acceptance (public):
 *   GET  /api/auth/staff-invite/:token          → preview who + which business
 *   POST /api/auth/staff-invite/:token/accept    → set password + sign straight in
 *
 * The invite itself is minted by POST /api/team/:id/invite; these tests drive
 * the acceptance half, reading the raw token from the mocked invite email.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendStaffInviteEmail: jest.fn().mockResolvedValue(true),
    sendStaffInviteOwnerReceipt: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const TeamMember = require('../../models/TeamMember');
const { sendStaffInviteEmail, sendStaffInviteOwnerReceipt } = require('../../utils/emailService');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

// Invite a fresh member and return the raw set-password token the email carried.
const inviteAndToken = async (owner, email = 'newhire@test.com', name = 'New Hire') => {
    const member = await TeamMember.create({ provider: owner._id, name, email });
    const res = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
    expect(res.status).toBe(200);
    const rawToken = sendStaffInviteEmail.mock.calls[0][3];
    expect(rawToken).toBeTruthy();
    return { member, rawToken, email, name };
};

describe('GET /api/auth/staff-invite/:token', () => {
    it('previews the invitee and the inviting business', async () => {
        const owner = await makeProvider({ name: 'Vido' });
        const { rawToken, email, name } = await inviteAndToken(owner);

        const res = await request(app).get(`/api/auth/staff-invite/${rawToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.valid).toBe(true);
        expect(res.body.data.name).toBe(name);
        expect(res.body.data.email).toBe(email);
        expect(res.body.data.businessName).toBe('Vido');
        expect(res.body.data.returning).toBe(false);
    });

    it('404s an unknown or garbage token', async () => {
        const res = await request(app).get('/api/auth/staff-invite/not-a-real-token');
        expect(res.status).toBe(404);
    });
});

describe('POST /api/auth/staff-invite/:token/accept', () => {
    it('sets the password and returns a signed-in session', async () => {
        const owner = await makeProvider({ name: 'Vido' });
        const { rawToken, email } = await inviteAndToken(owner);

        const res = await request(app)
            .post(`/api/auth/staff-invite/${rawToken}/accept`)
            .send({ password: 'Str0ng!Pass' });

        expect(res.status).toBe(200);
        // Auto-login: a real session comes back, not just a success flag.
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.data.refreshToken).toBeTruthy();
        expect(res.body.data.user.email).toBe(email);
        expect(res.body.data.user.role).toBe('staff');
        // Refresh cookie is set so the sibling-app SSO bootstrap works too.
        expect(res.headers['set-cookie'].join(';')).toMatch(/bp_rt=/);

        // Token is consumed, mailbox proven, account active.
        const user = await User.findOne({ email }).select('+passwordResetToken');
        expect(user.passwordResetToken).toBeNull();
        expect(user.isVerified).toBe(true);
        expect(user.isActive).toBe(true);
        expect(user.lastLoginAt).toBeTruthy();

        // The password now actually works on the normal login.
        const login = await request(app)
            .post('/api/auth/login')
            .send({ email, password: 'Str0ng!Pass', accountType: 'business' });
        expect(login.status).toBe(200);
    });

    it('rejects a weak password without consuming the token', async () => {
        const owner = await makeProvider();
        const { rawToken, email } = await inviteAndToken(owner);

        const res = await request(app)
            .post(`/api/auth/staff-invite/${rawToken}/accept`)
            .send({ password: 'weak' });
        expect(res.status).toBe(400);

        // Token still valid — they can retry with a strong password.
        const user = await User.findOne({ email }).select('+passwordResetToken');
        expect(user.passwordResetToken).toBeTruthy();
        expect(user.lastLoginAt).toBeFalsy();
    });

    it('rejects an invalid token', async () => {
        const res = await request(app)
            .post('/api/auth/staff-invite/bogus/accept')
            .send({ password: 'Str0ng!Pass' });
        expect(res.status).toBe(400);
    });

    it('refuses a stale invite once the member has been archived (staffOf severed)', async () => {
        const owner = await makeProvider();
        const { rawToken, email } = await inviteAndToken(owner);
        // Archiving severs the business link but leaves the invite token intact.
        await User.updateOne({ email }, { $set: { staffOf: null } });

        const res = await request(app)
            .post(`/api/auth/staff-invite/${rawToken}/accept`)
            .send({ password: 'Str0ng!Pass' });
        expect(res.status).toBe(400);

        // The archived account was not reactivated or given a password.
        const user = await User.findOne({ email }).select('+password');
        expect(user.lastLoginAt).toBeFalsy();
    });

    it('refuses to reactivate an admin-suspended account', async () => {
        const owner = await makeProvider();
        const { rawToken, email } = await inviteAndToken(owner);
        // Admin suspension = isActive:false with NO deactivatedAt (distinct from
        // a self-deactivation, which login/accept are allowed to reverse).
        await User.updateOne({ email }, { $set: { isActive: false, deactivatedAt: null } });

        const res = await request(app)
            .post(`/api/auth/staff-invite/${rawToken}/accept`)
            .send({ password: 'Str0ng!Pass' });
        expect(res.status).toBe(403);

        const user = await User.findOne({ email });
        expect(user.isActive).toBe(false); // still suspended
        expect(user.lastLoginAt).toBeFalsy();
    });

    it('cannot be reused once accepted', async () => {
        const owner = await makeProvider();
        const { rawToken } = await inviteAndToken(owner);

        const first = await request(app)
            .post(`/api/auth/staff-invite/${rawToken}/accept`)
            .send({ password: 'Str0ng!Pass' });
        expect(first.status).toBe(200);

        const second = await request(app)
            .post(`/api/auth/staff-invite/${rawToken}/accept`)
            .send({ password: 'An0ther!Pass' });
        expect(second.status).toBe(400);
    });
});

describe('owner audit receipt', () => {
    it('emails the owner a confirmation when they invite someone', async () => {
        const owner = await makeProvider({ name: 'Vido' });
        await inviteAndToken(owner, 'audit@test.com', 'Audit Hire');

        expect(sendStaffInviteOwnerReceipt).toHaveBeenCalledTimes(1);
        const [ownerEmail, memberName, memberEmail] = sendStaffInviteOwnerReceipt.mock.calls[0];
        expect(ownerEmail).toBe(owner.email);
        expect(memberName).toBe('Audit Hire');
        expect(memberEmail).toBe('audit@test.com');
    });
});
