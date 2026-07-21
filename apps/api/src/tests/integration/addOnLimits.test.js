/**
 * selectedAddOns input-hardening tests (QA finding #30).
 *
 * The add-on array is resolved against the service catalogue by name in the
 * controller, but resolution does NOT de-duplicate — N copies of one valid
 * add-on name would survive as N stored line items, get copied into baseDoc,
 * and be spread into every occurrence of a recurring series (up to 60) before
 * a single insertMany. Unbounded, one request causes large write / oplog /
 * replication amplification. These tests prove the length + per-element caps
 * reject the abusive shapes while every legitimate booking still succeeds.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const {
    makeUser, makeProvider, makeService,
    authHeader,
} = require('../helpers/factories');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduledClient: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A weekday at least 3 days out — inside the default availability schedule and
// outside the 24h cancellation window regardless of the wall clock.
const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('POST /api/appointments – selectedAddOns limits (finding #30)', () => {
    it('rejects an oversized selectedAddOns array before it can amplify writes', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, {
            price: 50,
            addOns: [{ name: 'Shampoo', price: 10, duration: 0 }],
        });

        const bloated = Array.from({ length: 5000 }, () => ({ name: 'Shampoo', price: 10 }));

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: svc._id.toString(),
                appointmentDate: tomorrow(),
                startTime: '14:00',
                endTime: '14:30',
                selectedAddOns: bloated,
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/too many add-ons/i);
    });

    it('rejects an add-on element whose name is oversized', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, {
            price: 50,
            addOns: [{ name: 'Shampoo', price: 10, duration: 0 }],
        });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: svc._id.toString(),
                appointmentDate: tomorrow(),
                startTime: '14:00',
                endTime: '14:30',
                selectedAddOns: [{ name: 'x'.repeat(101), price: 10 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/add-on name is too long/i);
    });

    it('still accepts a legitimate booking with catalogue add-ons (behavior preserved)', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, {
            price: 50,
            addOns: [{ name: 'Shampoo', price: 10, duration: 0 }, { name: 'Trim', price: 5, duration: 0 }],
        });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: svc._id.toString(),
                appointmentDate: tomorrow(),
                startTime: '14:00',
                endTime: '14:30',
                selectedAddOns: [{ name: 'Shampoo', price: 10 }, { name: 'Trim', price: 5 }],
            });

        expect(res.status).toBe(201);
        expect(res.body.data.totalPrice).toBe(65);
        expect(res.body.data.selectedAddOns).toHaveLength(2);
    });

    it('accepts an array exactly at the 50-element cap', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, {
            price: 50,
            addOns: [{ name: 'Shampoo', price: 10, duration: 0 }],
        });

        // 50 copies of a valid add-on — the boundary is inclusive, so this passes
        // validation. (Duplicates are priced/stored as-is by the controller; the
        // point of this case is that the cap does not reject the legal maximum.)
        const atCap = Array.from({ length: 50 }, () => ({ name: 'Shampoo', price: 10 }));

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: svc._id.toString(),
                appointmentDate: tomorrow(),
                startTime: '14:00',
                endTime: '14:30',
                selectedAddOns: atCap,
            });

        expect(res.status).toBe(201);
    });
});
