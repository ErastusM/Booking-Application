/**
 * Marketing email is opt-in (compliance audit point 11). The "Book again"
 * rebooking prompt reaches only account holders who opted in and guests who
 * ticked the box on that booking; every one carries a one-click unsubscribe
 * (signed link + List-Unsubscribe headers). Transactional email is unchanged.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => {
    const real = jest.requireActual('../../utils/emailService');
    return {
        ...real,
        sendVerificationEmail: jest.fn().mockResolvedValue(true),
        sendWelcomeEmail: jest.fn().mockResolvedValue(true),
        sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
        sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
        sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
        sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
        sendRebookingPrompt: jest.fn().mockResolvedValue(true),
        __realRebooking: real.sendRebookingPrompt,
    };
});

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const Appointment = require('../../models/Appointment');
const emailService = require('../../utils/emailService');
const { makeUnsubscribeToken, readUnsubscribeToken } = require('../../utils/marketing');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

const complete = (appt, provider) => request(app).put(`/api/appointments/${appt._id}/status`).set(authHeader(provider)).send({ status: 'completed' });

describe('consent capture', () => {
    const body = (extra = {}) => ({
        name: 'Ndapewa Shilongo', email: 'nd@example.com', password: 'Password1!', phone: '+264811234567',
        role: 'customer', termsAccepted: true, ageConfirmed: true, ...extra,
    });

    it('registration leaves marketing OFF unless the box was ticked', async () => {
        await request(app).post('/api/auth/register').send(body()).expect(201);
        const u = await User.findOne({ email: 'nd@example.com' });
        expect(u.marketingEmails.optIn).toBe(false);
        expect(u.consentLog.find((c) => c.kind === 'marketing_emails').value).toBe(false);
    });

    it('registration records an explicit opt-in with time and source', async () => {
        await request(app).post('/api/auth/register').send(body({ marketingOptIn: true })).expect(201);
        const u = await User.findOne({ email: 'nd@example.com' });
        expect(u.marketingEmails.optIn).toBe(true);
        expect(u.marketingEmails.source).toBe('register');
        expect(u.marketingEmails.at).toBeInstanceOf(Date);
    });

    it('the account toggle switches it and keeps an audit trail', async () => {
        const user = await makeUser();
        const on = await request(app).put('/api/auth/marketing').set(authHeader(user)).send({ optIn: true });
        expect(on.status).toBe(200);
        await request(app).put('/api/auth/marketing').set(authHeader(user)).send({ optIn: false }).expect(200);
        const u = await User.findById(user._id);
        expect(u.marketingEmails.optIn).toBe(false);
        expect(u.consentLog.map((c) => c.value)).toEqual([true, false]);
        expect((await request(app).put('/api/auth/marketing').set(authHeader(user)).send({ optIn: 'yes' })).status).toBe(400);
        const prof = await request(app).get('/api/auth/profile').set(authHeader(user));
        expect(prof.body.data.marketingEmails.optIn).toBe(false);
    });

    it('a guest booking stores the guest’s own tick (and nothing when unticked)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const d = new Date(); d.setDate(d.getDate() + 3);
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        const day = d.toISOString().slice(0, 10);
        const book = (extra, startTime) => request(app).post('/api/appointments').send({
            service: String(svc._id), appointmentDate: day, startTime, endTime: startTime.replace(':00', ':30'),
            guestName: 'Jane Doe', guestEmail: 'jane@example.com', ...extra,
        });
        const a = await book({ marketingOptIn: true }, '10:00');
        const b = await book({}, '11:00');
        expect(a.status).toBe(201);
        expect(b.status).toBe(201);
        const [ra, rb] = [await Appointment.findById(a.body.data._id), await Appointment.findById(b.body.data._id)];
        expect(ra.guestMarketing).toMatchObject({ optIn: true, source: 'guest_booking', everOptedIn: true });
        expect(rb.guestMarketing.optIn).toBe(false);
    });
});

describe('who gets "Book again"', () => {
    it('not a customer who never opted in — but the completion email still goes', async () => {
        const [customer, provider] = [await makeUser(), await makeProvider()];
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed' });
        await complete(appt, provider).expect(200);
        expect(emailService.sendAppointmentCompleted).toHaveBeenCalledTimes(1);
        expect(emailService.sendRebookingPrompt).not.toHaveBeenCalled();
    });

    it('a customer who opted in, with their own unsubscribe token', async () => {
        const customer = await makeUser({ marketingEmails: { optIn: true, at: new Date(), source: 'settings' } });
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed' });
        await complete(appt, provider).expect(200);
        expect(emailService.sendRebookingPrompt).toHaveBeenCalledTimes(1);
        const [to, , , , , opts] = emailService.sendRebookingPrompt.mock.calls[0];
        expect(to).toBe(customer.email);
        expect(readUnsubscribeToken(opts.unsubscribeToken)).toEqual({ userId: String(customer._id) });
    });

    it('a guest only when they ticked the box on that booking', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const base = { customer: null, guestName: 'Jane Doe', guestEmail: 'jane@example.com', status: 'confirmed' };
        const no = await makeAppointment(null, svc._id, provider._id, base);
        await complete(no, provider).expect(200);
        expect(emailService.sendRebookingPrompt).not.toHaveBeenCalled();
        expect(emailService.sendAppointmentCompleted).toHaveBeenCalledTimes(1);

        const yes = await makeAppointment(null, svc._id, provider._id, { ...base, startTime: '12:00', endTime: '12:30', guestMarketing: { optIn: true, everOptedIn: true } });
        await complete(yes, provider).expect(200);
        expect(emailService.sendRebookingPrompt).toHaveBeenCalledTimes(1);
        expect(readUnsubscribeToken(emailService.sendRebookingPrompt.mock.calls[0][5].unsubscribeToken)).toEqual({ email: 'jane@example.com' });
    });
});

describe('one-click unsubscribe', () => {
    it('turns an account holder’s marketing off without signing in, and can be undone', async () => {
        const customer = await makeUser({
            marketingEmails: { optIn: true, source: 'register' },
            consentLog: [{ kind: 'marketing_emails', value: true, source: 'register', at: new Date() }],
        });
        const token = makeUnsubscribeToken({ userId: customer._id });
        const res = await request(app).post(`/api/marketing/unsubscribe/${token}`).type('form').send('List-Unsubscribe=One-Click');
        expect(res.status).toBe(200);
        expect(res.body.data.subscribed).toBe(false);
        let u = await User.findById(customer._id);
        expect(u.marketingEmails).toMatchObject({ optIn: false, source: 'unsubscribe_link' });

        await request(app).post(`/api/marketing/resubscribe/${token}`).expect(200);
        u = await User.findById(customer._id);
        expect(u.marketingEmails.optIn).toBe(true);
    });

    it('an account that never opted in cannot be subscribed through the link', async () => {
        const never = await makeUser(); // marketing off, empty consent log
        const token = makeUnsubscribeToken({ userId: never._id });
        await request(app).post(`/api/marketing/unsubscribe/${token}`).expect(200);
        const res = await request(app).post(`/api/marketing/resubscribe/${token}`);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('never_opted_in');
        expect((await User.findById(never._id)).marketingEmails.optIn).toBe(false);

        // Opted out at sign-up (the log holds only "false"): still no.
        const declined = await makeUser({ consentLog: [{ kind: 'marketing_emails', value: false, source: 'register', at: new Date() }] });
        const t2 = makeUnsubscribeToken({ userId: declined._id });
        expect((await request(app).post(`/api/marketing/resubscribe/${t2}`)).status).toBe(403);
    });

    it('an account that opted in via settings, then unsubscribed, can undo', async () => {
        const user = await makeUser();
        await request(app).put('/api/auth/marketing').set(authHeader(user)).send({ optIn: true }).expect(200);
        const token = makeUnsubscribeToken({ userId: user._id });
        await request(app).post(`/api/marketing/unsubscribe/${token}`).expect(200);
        await request(app).post(`/api/marketing/resubscribe/${token}`).expect(200);
        expect((await User.findById(user._id)).marketingEmails.optIn).toBe(true);
    });

    it('a guest who never ticked the box cannot be subscribed through the link', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        await makeAppointment(null, svc._id, provider._id, { customer: null, guestName: 'No Tick', guestEmail: 'notick@example.com' });
        const token = makeUnsubscribeToken({ email: 'notick@example.com' });
        const res = await request(app).post(`/api/marketing/resubscribe/${token}`);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('never_opted_in');
    });

    it('turns a guest off on every booking; undo only restores bookings they had opted in on', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const base = { customer: null, guestName: 'Jane Doe', guestEmail: 'jane@example.com' };
        const a = await makeAppointment(null, svc._id, provider._id, { ...base, guestMarketing: { optIn: true, everOptedIn: true } });
        const b = await makeAppointment(null, svc._id, provider._id, { ...base, startTime: '12:00', endTime: '12:30' });
        const token = makeUnsubscribeToken({ email: 'jane@example.com' });
        await request(app).post(`/api/marketing/unsubscribe/${token}`).expect(200);
        expect((await Appointment.findById(a._id)).guestMarketing.optIn).toBe(false);
        await request(app).post(`/api/marketing/resubscribe/${token}`).expect(200);
        expect((await Appointment.findById(a._id)).guestMarketing.optIn).toBe(true);
        expect((await Appointment.findById(b._id)).guestMarketing.optIn).toBe(false);
    });

    it('rejects a forged or tampered token', async () => {
        const customer = await makeUser({ marketingEmails: { optIn: true } });
        const token = makeUnsubscribeToken({ userId: customer._id });
        const other = await makeUser({ marketingEmails: { optIn: true } });
        const forged = `${Buffer.from(JSON.stringify({ k: 'u', id: String(other._id) })).toString('base64url')}.${token.split('.')[1]}`;
        expect((await request(app).post(`/api/marketing/unsubscribe/${forged}`)).status).toBe(400);
        expect((await request(app).post('/api/marketing/unsubscribe/garbage')).status).toBe(400);
        expect((await User.findById(other._id)).marketingEmails.optIn).toBe(true);
    });

    it('a GET (link scanners, browsers) changes nothing and redirects to the page', async () => {
        const customer = await makeUser({ marketingEmails: { optIn: true } });
        const token = makeUnsubscribeToken({ userId: customer._id });
        const res = await request(app).get(`/api/marketing/unsubscribe/${token}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(new RegExp(`/unsubscribe/${token}$`));
        expect((await User.findById(customer._id)).marketingEmails.optIn).toBe(true);
    });
});

describe('the "Book again" email itself', () => {
    it('carries List-Unsubscribe headers and an unsubscribe footer link; refuses to send without a token', async () => {
        const sent = jest.spyOn(emailService.transporter, 'sendMail').mockResolvedValue({});
        const token = makeUnsubscribeToken({ userId: '64b7f0c2a1b2c3d4e5f60718' });
        await emailService.__realRebooking('a@example.com', 'Ann', 'Haircut', 'Vibe', 'pid', { unsubscribeToken: token });
        expect(sent).toHaveBeenCalledTimes(1);
        const mail = sent.mock.calls[0][0];
        expect(mail.headers['List-Unsubscribe']).toBe(`<${process.env.SERVER_URL}/api/marketing/unsubscribe/${token}>`);
        expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(mail.html).toContain(`/unsubscribe/${token}`);
        expect(mail.html).toMatch(/Unsubscribe/);
        expect(mail.html).not.toContain('Sent to keep you updated about your bookings');

        sent.mockClear();
        const r = await emailService.__realRebooking('a@example.com', 'Ann', 'Haircut', 'Vibe', 'pid');
        expect(r).toEqual({ skipped: true });
        expect(sent).not.toHaveBeenCalled();
        sent.mockRestore();
    });
});
