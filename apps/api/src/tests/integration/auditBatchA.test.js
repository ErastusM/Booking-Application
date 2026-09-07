/**
 * Re-audit batch A — the HIGH + money/overlap findings:
 *   1. Recurring series locked only its ANCHOR day, so two series sharing a future
 *      occurrence could both write it → provider double-book. Now every occurrence
 *      day is locked.
 *   2. Group-booking overlap was segment- & buffer-blind (exact teamMember match),
 *      missing a member who performs only a segment of an existing multi-service
 *      ticket.
 *   3. A 'no-show' status left the wallet reservation frozen forever (no release/
 *      deduct arm). It now releases the hold like a cancellation.
 *   4. Recurring wallet bookings were stamped paymentMethod:'wallet' but never
 *      reserved or charged (free service). Recurring is now forced to cash.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const walletService = require('../../utils/walletService');
const { makeProvider, makeService, makeUser, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => {
    const s = {};
    DAYS.forEach((d) => { s[d] = { enabled: true, slots: [{ start, end }] }; });
    return s;
};
const ymd = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// A fixed future weekday anchor (well clear of today, weekday-agnostic since the
// providers below open every day).
const anchor = () => addDays(new Date(), 21);

describe('A1 — recurring series lock covers every occurrence day (no non-anchor double-book)', () => {
    it('a concurrent single booking on a NON-anchor occurrence day cannot double-book it', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const svc = await makeService(provider._id, { price: 50, duration: 30 });

        const d0 = anchor();
        const d7 = addDays(d0, 7); // a NON-anchor occurrence of the weekly series
        // R = weekly recurring from d0 → occurrences d0, d7, d14…  S = a single
        // booking on d7 at the same time/owner column. Before the fix R locked only
        // d0 while S locked d7 (different keys) → both could write d7. Now R locks
        // every occurrence day, so d7 is serialized and lands exactly once.
        const recur = request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: ymd(d0),
            startTime: '10:00', endTime: '10:30', walkInName: 'Series',
            isRecurring: true, recurrenceType: 'weekly', recurrenceInterval: 1,
        });
        const single = request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: ymd(d7),
            startTime: '10:00', endTime: '10:30', walkInName: 'Single',
        });

        const [r] = await Promise.all([recur, single]);
        expect(r.status).toBe(201); // the series' anchor (d0) never conflicts

        // Whoever won d7, it must hold EXACTLY ONE booking on the owner column at 10:00.
        const dayStart = new Date(ymd(d7) + 'T00:00:00.000Z');
        const dayEnd = new Date(ymd(d7) + 'T23:59:59.999Z');
        const onSharedDay = await Appointment.countDocuments({
            provider: provider._id, teamMember: null, startTime: '10:00',
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
        });
        expect(onSharedDay).toBe(1);
    });
});

describe('A2 — group-booking overlap is segment- and buffer-aware', () => {
    it('refuses a group booking for a member who is a SEGMENT performer on an existing ticket', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const s1 = await makeService(provider._id, { price: 50, duration: 30 });
        const s2 = await makeService(provider._id, { price: 50, duration: 30 });
        const alice = await TeamMember.create({ provider: provider._id, name: 'Alice' });
        await StaffAvailability.create({ provider: provider._id, teamMember: alice._id, schedule: everyDay('08:00', '19:00') });
        const date = ymd(anchor());

        // Multi-service ticket: owner does s1 (10:00–10:30, primary), Alice does s2
        // (10:30–11:00, a SEGMENT — top-level teamMember is the owner, not Alice).
        const multi = await request(app).post('/api/appointments/multi').set(authHeader(provider)).send({
            appointmentDate: date, startTime: '10:00', walkInName: 'Walk-in',
            services: [{ serviceId: s1._id.toString() }, { serviceId: s2._id.toString(), teamMember: alice._id.toString() }],
        });
        expect(multi.status).toBe(201);

        // A group booking for Alice at 10:30–11:00 overlaps her segment. The old
        // exact-teamMember match missed it (Alice isn't the ticket's top-level member).
        const group = await request(app).post('/api/appointments/group').set(authHeader(provider)).send({
            service: s2._id.toString(), appointmentDate: date,
            startTime: '10:30', endTime: '11:00', teamMember: alice._id.toString(),
            clients: [{ name: 'Group A' }, { name: 'Group B' }],
        });
        expect(group.status).toBe(400);
        // Alice must still be booked exactly once (the original segment).
        expect(await Appointment.countDocuments({ 'services.teamMember': alice._id })).toBe(1);
    });
});

describe('A3 — no-show releases the wallet reservation', () => {
    it('a no-show returns the held funds instead of freezing them', async () => {
        const provider = await makeProvider({ walletSettings: { enabled: true, bookingPaymentMode: 'wallet_required', refundsAllowed: true } });
        const svc = await makeService(provider._id, { price: 100, duration: 30 });
        const client = await makeUser();
        // Fund the client's wallet via the real top-up + approve flow.
        const topup = await request(app).post('/api/wallet/topup').set(authHeader(client))
            .send({ providerId: provider._id.toString(), amount: 500 });
        await request(app).post(`/api/wallet/topups/${topup.body.data._id}/approve`).set(authHeader(provider));

        const d = new Date(); d.setDate(d.getDate() + 14);
        const booking = await request(app).post('/api/appointments').set(authHeader(client)).send({
            service: svc._id.toString(), appointmentDate: ymd(d), startTime: '10:00', endTime: '10:30',
        });
        expect(booking.status).toBe(201);

        let wallet = (await request(app).get(`/api/wallet/mine/${provider._id}`).set(authHeader(client))).body.data.wallet;
        expect(wallet.reservedBalance).toBe(100); // held at booking time

        const res = await request(app).put(`/api/appointments/${booking.body.data._id}/status`)
            .set(authHeader(provider)).send({ status: 'no-show' });
        expect(res.status).toBe(200);

        wallet = (await request(app).get(`/api/wallet/mine/${provider._id}`).set(authHeader(client))).body.data.wallet;
        expect(wallet.reservedBalance).toBe(0); // released, not stranded
        expect(wallet.totalBalance).toBe(500); // not deducted (no-show = release, not charge)
    });
});

describe('A4 — recurring bookings are not stamped wallet-paid', () => {
    it('a recurring series on a wallet_required provider is cash, and reserves nothing', async () => {
        const provider = await makeProvider({ walletSettings: { enabled: true, bookingPaymentMode: 'wallet_required', refundsAllowed: true } });
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const svc = await makeService(provider._id, { price: 100, duration: 30 });
        const client = await makeUser();
        const topup = await request(app).post('/api/wallet/topup').set(authHeader(client))
            .send({ providerId: provider._id.toString(), amount: 500 });
        await request(app).post(`/api/wallet/topups/${topup.body.data._id}/approve`).set(authHeader(provider));

        const res = await request(app).post('/api/appointments').set(authHeader(client)).send({
            service: svc._id.toString(), appointmentDate: ymd(anchor()),
            startTime: '10:00', endTime: '10:30',
            isRecurring: true, recurrenceType: 'weekly', recurrenceInterval: 1,
        });
        expect(res.status).toBe(201);

        const appts = await Appointment.find({ customer: client._id });
        expect(appts.length).toBeGreaterThan(1); // a real series
        expect(appts.every(a => a.paymentMethod === 'cash')).toBe(true); // never stamped wallet

        // Nothing reserved: the client's held balance stays zero.
        const wallet = (await request(app).get(`/api/wallet/mine/${provider._id}`).set(authHeader(client))).body.data.wallet;
        expect(wallet.reservedBalance).toBe(0);
    });
});
