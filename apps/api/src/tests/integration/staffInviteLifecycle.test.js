/**
 * Staff invites as a set of independent emails (User.staffInvites):
 *  - every Send/Resend works until ONE is accepted (resend no longer kills the
 *    email a member has open)
 *  - legacy invites in passwordResetToken keep working
 *  - "Forgot password?" no longer touches invites
 *  - failures carry a code (EXPIRED / SUPERSEDED / ACCEPTED / REVOKED / INVALID)
 *  - renew / request answer identically and are per-account rate-limited
 */
const request = require('supertest');
const crypto = require('crypto');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendStaffInviteEmail: jest.fn().mockResolvedValue(true),
    sendStaffInviteOwnerReceipt: jest.fn().mockResolvedValue(true),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const TeamMember = require('../../models/TeamMember');
const {
    sendStaffInviteEmail, sendStaffInviteOwnerReceipt, sendPasswordResetEmail,
} = require('../../utils/emailService');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => {
    await new Promise((r) => setTimeout(r, 50));   // let fire-and-forget work settle
    await testDb.clearDatabase();
    jest.clearAllMocks();
});

const PASSWORD = 'Str0ng!Pass';
const sha = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return true; await sleep(20); }
    return fn();
};
const lastInviteToken = () => sendStaffInviteEmail.mock.calls[sendStaffInviteEmail.mock.calls.length - 1][3];

// Push every stored invite (and request-log entry) `ms` into the past, as if the
// owner had sent them that long ago — without touching their 7-day expiry unless asked.
const age = async (email, ms, { expire = false } = {}) => {
    const u = await User.findOne({ email }).select('+staffInvites +inviteRequestLog');
    u.staffInvites = u.staffInvites.map((e) => ({
        ...e.toObject(),
        sentAt: new Date(e.sentAt.getTime() - ms),
        expiresAt: expire ? new Date(Date.now() - 1000) : e.expiresAt,
    }));
    if (u.inviteRequestLog) u.inviteRequestLog = u.inviteRequestLog.map((d) => new Date(d.getTime() - ms));
    await u.save({ validateBeforeSave: false });
};

const setup = async (email = 'hire@test.com', name = 'New Hire', tier) => {
    const owner = await makeProvider({ name: 'Vido', businessProfile: { businessName: 'Vido Cuts' } });
    const member = await TeamMember.create({ provider: owner._id, name, email });
    const invite = async () => {
        const res = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner))
            .send(tier ? { tier } : {});
        expect(res.status).toBe(200);
        return { res, token: lastInviteToken() };
    };
    return { owner, member, email, invite };
};

const preview = (t) => request(app).get(`/api/auth/staff-invite/${t}`);
const accept = (t, password = PASSWORD) => request(app).post(`/api/auth/staff-invite/${t}/accept`).send({ password });

