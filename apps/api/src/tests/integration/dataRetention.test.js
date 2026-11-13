/**
 * Nightly data-retention sweep (compliance audit point 9). Periods come from
 * constants/retention.js, the numbers the Privacy Policy quotes.
 */
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment } = require('../helpers/factories');
const User = require('../../models/User');
const Appointment = require('../../models/Appointment');
const Notification = require('../../models/Notification');
const Service = require('../../models/Service');
const Event = require('../../models/Event');
const { RETENTION, DAY } = require('../../constants/retention');
const { runRetentionSweep } = require('../../utils/dataRetentionService');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const ago = (days) => new Date(Date.now() - days * DAY);
// createdAt/updatedAt are managed by mongoose; age a document with a raw write.
const age = (Model, id, fields) => Model.collection.updateOne({ _id: id }, { $set: fields });

it('periods are defined in one place, and the analytics TTL index uses them', () => {
    expect(RETENTION).toMatchObject({
        ANALYTICS_EVENTS_DAYS: expect.any(Number), CLIENT_ERROR_LOG_DAYS: expect.any(Number),
        GUEST_CONTACT_MONTHS: 24,
    });
    expect(RETENTION.UNVERIFIED_ACCOUNT_DAYS).toBeUndefined();
    const ttl = Event.schema.indexes().find(([k, o]) => k.createdAt === 1 && o.expireAfterSeconds);
    expect(ttl[1].expireAfterSeconds).toBe(RETENTION.ANALYTICS_EVENTS_DAYS * DAY / 1000);
});

it('deletes old notifications and keeps recent ones', async () => {
    const u = await makeUser();
    const old = await Notification.create({ user: u._id, message: 'old', type: 'general' });
    await Notification.create({ user: u._id, message: 'new', type: 'general' });
    await age(Notification, old._id, { createdAt: ago(RETENTION.NOTIFICATIONS_DAYS + 1) });
    const r = await runRetentionSweep();
    expect(r.notificationsDeleted).toBe(1);
    expect((await Notification.find({ user: u._id })).map((n) => n.message)).toEqual(['new']);
});

it('clears expired password-reset, verification and OAuth tokens, and dead sessions — not live ones', async () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 3600e3);
    const a = await makeUser({ passwordResetToken: 'h1', passwordResetExpiry: past, verificationToken: 'v1', verificationTokenExpiry: past, oauthCode: 'o1', oauthCodeExpiry: past });
    const b = await makeUser({ passwordResetToken: 'h2', passwordResetExpiry: future, verificationToken: 'v2', verificationTokenExpiry: future });
    const stale = await makeUser();
    const fresh = await makeUser();
    await age(User, stale._id, { refreshTokenJtis: ['x'], updatedAt: ago(RETENTION.SESSION_DAYS + 1) });
    await age(User, fresh._id, { refreshTokenJtis: ['y'] });

    const r = await runRetentionSweep();
    expect(r).toMatchObject({ passwordResetTokensCleared: 1, verificationTokensCleared: 1, oauthCodesCleared: 1, sessionsCleared: 1 });
    const A = await User.findById(a._id).select('+passwordResetToken +verificationToken +oauthCode');
    expect([A.passwordResetToken, A.verificationToken, A.oauthCode]).toEqual([null, null, null]);
    const B = await User.findById(b._id).select('+passwordResetToken +verificationToken');
    expect([B.passwordResetToken, B.verificationToken]).toEqual(['h2', 'v2']);
    expect((await User.findById(stale._id).select('+refreshTokenJtis')).refreshTokenJtis).toEqual([]);
    expect((await User.findById(fresh._id).select('+refreshTokenJtis')).refreshTokenJtis).toEqual(['y']);
});

it('drops staff invite links only after the grace period', async () => {
    const provider = await makeProvider();
    const staff = await makeUser({ role: 'staff', staffOf: provider._id });
    const long = ago(RETENTION.EXPIRED_INVITE_GRACE_DAYS + 1);
    await age(User, staff._id, {
        staffInvites: [
            { hash: 'old', sentAt: long, expiresAt: long, usedAt: null, retiredAt: null, emailed: true, source: 'owner' },
            { hash: 'recent', sentAt: ago(10), expiresAt: ago(3), usedAt: null, retiredAt: null, emailed: true, source: 'owner' },
        ],
    });
    const r = await runRetentionSweep();
    expect(r.invitesDeleted).toBe(1);
    expect((await User.findById(staff._id).select('+staffInvites')).staffInvites.map((i) => i.hash)).toEqual(['recent']);
});

it('never deletes unverified accounts — verification gates nothing, so they can be live businesses', async () => {
    // With activity: a provider who never clicked the email link but runs a business.
    const activeProvider = await makeProvider({ isVerified: false });
    const svc = await makeService(activeProvider._id);
    const customer = await makeUser();
    await makeAppointment(customer._id, svc._id, activeProvider._id);
    // Without any activity at all.
    const idle = await makeUser({ isVerified: false });
    for (const u of [activeProvider, idle]) {
        await age(User, u._id, { createdAt: ago(31), updatedAt: ago(31) });
    }

    const r = await runRetentionSweep();
    expect(r.unverifiedAccountsDeleted).toBeUndefined();
    expect(await User.exists({ _id: activeProvider._id })).toBeTruthy();
    expect(await User.exists({ _id: idle._id })).toBeTruthy();
    expect(await Service.countDocuments({ provider: activeProvider._id })).toBe(1);
});

it('anonymises guest contact details 24 months after the guest’s last booking, keeping the booking', async () => {
    const p = await makeProvider();
    const svc = await makeService(p._id);
    const old = new Date(); old.setMonth(old.getMonth() - RETENTION.GUEST_CONTACT_MONTHS - 1);
    const guest = { customer: null, guestName: 'Old Guest', guestEmail: 'old@example.com', guestPhone: '+264', status: 'completed', notes: 'x', appointmentDate: old };
    const a = await makeAppointment(null, svc._id, p._id, guest);
    // Another guest whose old booking is kept identifiable because they booked again recently.
    const b = await makeAppointment(null, svc._id, p._id, { ...guest, guestName: 'Regular', guestEmail: 'reg@example.com', startTime: '12:00', endTime: '12:30' });
    await makeAppointment(null, svc._id, p._id, { ...guest, guestName: 'Regular', guestEmail: 'reg@example.com', appointmentDate: ago(30), startTime: '13:00', endTime: '13:30' });

    const r = await runRetentionSweep();
    expect(r.guestContactsAnonymised).toBe(1);
    const A = await Appointment.findById(a._id);
    expect(A).toMatchObject({ guestName: 'Guest', guestEmail: null, guestPhone: null, notes: '', status: 'completed', totalPrice: 50 });
    expect((await Appointment.findById(b._id)).guestEmail).toBe('reg@example.com');
});

it('is safe to run twice', async () => {
    await runRetentionSweep();
    const r = await runRetentionSweep();
    expect(Object.values(r).every((v) => v === 0)).toBe(true);
});
