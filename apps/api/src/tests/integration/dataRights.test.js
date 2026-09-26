/**
 * Data-subject rights (compliance audit point 8): "Download my data" and
 * complete self-service deletion for customers and business owners. Team
 * members are removed by their owner.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, makeReview, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const Appointment = require('../../models/Appointment');
const Message = require('../../models/Message');
const ClientNote = require('../../models/ClientNote');
const FormSubmission = require('../../models/FormSubmission');
const FormTemplate = require('../../models/FormTemplate');
const Notification = require('../../models/Notification');
const Event = require('../../models/Event');
const Review = require('../../models/Review');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const TeamMember = require('../../models/TeamMember');
const Service = require('../../models/Service');
const WaitingList = require('../../models/WaitingList');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const past = () => { const d = new Date(); d.setDate(d.getDate() - 10); return d; };

// A customer with a bit of everything: a past booking with notes, a review, a
// wallet top-up, a message, a client note (allergies) and a form answer held by
// the business, a notification, an analytics event, a guest booking on their email.
const seedCustomer = async () => {
    const customer = await makeUser({
        email: 'ana@example.com', isVerified: true,
        marketingEmails: { optIn: true, at: new Date(), source: 'register' },
        consentedAt: new Date(), consentLog: [{ kind: 'marketing_emails', value: true, source: 'register', at: new Date() }],
    });
    const provider = await makeProvider();
    const svc = await makeService(provider._id);
    const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', appointmentDate: past(), notes: 'Gate code 1234' });
    const guestAppt = await makeAppointment(null, svc._id, provider._id, { customer: null, guestName: 'Ana Silva', guestEmail: 'ana@example.com', guestPhone: '+264811', status: 'completed', appointmentDate: past(), startTime: '12:00', endTime: '12:30' });
    await makeReview(customer._id, svc._id, appt._id, { provider: provider._id, comment: 'Lovely' });
    const wallet = await Wallet.create({ customer: customer._id, provider: provider._id, totalBalance: 100 });
    await WalletTransaction.create({ wallet: wallet._id, customer: customer._id, provider: provider._id, type: 'topup', status: 'approved', amount: 100, proof: { publicId: `bookplus/proofs/${customer._id}/p`, resourceType: 'image', format: 'jpg', deliveryType: 'authenticated' } });
    await Message.create({ sender: customer._id, recipient: provider._id, appointment: appt._id, content: 'See you soon' });
    await Message.create({ sender: provider._id, recipient: customer._id, appointment: appt._id, content: 'Confirmed' });
    await ClientNote.create({ provider: provider._id, customer: customer._id, allergies: 'Latex', notes: 'Prefers mornings' });
    const tpl = await FormTemplate.create({ provider: provider._id, title: 'Intake', fields: [{ label: 'Conditions', type: 'text' }] });
    await FormSubmission.create({ template: tpl._id, appointment: appt._id, customer: customer._id, provider: provider._id, answers: [{ label: 'Conditions', value: 'Asthma' }] });
    await Notification.create({ user: customer._id, message: 'Hello', type: 'general' });
    await Event.create({ name: 'page_view', user: customer._id, path: '/' });
    return { customer, provider, svc, appt, guestAppt };
};

describe('GET /api/auth/account/export', () => {
    it('returns everything held about the person, with no secrets', async () => {
        const { customer } = await seedCustomer();
        const res = await request(app).get('/api/auth/account/export').set(authHeader(customer));
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toMatch(/attachment; filename="bookplus-my-data-\d{4}-\d{2}-\d{2}\.json"/);
        const d = res.body;
        expect(d.export.format).toBe('bookplus-account-export');
        expect(d.profile.email).toBe('ana@example.com');
        expect(d.bookings).toHaveLength(2); // account booking + the guest booking on their verified email
        expect(d.bookings[0].manageToken).toBeUndefined();
        expect(d.reviews[0].comment).toBe('Lovely');
        expect(d.wallets).toHaveLength(1);
        expect(d.walletTransactions[0]).toMatchObject({ amount: 100, hasProof: true });
        expect(d.walletTransactions[0].proof).toBeUndefined();
        expect(d.messagesSent.map((m) => m.content)).toEqual(['See you soon']);
        expect(d.consents.marketingEmails.optIn).toBe(true);
        expect(d.consents.history).toHaveLength(1);
        expect(d.formAnswers[0].answers[0].value).toBe('Asthma');
        const raw = JSON.stringify(d);
        for (const secret of ['password', 'refreshTokenJtis', 'passwordResetToken', 'verificationToken', 'oauthCode', 'tokenVersion']) {
            expect(raw).not.toContain(`"${secret}"`);
        }
    });

    it('needs a session', async () => {
        expect((await request(app).get('/api/auth/account/export')).status).toBe(401);
    });

    it('a business owner also gets their business profile, services and locations', async () => {
        const provider = await makeProvider({ businessProfile: { businessName: 'Vibe', address: '1 Main St' } });
        await makeService(provider._id, { name: 'Cut' });
        const res = await request(app).get('/api/auth/account/export').set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.business.businessProfile.businessName).toBe('Vibe');
        expect(res.body.business.services.map((s) => s.name)).toContain('Cut');
    });
});

describe('DELETE /api/auth/account — customer', () => {
    it('wants the password, then removes personal data and keeps anonymised records for the business', async () => {
        const { customer, provider, appt, guestAppt } = await seedCustomer();
        expect((await request(app).delete('/api/auth/account').set(authHeader(customer)).send({ password: 'wrong' })).status).toBe(401);

        const res = await request(app).delete('/api/auth/account').set(authHeader(customer)).send({ password: 'Password1!' });
        expect(res.status).toBe(200);

        const u = await User.findById(customer._id);
        expect(u).toMatchObject({ name: 'Deleted user', phone: 'deleted', isActive: false });
        expect(u.email).toMatch(/@deleted\.bookplus$/);
        expect(u.marketingEmails.optIn).toBe(false);
        expect(u.consentLog).toHaveLength(0);

        // Kept for the business, anonymised:
        const a = await Appointment.findById(appt._id);
        expect(a.status).toBe('completed');
        expect(a.notes).toBe('');
        expect(await Review.countDocuments({ customer: customer._id })).toBe(1);
        expect(await WalletTransaction.countDocuments({ customer: customer._id })).toBe(1);
        const g = await Appointment.findById(guestAppt._id);
        expect(g).toMatchObject({ guestName: 'Deleted guest', guestEmail: null, guestPhone: null });

        // Gone:
        expect(await Message.countDocuments({ $or: [{ sender: customer._id }, { recipient: customer._id }] })).toBe(0);
        expect(await ClientNote.countDocuments({ customer: customer._id })).toBe(0);
        expect(await FormSubmission.countDocuments({ customer: customer._id })).toBe(0);
        expect(await Notification.countDocuments({ user: customer._id })).toBe(0);
        expect(await Event.countDocuments({ user: customer._id })).toBe(0);

        // Signed out everywhere, and cannot sign back in.
        expect([401, 403]).toContain((await request(app).get('/api/auth/profile').set(authHeader(customer))).status);
        expect((await request(app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'Password1!' })).status).not.toBe(200);
        expect(provider).toBeTruthy();
    });

    it('a Google-only account (no password) confirms by typing its email', async () => {
        const g = await makeUser({ email: 'gg@example.com', password: undefined, provider: 'google', googleId: 'g-1' });
        await User.updateOne({ _id: g._id }, { $unset: { password: '' } });
        expect((await request(app).delete('/api/auth/account').set(authHeader(g)).send({})).status).toBe(401);
        expect((await request(app).delete('/api/auth/account').set(authHeader(g)).send({ confirmEmail: 'other@example.com' })).status).toBe(401);
        expect((await request(app).delete('/api/auth/account').set(authHeader(g)).send({ confirmEmail: 'GG@example.com' })).status).toBe(200);
        expect((await User.findById(g._id)).googleId).toBeNull();
    });
});

describe('DELETE /api/auth/account — business owner', () => {
    it('closes the business: profile, team, client notes and staff logins go; client bookings stay anonymised', async () => {
        const provider = await makeProvider({
            businessProfile: { businessName: 'Vibe', address: '1 Main St', coordinates: { lat: -22.5, lng: 17 }, slug: 'vibe' },
            walletSettings: { enabled: true, paymentInstructions: 'Bank Windhoek 123456' },
        });
        const staff = await makeUser({ role: 'staff', staffOf: provider._id, email: 'sam@vibe.test' });
        await TeamMember.create({ provider: provider._id, name: 'Sam', phone: '+264', user: staff._id });
        const customer = await makeUser();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', appointmentDate: past() });
        await ClientNote.create({ provider: provider._id, customer: customer._id, allergies: 'Nuts' });
        await WaitingList.create({ service: svc._id, provider: provider._id, customer: customer._id, appointmentDate: new Date(Date.now() + 864e5 * 3), startTime: '10:00', endTime: '10:30', position: 1 });

        const res = await request(app).delete('/api/auth/account').set(authHeader(provider)).send({ password: 'Password1!' });
        expect(res.status).toBe(200);

        const p = await User.findById(provider._id);
        expect(p.businessProfile).toMatchObject({ businessName: 'Closed business', address: '', slug: null });
        expect(p.businessProfile.coordinates.lat).toBeNull();
        expect(p.walletSettings.paymentInstructions).toBe('');
        expect((await Service.findById(svc._id)).isActive).toBe(false);
        expect(await TeamMember.countDocuments({ provider: provider._id })).toBe(0);
        expect(await ClientNote.countDocuments({ provider: provider._id })).toBe(0);
        expect(await WaitingList.countDocuments({ provider: provider._id })).toBe(0);
        const s = await User.findById(staff._id);
        expect(s).toMatchObject({ name: 'Deleted user', isActive: false });
        expect((await Appointment.findById(appt._id)).status).toBe('completed'); // the client's own history stays
    });
});

describe('team members', () => {
    it('cannot delete themselves — their owner removes them from the team', async () => {
        const provider = await makeProvider();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id });
        const res = await request(app).delete('/api/auth/account').set(authHeader(staff)).send({ password: 'Password1!' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('staff_delete_via_owner');
        expect((await User.findById(staff._id)).isActive).toBe(true);
    });

    it('can still download their own data', async () => {
        const provider = await makeProvider();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id });
        const res = await request(app).get('/api/auth/account/export').set(authHeader(staff));
        expect(res.status).toBe(200);
        expect(res.body.profile.role).toBe('staff');
        expect(res.body.business).toBeUndefined();
    });
});