describe('several invite emails valid at once', () => {
    it('every earlier invite keeps working after a Resend, until one is accepted', async () => {
        const { email, invite } = await setup();
        const tokens = [];
        for (let i = 0; i < 4; i++) {
            tokens.push((await invite()).token);
            await age(email, 2 * 60 * 1000);            // past the 60s resend throttle
        }
        expect(new Set(tokens).size).toBe(4);
        for (const t of tokens) expect((await preview(t)).status).toBe(200);

        // The FIRST email works even though three newer ones were sent.
        const ok = await accept(tokens[0]);
        expect(ok.status).toBe(200);

        // Once one is accepted, the rest stop working — and say why.
        for (const t of tokens) {
            const p = await preview(t);
            expect(p.status).toBe(404);
            expect(p.body.code).toBe('INVITE_ACCEPTED');
            expect(p.body.message).toBe('This invite link is invalid or has expired.');
            expect(p.body.email).toBe(email);
        }
        const again = await accept(tokens[2]);
        expect(again.status).toBe(400);
        expect(again.body.code).toBe('INVITE_ACCEPTED');
    });

    it('a member who has the form open while the owner resends can still submit', async () => {
        const { invite, email } = await setup();
        const first = (await invite()).token;
        expect((await preview(first)).status).toBe(200);        // form is open
        await age(email, 2 * 60 * 1000);
        await invite();                                          // owner hits Resend
        const res = await accept(first);
        expect(res.status).toBe(200);
    });

    it('a second Send within 60s is answered as sent without another email', async () => {
        const { invite, email } = await setup();
        const first = await invite();
        const second = await invite();
        expect(second.res.body.data.throttled).toBe(true);
        expect(second.res.body.data.emailSent).toBe(true);
        expect(second.res.body.data.inviteSentAt).toBe(first.res.body.data.inviteSentAt);
        expect(sendStaffInviteEmail).toHaveBeenCalledTimes(1);
        const u = await User.findOne({ email }).select('+staffInvites');
        expect(u.staffInvites).toHaveLength(1);
    });

    it('a send that failed can be retried at once (no throttle)', async () => {
        const { invite } = await setup();
        sendStaffInviteEmail.mockResolvedValueOnce({ error: true });
        const first = await invite();
        expect(first.res.body.data.emailSent).toBe(false);
        const second = await invite();
        expect(second.res.body.data.throttled).toBeUndefined();
        expect(second.res.body.data.emailSent).toBe(true);
        expect(sendStaffInviteEmail).toHaveBeenCalledTimes(2);
    });

    it('never trims an owner invite that still works; drops dead ones down to 10', async () => {
        const { invite, email } = await setup();
        const tokens = [];
        for (let i = 0; i < 12; i++) { tokens.push((await invite()).token); await age(email, 2 * 60 * 1000); }
        let u = await User.findOne({ email }).select('+staffInvites');
        expect(u.staffInvites).toHaveLength(12);                 // all 12 still open
        for (const t of tokens) expect((await preview(t)).status).toBe(200);

        await age(email, 8 * 86400000, { expire: true });         // all 12 run out
        await invite();                                           // a 13th is sent
        u = await User.findOne({ email }).select('+staffInvites');
        expect(u.staffInvites).toHaveLength(10);
        expect((await preview(lastInviteToken())).status).toBe(200);
    });

    it('self-service sends can never push out the owner’s invite (12 requests, 13h apart)', async () => {
        const { invite, email } = await setup();
        const ownerToken = (await invite()).token;
        for (let i = 0; i < 12; i++) {
            await age(email, 13 * 3600 * 1000);                   // 13h later; still inside 7 days
            await request(app).post('/api/auth/staff-invite/request').send({ email });
            await waitFor(() => sendStaffInviteEmail.mock.calls.length === i + 2);
        }
        expect(sendStaffInviteEmail).toHaveBeenCalledTimes(13);
        const u = await User.findOne({ email }).select('+staffInvites');
        const self = u.staffInvites.filter((e) => e.source === 'self');
        expect(self.length).toBeLessThanOrEqual(5);
        expect(u.staffInvites.some((e) => e.source === 'owner')).toBe(true);
        // The email the owner sent still opens the form and can be accepted.
        expect((await preview(ownerToken)).status).toBe(200);
        expect((await accept(ownerToken)).status).toBe(200);
    });

    it('the roster shows when the pending invite was sent and until when it works — never a hash', async () => {
        const { owner, invite } = await setup();
        const { res } = await invite();
        const team = await request(app).get('/api/team').set(authHeader(owner));
        expect(team.status).toBe(200);
        const row = team.body.data[0];
        expect(row.inviteSentAt).toBe(res.body.data.inviteSentAt);
        expect(row.inviteExpiresAt).toBe(res.body.data.inviteExpiresAt);
        expect(JSON.stringify(team.body)).not.toMatch(/staffInvites|"hash"/);
    });
});

describe('legacy invites (emailed before staffInvites existed)', () => {
    const legacyStaff = async (expiry) => {
        const owner = await makeProvider({ name: 'Vido' });
        const raw = crypto.randomBytes(32).toString('hex');
        const user = await User.create({
            name: 'Old Invite', email: 'legacy@test.com', phone: '+15550003000', role: 'staff', accountType: 'business',
            staffOf: owner._id, staffTier: 'low', provider: 'local', isVerified: true,
            passwordResetToken: sha(raw), passwordResetExpiry: expiry,
        });
        return { owner, user, raw };
    };

    it('still previews and accepts', async () => {
        const { raw } = await legacyStaff(new Date(Date.now() + 86400000));
        expect((await preview(raw)).status).toBe(200);
        const res = await accept(raw);
        expect(res.status).toBe(200);
        expect(res.body.data.user).not.toHaveProperty('staffTier');
        const u = await User.findOne({ email: 'legacy@test.com' }).select('+passwordResetToken');
        expect(u.passwordResetToken).toBeNull();
        expect((await accept(raw)).status).toBe(400);
    });

    it('an expired legacy invite says expired', async () => {
        const { raw } = await legacyStaff(new Date(Date.now() - 1000));
        const p = await preview(raw);
        expect(p.status).toBe(404);
        expect(p.body.code).toBe('INVITE_EXPIRED');
    });

    it('a legacy invite keeps working next to a newer staffInvites invite', async () => {
        const { owner, raw } = await legacyStaff(new Date(Date.now() + 86400000));
        const member = await TeamMember.create({ provider: owner._id, name: 'Old Invite', email: 'legacy@test.com' });
        const r = await request(app).post(`/api/team/${member._id}/invite`).set(authHeader(owner));
        expect(r.status).toBe(200);
        expect((await preview(raw)).status).toBe(200);
        expect((await preview(lastInviteToken())).status).toBe(200);
    });
});

