/**
 * What a client is told about a booking (compliance scorecard points 13 and 18).
 *   - The booking screen's cancellation policy uses the same fallback the server
 *     enforces (0 = cancel any time), never a stricter "24 hours".
 *   - The emailed confirmation (the receipt) shows the total in the business's
 *     own currency, not always NAD.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendStaffBookingAlert: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const User = require('../../models/User');
const emailService = require('../../utils/emailService');
const { makeProvider, makeService } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

const soon = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const waitFor = async (fn, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (fn()) return;
        await new Promise((r) => setTimeout(r, 25));
    }
};

describe('Booking screen cancellation policy', () => {
    it('a business that never set a notice shows "any time" (0), as the server enforces', async () => {
        const provider = await makeProvider();
        await User.updateOne({ _id: provider._id }, { $unset: { bookingPolicy: 1 } });
        const res = await request(app).get(`/api/providers/${provider._id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.provider.cancellationWindowHours).toBe(0);
    });

    it('a business notice window is passed through unchanged', async () => {
        const provider = await makeProvider({ bookingPolicy: { cancellationWindowHours: 48 } });
        const res = await request(app).get(`/api/providers/${provider._id}`);
        expect(res.body.data.provider.cancellationWindowHours).toBe(48);
    });
});

describe('Booking confirmation email (receipt)', () => {
    it('carries the total in the business currency', async () => {
        const provider = await makeProvider({ businessProfile: { businessName: 'Cape Cuts', currency: 'ZAR' } });
        const svc = await makeService(provider._id, { price: 150, duration: 30 });
        const res = await request(app).post('/api/appointments').send({
            service: svc._id.toString(), appointmentDate: soon(), startTime: '10:00', endTime: '10:30',
            guestName: 'Jane Doe', guestEmail: 'jane@example.com',
        });
        expect(res.status).toBe(201);
        await waitFor(() => emailService.sendAppointmentConfirmed.mock.calls.length > 0);
        expect(emailService.sendAppointmentConfirmed).toHaveBeenCalledTimes(1);
        const [to, , , , , , extras] = emailService.sendAppointmentConfirmed.mock.calls[0];
        expect(to).toBe('jane@example.com');
        expect(extras).toMatchObject({ price: 150, currency: 'ZAR' });
        expect(extras.manageUrl).toMatch(/\/manage\//);
    });
});
