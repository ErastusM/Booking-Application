/**
 * Client names must be a first name AND a surname, so a business can tell
 * apart clients who share one of them. Enforced at sign-up, profile edits and
 * booking; accounts made before the rule are asked at their next booking.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const { isFullName } = require('../../utils/personName');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

// A weekday a few days out (avoids weekend availability + past-slot checks).
const soon = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const booking = (svc, extra = {}) => ({ service: svc._id.toString(), appointmentDate: soon(), startTime: '10:00', endTime: '10:30', ...extra });

describe('isFullName', () => {
    test.each([
        ['Ndapewa Shilongo', true], ["Jean-Luc O'Neil", true], ['Maria  de Souza', true], ['Ōta Hiroshi', true],
        ['Shilongo', false], ['N Shilongo', false], ['Maria .', false], ['', false], [null, false], ['  ', false],
    ])('%p → %p', (name, ok) => expect(isFullName(name)).toBe(ok));
});

describe('sign-up', () => {
    const payload = { email: 'new@example.com', password: 'Password1!', phone: '+15550001234', role: 'customer', termsAccepted: true, ageConfirmed: true };

    test('a client must give a first name and surname', async () => {
        const res = await request(app).post('/api/auth/register').send({ ...payload, name: 'Shilongo' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('full_name_required');
        expect((await request(app).post('/api/auth/register').send({ ...payload, name: 'Ndapewa Shilongo' })).status).toBe(201);
    });
});

describe('profile edits', () => {
    test('a client cannot shorten their name to one word', async () => {
        const client = await makeUser({ name: 'Ndapewa Shilongo' });
        const res = await request(app).put('/api/auth/profile').set(authHeader(client)).send({ name: 'Ndapewa' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('full_name_required');
    });

    test('a business owner’s own name is not held to the client rule', async () => {
        const owner = await makeProvider({ name: 'Vido Owner' });
        const res = await request(app).put('/api/auth/profile').set(authHeader(owner)).send({ name: 'Vido' });
        expect(res.status).toBe(200);
    });
});

describe('booking', () => {
    test('a guest must give a first name and surname', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const res = await request(app).post('/api/appointments').send(booking(svc, { guestName: 'Shilongo', guestEmail: 'g@example.com' }));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('full_name_required');
    });

    test('an older one-word account is asked to complete its name, then books', async () => {
        const client = await makeUser({ name: 'Shilongo' });
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const blocked = await request(app).post('/api/appointments').set(authHeader(client)).send(booking(svc));
        expect(blocked.status).toBe(400);
        expect(blocked.body.code).toBe('full_name_required');

        expect((await request(app).put('/api/auth/profile').set(authHeader(client)).send({ name: 'Ndapewa Shilongo' })).status).toBe(200);
        const ok = await request(app).post('/api/appointments').set(authHeader(client)).send(booking(svc));
        expect(ok.status).toBe(201);
    });
});