describe('forgot password is independent of invites', () => {
    it('a pending member’s "Forgot password?" leaves their invite working and sends a fresh invite', async () => {
        const { invite, email } = await setup();
        const first = (await invite()).token;
        await age(email, 3 * 60 * 1000);                    // past the self-service cooldown
        const res = await request(app).post('/api/auth/forgot-password').send({ email, accountType: 'business' });
        expect(res.status).toBe(200);
        expect(await waitFor(() => sendStaffInviteEmail.mock.calls.length === 2)).toBe(true);
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
        expect((await preview(first)).status).toBe(200);    // the original still works
        expect((await preview(lastInviteToken())).status).toBe(200);
        const u = await User.findOne({ email }).select('+passwordResetToken');
        expect(u.passwordResetToken).toBeFalsy();
    });

    it('an active member gets a normal reset email; their used invite is untouched', async () => {
        const { invite, email } = await setup();
        const t = (await invite()).token;
        expect((await accept(t)).status).toBe(200);
        await request(app).post('/api/auth/forgot-password').send({ email, accountType: 'business' });
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
        expect((await preview(t)).body.code).toBe('INVITE_ACCEPTED');
    });
});

describe('failure codes', () => {
    it('INVITE_INVALID for an unknown token (preview 404 / accept 400)', async () => {
        const p = await preview('not-a-real-token');
        expect(p.status).toBe(404);
        expect(p.body).toEqual({ success: false, message: 'This invite link is invalid or has expired.', code: 'INVITE_INVALID' });
        const a = await accept('not-a-real-token');
        expect(a.status).toBe(400);
        expect(a.body.code).toBe('INVITE_INVALID');
    });

    it('INVITE_EXPIRED when the only invite is past its 7 days', async () => {
        const { invite, email } = await setup();
        const t = (await invite()).token;
        await age(email, 8 * 86400000, { expire: true });
        const p = await preview(t);
        expect(p.status).toBe(404);
        expect(p.body.code).toBe('INVITE_EXPIRED');
        expect((await accept(t)).body.code).toBe('INVITE_EXPIRED');
    });

    it('INVITE_SUPERSEDED (+newerSentAt) for an expired invite with a newer one out', async () => {
        const { invite, email } = await setup();
        const old = (await invite()).token;
        await age(email, 8 * 86400000, { expire: true });
        const { res } = await invite();
        const p = await preview(old);
        expect(p.status).toBe(404);
        expect(p.body.code).toBe('INVITE_SUPERSEDED');
        expect(p.body.newerSentAt).toBe(res.body.data.inviteSentAt);
    });

    it('INVITE_REVOKED once the member is archived; re-inviting does not revive old emails', async () => {
        const { owner, member, invite, email } = await setup();
        const old = (await invite()).token;
        const del = await request(app).delete(`/api/team/${member._id}`).set(authHeader(owner));
        expect(del.status).toBe(200);
        expect((await preview(old)).body.code).toBe('INVITE_REVOKED');
        const a = await accept(old);
        expect(a.status).toBe(400);
        expect(a.body.code).toBe('INVITE_REVOKED');
        const u = await User.findOne({ email }).select('+password');
        expect(u.password).toBeFalsy();

        await request(app).post(`/api/team/${member._id}/restore`).set(authHeader(owner));
        await age(email, 2 * 60 * 1000);
        const fresh = (await invite()).token;
        expect((await preview(old)).body.code).toBe('INVITE_REVOKED');
        expect((await accept(fresh)).status).toBe(200);
    });

    it('a member who accepted, was archived and re-invited can accept the new invite', async () => {
        const { owner, member, invite, email } = await setup();
        const first = (await invite()).token;
        expect((await accept(first)).status).toBe(200);
        await request(app).delete(`/api/team/${member._id}`).set(authHeader(owner));
        await request(app).post(`/api/team/${member._id}/restore`).set(authHeader(owner));
        const again = (await invite()).token;
        const p = await preview(again);
        expect(p.status).toBe(200);
        expect(p.body.data.returning).toBe(true);
        expect((await accept(again, 'Back!Again1')).status).toBe(200);
        expect((await preview(first)).body.code).toBe('INVITE_ACCEPTED');
        const login = await request(app).post('/api/auth/login').send({ email, password: 'Back!Again1', accountType: 'business' });
        expect(login.status).toBe(200);
    });

    it('an admin-suspended member still cannot accept (403), even with a fresh invite', async () => {
        const { invite, email } = await setup();
        const t = (await invite()).token;
        await User.updateOne({ email }, { $set: { isActive: false, deactivatedAt: null } });
        const res = await accept(t);
        expect(res.status).toBe(403);
        const u = await User.findOne({ email }).select('+staffInvites');
        expect(u.isActive).toBe(false);
        expect(u.staffInvites[0].usedAt).toBeNull();
    });

    it('two invites raced to accept: exactly one wins', async () => {
        const { invite, email } = await setup();
        const a = (await invite()).token;
        await age(email, 2 * 60 * 1000);
        const b = (await invite()).token;
        const [r1, r2] = await Promise.all([accept(a), accept(b, 'Other!Pass1')]);
        expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    });
});

