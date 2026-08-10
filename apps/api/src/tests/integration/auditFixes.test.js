/**
 * Regression cover for the security/QA audit fixes.
 *
 * Each block pins the behaviour that was actually wrong, so a future refactor that
 * reintroduces it fails here rather than in production:
 *   CRITICAL  catastrophic-backtracking email regex — remote unauthenticated DoS
 *   HIGH      group booking accepted any customerId (attach a booking to any account)
 *   HIGH      expired packages stayed redeemable forever
 *   HIGH      bookings crossing midnight were invisible to every conflict check
 *   MEDIUM    customer-supplied proofUrl was stored and rendered as a link
 *   MEDIUM    removing a team member left their login working
 *   MEDIUM    cancelling a series rewrote completed history
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const TeamMember = require('../../models/TeamMember');
const Package = require('../../models/Package');
const ClientPackage = require('../../models/ClientPackage');
const Appointment = require('../../models/Appointment');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A weekday N days out (skips weekends so it stays inside default availability).
const weekdayAhead = (n) => {
    const d = new Date();
    let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) added++; }
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe('CRITICAL — email validation cannot be used to stall the API', () => {
    // The old regex took 23.9s of CPU on a 30-character address, and Node is
    // single-threaded, so one public /register froze the whole API. The assertion
    // is wall-clock deliberately: a correctness-only check would still pass while
    // the process was being held hostage.
    it('rejects a backtracking payload fast instead of burning CPU', async () => {
        const payload = `x@${'a'.repeat(30)}.abcd`;
        const started = Date.now();
        const res = await request(app).post('/api/auth/register').send({
            name: 'ReDoS Probe',
            email: payload,
            password: 'Password1!',
            phone: '+15550009999',
            role: 'customer',
        });
        const elapsed = Date.now() - started;

        // Generous bound — the point is "not seconds of blocked event loop".
        expect(elapsed).toBeLessThan(2000);
        expect([200, 201, 400, 422]).toContain(res.status);
    });

    it('still accepts a normal address and still rejects a malformed one', async () => {
        const ok = await request(app).post('/api/auth/register').send({
            name: 'Valid Email', email: 'user.name@sub.example.com', password: 'Password1!', phone: '+15550009001', role: 'customer',
        });
        expect([200, 201]).toContain(ok.status);

        const bad = await request(app).post('/api/auth/register').send({
            name: 'Bad Email', email: 'notanemail', password: 'Password1!', phone: '+15550009002', role: 'customer',
        });
        expect([400, 422]).toContain(bad.status);
    });
});

describe('HIGH — group booking may not attach appointments to arbitrary accounts', () => {
    it('refuses a customerId with no prior relationship, and books nothing', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const stranger = await makeUser(); // never booked with this provider

        const res = await request(app)
            .post('/api/appointments/group')
            .set(authHeader(provider))
            .send({
                service: service._id.toString(),
                appointmentDate: weekdayAhead(3),
                startTime: '10:00',
                endTime: '11:00',
                clients: [{ customerId: stranger._id.toString() }],
            });

        expect(res.status).toBe(403);
        // The real damage was the write, so assert on the database, not just the code.
        expect(await Appointment.countDocuments({ customer: stranger._id })).toBe(0);
    });

    it('still allows name-only walk-in group entries', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);

        const res = await request(app)
            .post('/api/appointments/group')
            .set(authHeader(provider))
            .send({
                service: service._id.toString(),
                appointmentDate: weekdayAhead(3),
                startTime: '10:00',
                endTime: '11:00',
                clients: [{ name: 'Walk-in One' }, { name: 'Walk-in Two' }],
            });

        expect([200, 201]).toContain(res.status);
    });
});

describe('HIGH — a booking window must end after it starts, on the same day', () => {
    it('rejects a window that crosses midnight', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const service = await makeService(provider._id, { duration: 120 });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: service._id.toString(),
                appointmentDate: weekdayAhead(3),
                startTime: '23:00',
                endTime: '01:00',
            });

        expect(res.status).toBe(400);
        expect(await Appointment.countDocuments({})).toBe(0);
    });

    it('rejects an inverted window from a provider too (it used to skip validation)', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(provider))
            .send({
                service: service._id.toString(),
                appointmentDate: weekdayAhead(3),
                startTime: '09:00',
                endTime: '08:00',
                walkInName: 'Inverted Window',
            });

        expect(res.status).toBe(400);
        expect(await Appointment.countDocuments({})).toBe(0);
    });
});

describe('HIGH — an expired package cannot be redeemed', () => {
    const seedPackage = async (expiryDate) => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const pkg = await Package.create({
            provider: provider._id, name: 'Ten cuts', totalSessions: 10, price: 1000, validityDays: 90, isActive: true,
        });
        const clientPkg = await ClientPackage.create({
            customer: customer._id,
            provider: provider._id,
            package: pkg._id,
            sessionsTotal: 10,
            sessionsUsed: 0,
            sessionsRemaining: 10,
            purchasePrice: 1000,
            expiryDate,
            status: 'active',
        });
        return { customer, clientPkg };
    };

    it('refuses redemption once the expiry date has passed, even while still marked active', async () => {
        // The row is deliberately left status:'active' — that is exactly the state a
        // client stayed in by never opening their packages screen, since nothing but
        // that screen ever expired it.
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const { customer, clientPkg } = await seedPackage(yesterday);

        const res = await request(app)
            .post(`/api/packages/my-client-packages/${clientPkg._id}/redeem`)
            .set(authHeader(customer))
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/expired/i);
        const after = await ClientPackage.findById(clientPkg._id);
        expect(after.sessionsRemaining).toBe(10); // nothing consumed
    });

    it('still redeems a package that is in date', async () => {
        const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const { customer, clientPkg } = await seedPackage(nextMonth);

        const res = await request(app)
            .post(`/api/packages/my-client-packages/${clientPkg._id}/redeem`)
            .set(authHeader(customer))
            .send({});

        expect([200, 201]).toContain(res.status);
        const after = await ClientPackage.findById(clientPkg._id);
        expect(after.sessionsRemaining).toBe(9);
    });
});

describe('MEDIUM — a payment proof link is stored only when it is http(s)', () => {
    it('drops a javascript: URL rather than showing it to a provider or admin', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();

        const res = await request(app)
            .post('/api/wallet/topup')
            .set(authHeader(customer))
            .send({
                providerId: provider._id.toString(),
                amount: 500,
                reference: 'EFT-1',
                proofUrl: 'javascript:alert(document.cookie)',
            });

        if ([200, 201].includes(res.status)) {
            expect(res.body?.data?.proofUrl ?? '').toBe('');
        } else {
            expect([400, 403, 404]).toContain(res.status);
        }
    });
});

describe('MEDIUM — removing a team member ends their access', () => {
    it('revokes the linked staff account instead of leaving a working login', async () => {
        const provider = await makeProvider();
        const staffUser = await makeUser({ role: 'staff', staffOf: provider._id, email: 'staff-revoke@test.com' });
        const member = await TeamMember.create({
            provider: provider._id, name: 'Departing Staff', user: staffUser._id, isActive: true,
        });

        const before = await User.findById(staffUser._id);
        const versionBefore = before.tokenVersion || 0;

        const res = await request(app)
            .delete(`/api/team/${member._id}`)
            .set(authHeader(provider));
        expect([200, 204]).toContain(res.status);

        const after = await User.findById(staffUser._id);
        // A bumped tokenVersion is what actually invalidates every issued token.
        expect(after.tokenVersion).toBeGreaterThan(versionBefore);
        expect(after.staffOf ?? null).toBeNull();
    });
});

describe('MEDIUM — cancelling a series does not rewrite finished history', () => {
    it('leaves completed occurrences completed', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const groupId = 'series-under-test';

        const past = await makeAppointment(customer._id, service._id, provider._id, {
            appointmentDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            status: 'completed',
            recurrenceGroupId: groupId,
        });
        const future = await makeAppointment(customer._id, service._id, provider._id, {
            appointmentDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            status: 'confirmed',
            recurrenceGroupId: groupId,
        });

        const res = await request(app)
            .delete(`/api/appointments/${future._id}/series`)
            .set(authHeader(provider))
            .send({ deleteMode: 'all' });
        expect([200, 204]).toContain(res.status);

        // The completed visit must survive — earnings are summed from completed
        // bookings, so flipping it silently rewrote the provider's revenue.
        expect((await Appointment.findById(past._id)).status).toBe('completed');
        expect((await Appointment.findById(future._id)).status).toBe('cancelled');
    });
});
