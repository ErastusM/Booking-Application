/**
 * "New client" from the business's New Appointment window: a person with no
 * account, booked like a walk-in, whose phone (and optional email) the business
 * typed in. The details are kept on the booking, so the client shows in My
 * Clients with a way to reach them and gets the confirmation email. A plain
 * Guest (no newClient flag) keeps storing the name only.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => {
    const fns = {};
    return new Proxy(fns, { get: (t, k) => { if (!t[k]) t[k] = jest.fn().mockResolvedValue(true); return t[k]; } });
});

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const emailService = require('../../utils/emailService');
const Appointment = require('../../models/Appointment');
const TeamMember = require('../../models/TeamMember');
const { makeUser, makeProvider, makeService, authHeader, giveHours } = require('../helpers/factories');
const { newClientContact } = require('../../utils/newClientContact');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => { jest.clearAllMocks(); return testDb.clearDatabase(); });

const weekday = (plus = 2) => {
    const d = new Date();
    d.setDate(d.getDate() + plus);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const DATE = weekday();

const waitFor = async (fn, timeoutMs = 3000) => {
    const start = Date.now();
    for (;;) {
        if (await fn()) return;
        if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
        await new Promise((r) => setTimeout(r, 25));
    }
};

const NEW_CLIENT = { walkInName: 'William Rittmann', guestPhone: '+264 81 630 6705', guestEmail: 'William@Example.com', newClient: true };

describe('newClientContact', () => {
    it('ignores bodies without the newClient flag', () => {
        expect(newClientContact({ walkInName: 'Petrus', guestPhone: '0811234567' })).toEqual({ contact: null });
    });
    it('needs a full name and a phone number; email is optional', () => {
        expect(newClientContact({ newClient: true, walkInName: 'William', guestPhone: '+264 81 630 6705' }).error).toMatch(/first name and surname/);
        expect(newClientContact({ newClient: true, walkInName: 'William Rittmann' }).error).toMatch(/phone number/);
        expect(newClientContact({ newClient: true, walkInName: 'William Rittmann', guestPhone: '12ab' }).error).toMatch(/valid phone/);
        expect(newClientContact({ newClient: true, walkInName: 'William Rittmann', guestPhone: '081 630 6705', guestEmail: 'nope' }).error).toMatch(/valid email/);
        expect(newClientContact({ newClient: true, walkInName: ' William Rittmann ', guestPhone: '081 630 6705' }))
            .toEqual({ contact: { name: 'William Rittmann', phone: '081 630 6705', email: null } });
    });
});

describe('POST /api/appointments with a new client', () => {
    it('the owner books a new client: phone and email are kept and the client gets the confirmation', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const res = await request(app).post('/api/appointments').set(authHeader(provider))
            .send({ service: svc._id.toString(), appointmentDate: DATE, startTime: '10:00', endTime: '10:30', ...NEW_CLIENT });
        expect(res.status).toBe(201);

        const appt = await Appointment.findById(res.body.data._id).lean();
        expect(appt.walkInName).toBe('William Rittmann');
        expect(appt.guestPhone).toBe('+264 81 630 6705');
        expect(appt.guestEmail).toBe('william@example.com');
        expect(appt.guestName).toBeNull();
        expect(appt.customer).toBeNull();

        await waitFor(() => emailService.sendAppointmentConfirmed.mock.calls.length > 0);
        expect(emailService.sendAppointmentConfirmed.mock.calls[0][0]).toBe('william@example.com');
        expect(emailService.sendAppointmentConfirmed.mock.calls[0][1]).toBe('William Rittmann');

        // My Clients shows them with their phone and email.
        const crm = await request(app).get('/api/crm/clients').set(authHeader(provider));
        const row = crm.body.data.find((c) => c.customer.name === 'William Rittmann');
        expect(row.isWalkIn).toBe(true);
        expect(row.customer.phone).toBe('+264 81 630 6705');
        expect(row.customer.email).toBe('william@example.com');
    });

    it('a plain Guest still keeps the name only, even if contact fields are sent', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const res = await request(app).post('/api/appointments').set(authHeader(provider))
            .send({ service: svc._id.toString(), appointmentDate: DATE, startTime: '11:00', endTime: '11:30', walkInName: 'Petrus', guestPhone: '0811234567', guestEmail: 'p@example.com' });
        expect(res.status).toBe(201);
        const appt = await Appointment.findById(res.body.data._id).lean();
        expect(appt.walkInName).toBe('Petrus');
        expect(appt.guestPhone).toBeNull();
        expect(appt.guestEmail).toBeNull();
    });

    it('refuses a new client without a phone number or a full name', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const base = { service: svc._id.toString(), appointmentDate: DATE, startTime: '12:00', endTime: '12:30', newClient: true };
        const noPhone = await request(app).post('/api/appointments').set(authHeader(provider)).send({ ...base, walkInName: 'William Rittmann' });
        expect(noPhone.status).toBe(400);
        expect(noPhone.body.code).toBe('new_client_invalid');
        const oneName = await request(app).post('/api/appointments').set(authHeader(provider)).send({ ...base, walkInName: 'William', guestPhone: '0816306705' });
        expect(oneName.status).toBe(400);
        expect(await Appointment.countDocuments({})).toBe(0);
    });

    it('a team member who may log walk-ins may book a new client, into their own column', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const login = await makeUser({ role: 'staff', staffOf: provider._id, email: 'member-nc@test.com', staffPermissions: [] });
        const member = await TeamMember.create({ provider: provider._id, name: 'Moses Member', user: login._id, offersAllServices: true });
        await giveHours(member);
        const res = await request(app).post('/api/appointments').set(authHeader(login))
            .send({ service: svc._id.toString(), appointmentDate: DATE, startTime: '14:00', endTime: '14:30', ...NEW_CLIENT });
        expect(res.status).toBe(201);
        const appt = await Appointment.findById(res.body.data._id).lean();
        expect(String(appt.teamMember)).toBe(String(member._id));
        expect(appt.guestPhone).toBe('+264 81 630 6705');
        expect(appt.customer).toBeNull();
    });
});

describe('POST /api/appointments/multi with a new client', () => {
    it('keeps the contact details and emails the confirmation', async () => {
        const provider = await makeProvider();
        const s1 = await makeService(provider._id, { name: 'Haircut' });
        const s2 = await makeService(provider._id, { name: 'Beard trim' });
        const res = await request(app).post('/api/appointments/multi').set(authHeader(provider)).send({
            appointmentDate: DATE, startTime: '09:00',
            services: [{ serviceId: s1._id.toString() }, { serviceId: s2._id.toString() }],
            ...NEW_CLIENT,
        });
        expect(res.status).toBe(201);
        const appt = await Appointment.findById(res.body.data._id).lean();
        expect(appt.walkInName).toBe('William Rittmann');
        expect(appt.guestPhone).toBe('+264 81 630 6705');
        expect(appt.guestEmail).toBe('william@example.com');
        await waitFor(() => emailService.sendAppointmentConfirmed.mock.calls.length > 0);
        expect(emailService.sendAppointmentConfirmed.mock.calls[0][0]).toBe('william@example.com');
    });

    it('refuses an invalid new client', async () => {
        const provider = await makeProvider();
        const s1 = await makeService(provider._id);
        const res = await request(app).post('/api/appointments/multi').set(authHeader(provider)).send({
            appointmentDate: DATE, startTime: '09:00', services: [{ serviceId: s1._id.toString() }],
            walkInName: 'William Rittmann', newClient: true,
        });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('new_client_invalid');
    });
});