describe('accept response: one member shape, no access level', () => {
    it.each(['basic', 'low', 'medium', 'high'])('an invite sent with an old tier %s still makes a plain member', async (tier) => {
        const { invite, owner } = await setup(`t-${tier}@test.com`, 'Tier Hire', tier);
        const res = await accept((await invite()).token);
        expect(res.status).toBe(200);
        expect(res.body.data.user).not.toHaveProperty('staffTier');
        expect(res.body.data.user).not.toHaveProperty('staffPermissions');
        expect(String(res.body.data.user.staffOf)).toBe(String(owner._id));
        const stored = await User.findOne({ email: `t-${tier}@test.com` });
        expect(stored.staffTier).toBeNull();
        // The fresh token works on /auth/profile straight away, with the same shape.
        const prof = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${res.body.data.token}`);
        expect(prof.status).toBe(200);
        expect(prof.body.data).not.toHaveProperty('staffTier');
        expect(prof.body.data).not.toHaveProperty('staffPermissions');
    });
});

describe('POST /staff-invite/:token/renew and /staff-invite/request', () => {
    const renew = (t) => request(app).post(`/api/auth/staff-invite/${t}/renew`);
    const ask = (email) => request(app).post('/api/auth/staff-invite/request').send({ email });

    it('answer identically whatever the token or address', async () => {
        const { invite, email } = await setup();
        const t = (await invite()).token;
        await age(email, 8 * 86400000, { expire: true });
        const bodies = [
            await renew(t), await renew('garbage-token'),
            await ask(email), await ask('nobody@nowhere.test'),
        ];
        for (const r of bodies) {
            expect(r.status).toBe(200);
            expect(r.body).toEqual(bodies[0].body);
        }
        expect(Object.keys(bodies[0].headers)).toEqual(expect.arrayContaining(Object.keys(bodies[1].headers).filter((h) => h !== 'date')));
    });

    it('renew mints a new invite to the address on file and sends the owner a receipt', async () => {
        const { invite, email, owner } = await setup();
        const t = (await invite()).token;
        await age(email, 8 * 86400000, { expire: true });
        jest.clearAllMocks();
        await renew(t);
        expect(await waitFor(() => sendStaffInviteEmail.mock.calls.length === 1)).toBe(true);
        expect(sendStaffInviteEmail.mock.calls[0][0]).toBe(email);
        expect((await preview(lastInviteToken())).status).toBe(200);
        expect(await waitFor(() => sendStaffInviteOwnerReceipt.mock.calls.length === 1)).toBe(true);
        expect(sendStaffInviteOwnerReceipt.mock.calls[0][0]).toBe(owner.email);
        expect(sendStaffInviteOwnerReceipt.mock.calls[0][4]).toEqual({ requestedByMember: true });
    });

    it('request by email works for a pending member; an active one gets a sign-in email', async () => {
        const { invite, email } = await setup();
        const t = (await invite()).token;
        await age(email, 3 * 60 * 1000);
        jest.clearAllMocks();
        await ask(email.toUpperCase());
        expect(await waitFor(() => sendStaffInviteEmail.mock.calls.length === 1)).toBe(true);

        await accept(t);
        await age(email, 3 * 60 * 1000);
        jest.clearAllMocks();
        await ask(email);
        expect(await waitFor(() => sendPasswordResetEmail.mock.calls.length === 1)).toBe(true);
        expect(sendStaffInviteEmail).not.toHaveBeenCalled();
    });

    it('rejects a malformed email with 400 (no lookup)', async () => {
        const r = await ask('not-an-email');
        expect(r.status).toBe(400);
    });

    it('is per-account rate limited: 2-minute cooldown, 5 per day', async () => {
        const { invite, email } = await setup();
        const t = (await invite()).token;
        // Within 2 minutes of the owner's own send: nothing.
        jest.clearAllMocks();
        await renew(t); await sleep(200);
        expect(sendStaffInviteEmail).not.toHaveBeenCalled();

        let sent = 0;
        for (let i = 0; i < 7; i++) {
            await age(email, 3 * 60 * 1000);
            await renew(t);
            await sleep(150);
            // Hammering inside the cooldown does nothing extra.
            await renew(t); await ask(email);
            await sleep(150);
            sent = sendStaffInviteEmail.mock.calls.length;
        }
        expect(sent).toBe(5);
        // The owner gets one receipt a day per member, not one per request.
        expect(sendStaffInviteOwnerReceipt).toHaveBeenCalledTimes(1);
    });

    it('never helps an archived or suspended member', async () => {
        const { owner, member, invite, email } = await setup();
        const t = (await invite()).token;
        await age(email, 3 * 60 * 1000);
        await User.updateOne({ email }, { $set: { isActive: false, deactivatedAt: null } });
        jest.clearAllMocks();
        await renew(t); await ask(email); await sleep(250);
        expect(sendStaffInviteEmail).not.toHaveBeenCalled();
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();

        await User.updateOne({ email }, { $set: { isActive: true } });
        await request(app).delete(`/api/team/${member._id}`).set(authHeader(owner));
        await renew(t); await ask(email); await sleep(250);
        expect(sendStaffInviteEmail).not.toHaveBeenCalled();
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
        expect(sendStaffInviteOwnerReceipt).not.toHaveBeenCalled();
    });
});

describe('invitesToDrop (retention rules)', () => {
    const { invitesToDrop } = require('../../utils/staffInvites');
    const NOW = Date.now();
    const e = (hash, source, sentAgoH, { expired = false, used = false, retired = false } = {}) => ({
        hash, source,
        sentAt: new Date(NOW - sentAgoH * 3600000),
        expiresAt: new Date(expired ? NOW - 1000 : NOW + 86400000),
        usedAt: used ? new Date(NOW) : null,
        retiredAt: retired ? new Date(NOW) : null,
    });

    it('keeps only the newest 5 open self-service links, never an open owner invite', () => {
        const list = [e('o1', 'owner', 100), ...Array.from({ length: 8 }, (_, i) => e(`s${i}`, 'self', 90 - i))];
        expect(invitesToDrop(list, NOW).sort()).toEqual(['s0', 's1', 's2']);
    });

    it('drops dead entries (oldest first) before anything open, and keeps the newest used one', () => {
        const list = [
            e('u-old', 'owner', 60, { used: true, retired: true }), e('u-new', 'owner', 50, { used: true }),
            ...Array.from({ length: 6 }, (_, i) => e(`x${i}`, 'owner', 40 - i, { expired: true })),
            ...Array.from({ length: 5 }, (_, i) => e(`o${i}`, 'owner', 10 - i)),
        ];
        const drop = invitesToDrop(list, NOW);
        expect(list.length - drop.length).toBe(10);
        expect(drop).not.toContain('u-new');
        expect(drop.some((h) => h.startsWith('o'))).toBe(false);
        expect(drop).toEqual(['u-old', 'x0', 'x1']);
    });

    it('treats entries stored before `source` existed as owner sends', () => {
        const list = Array.from({ length: 12 }, (_, i) => ({ ...e(`l${i}`, undefined, 20 - i) }));
        expect(invitesToDrop(list, NOW)).toEqual([]);
    });
});
