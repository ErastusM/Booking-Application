/**
 * The finance dashboard (payment specification, section 15), worked through
 * by hand: two businesses on different plans, a part refund, a lost chargeback
 * recovered, and the month's running costs. Every figure below follows from
 * the fee rules; the net per booking is the simulator's formula.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendStaffBookingAlert: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Payment = require('../../models/Payment');
const PlatformSettings = require('../../models/PlatformSettings');
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const pricing = require('../../services/pricing');
const { periodOf, monthsIn } = require('../../services/financeDashboard');
const {
    makeProvider, makeFinanceAdmin, makeService, authHeader, financeHeader, APPROVED_FOR_PAYMENTS,
} = require('../helpers/factories');
const { futureDate } = require('../helpers/dates');
const { createFakePaygate } = require('../helpers/fakePaygate');

const gw = createFakePaygate();

beforeAll(async () => { gw.install(); await testDb.connect(); });
afterAll(async () => { gw.uninstall(); await testDb.closeDatabase(); });
afterEach(async () => { gw.reset(); await testDb.clearDatabase(); });

const setSettings = async (set) => {
    await pricing.getSettings({ fresh: true });
    await PlatformSettings.updateOne({ key: 'platform' }, { $set: set });
};

const business = async (name, plan, rates) => {
    const owner = await makeProvider({
        businessProfile: { businessName: name, currency: 'NAD' }, paymentSettings: { mode: 'full' },
        paymentsApproval: { ...APPROVED_FOR_PAYMENTS }, pricing: { plan, rates, planAssignedAt: new Date() },
    });
    return { owner, service: async (price) => makeService(owner._id, { name: `Service ${price}`, price, duration: 30 }) };
};

let slot = 0;
const paid = async (service) => {
    slot += 1;
    const res = await request(app).post('/api/appointments').send({
        service: service._id, appointmentDate: futureDate(slot), startTime: '10:00', endTime: '10:30',
        guestName: 'Ana Shilongo', guestEmail: `ana${slot}@example.com`,
    });
    expect(res.status).toBe(201);
    gw.setStatus(res.body.payment.reference, 1);
    await request(app).post('/api/payments/paygate/notify').type('form').send(gw.notifyBody(res.body.payment.reference));
    return Payment.findOne({ reference: res.body.payment.reference }).lean();
};

describe('finance dashboard', () => {
    it('businesses, revenue, costs, net contribution, break-even, bands and plans for the month', async () => {
        const fin = await makeFinanceAdmin({ adminRoles: ['finance'] });
        const dir = await makeFinanceAdmin({ adminRoles: ['director'] });
        // Card processing 3%, borne by the business; Bookplus's own cost N$1 a booking.
        await setSettings({ 'processingFee.bps': 300, 'processingFee.fixedCents': 0, 'processingFee.payer': 'business', opsCostPerTxCents: 100, chargebackFeeCents: 15000 });

        const a = await business('Vibe Cuts', 'standard', { commissionBps: 300, fixedFeeCents: 150 });
        const b = await business('Glow Spa', 'basic', { commissionBps: 150, fixedFeeCents: 0 });
        const a200 = await paid(await a.service(200)); // 3% 600 + 150 = 750; processing 600
        await paid(await a.service(50)); // 150 + 150 = 300; processing 150
        const b500 = await paid(await b.service(500)); // 1.5% = 750; processing 1500

        // Half of A's N$200 back: half the 3% (300) is handed back, the fixed fee stays.
        const half = await request(app).post(`/api/payments/${a200._id}/refund`).set(authHeader(a.owner)).send({ amountCents: 10000, reason: 'Half done' });
        expect(half.status).toBe(200);

        // B's N$500 is charged back and lost; recovered from B (amount + N$150 fee).
        const kase = await request(app).post('/api/admin/finance/disputes').set(financeHeader(fin)).send({ paymentId: b500._id, kind: 'chargeback', summary: 'Card holder says no' });
        const lost = await request(app).post(`/api/admin/finance/disputes/${kase.body.data._id}/close`).set(financeHeader(fin)).send({ outcome: 'lost', note: 'Bank decided', recover: {} });
        await request(app).post(`/api/admin/finance/requests/${lost.body.data.recovery.request}/approve`).set(financeHeader(dir)).send({});

        // This month's running costs: a director enters them; finance can't.
        const month = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
        const costs = { items: [{ category: 'hosting', label: 'Server', amountCents: 40000 }, { category: 'marketing', amountCents: 10000 }], reason: 'October bills' };
        expect((await request(app).put(`/api/admin/finance/costs/${month}`).set(financeHeader(fin)).send(costs)).status).toBe(403);
        const put = await request(app).put(`/api/admin/finance/costs/${month}`).set(financeHeader(dir)).send(costs);
        expect(put.body.data.totalCents).toBe(50000);
        expect(await FinancialAuditLog.findOne({ action: 'costs.update' }).lean()).toMatchObject({ amountCents: 50000, details: { month, before: 0, after: 50000 } });
        expect((await request(app).get(`/api/admin/finance/costs?month=${month}`).set(financeHeader(fin))).body.data).toMatchObject({ totalCents: 50000, items: [{ category: 'hosting', label: 'Server' }, { category: 'marketing' }] });

        const res = await request(app).get('/api/admin/finance/dashboard').set(financeHeader(fin));
        expect(res.status).toBe(200);
        const d = res.body.data;

        expect(d.businesses).toMatchObject({ approved: 2, takingPayments: 2, byPlan: { basic: 1, standard: 1, none: 0 }, basicInTrial: 1, basicIntroPrice: 0 });
        expect(d.bookings).toEqual({ paidOnline: 3, valueCents: 75000, averageValueCents: 25000 });
        // Kept: 450 (750 less the 300 handed back) + 300 + 750.
        expect(d.revenue).toMatchObject({ commissionCents: 1500, subscriptionCents: 0, totalCents: 1500, byPlan: { standard: 750, basic: 750, none: 0 } });
        expect(d.costs).toMatchObject({
            processingCostCents: 2250, processingRecoveredCents: 2250, processingBorneCents: 0,
            opsCostCents: 300, refundsToClientsCents: 10000, refunds: 1,
            chargebacksLost: 1, chargebackLossCents: 65000, chargebackRecoveredCents: 65000,
            fixedCostsCents: 50000, fixedCostsByCategory: { hosting: 40000, marketing: 10000 }, fixedCostMonthsEntered: [month],
        });
        // Net per booking: 450-100, 300-100, 750-100. The chargeback is a wash once recovered.
        expect(d.results).toMatchObject({
            netContributionCents: 1200,
            afterFixedCostsCents: 1200 - 50000,
            perBooking: { averageNetCents: 400, minNetCents: 200, negativeBookings: 0 },
            breakEven: { fixedCostsCents: 50000, coveredPct: 2, moreBookingsNeeded: Math.ceil((50000 - 1200) / 400) },
        });
        const band = (k) => d.results.byBand.find((x) => x.key === k);
        expect(band('under_100')).toMatchObject({ bookings: 1, valueCents: 5000, netCents: 200 });
        expect(band('200_499')).toMatchObject({ bookings: 1, valueCents: 20000, netCents: 350 });
        expect(band('500_999')).toMatchObject({ bookings: 1, valueCents: 50000, netCents: 650 });
        expect(band('1000_up')).toMatchObject({ bookings: 0, averageNetCents: null });
        expect(d.results.byPlan.standard).toMatchObject({ bookings: 2, commissionCents: 750, netCents: 550, averageNetCents: 275 });
        expect(d.results.byPlan.basic).toMatchObject({ bookings: 1, netCents: 650 });
        expect(d.results.businesses.rows.map((r) => [r.businessName, r.netCents])).toEqual([['Glow Spa', 650], ['Vibe Cuts', 550]]);
    });

    it('a booking that loses money shows up: Bookplus bears processing above its commission', async () => {
        const fin = await makeFinanceAdmin({ adminRoles: ['finance'] });
        await setSettings({ 'processingFee.bps': 300, 'processingFee.fixedCents': 200, 'processingFee.payer': 'bookplus', opsCostPerTxCents: 100 });
        const a = await business('Tiny Fees', 'basic', { commissionBps: 150, fixedFeeCents: 0 });
        await paid(await a.service(50)); // commission 75; processing 150 + 200 = 350 borne by Bookplus; ops 100
        const d = (await request(app).get('/api/admin/finance/dashboard').set(financeHeader(fin))).body.data;
        expect(d.costs).toMatchObject({ processingCostCents: 350, processingRecoveredCents: 0, processingBorneCents: 350 });
        expect(d.results.perBooking).toMatchObject({ minNetCents: 75 - 350 - 100, negativeBookings: 1 });
        expect(d.results.businesses).toMatchObject({ count: 1, negative: 1 });
        expect(d.results.breakEven).toMatchObject({ fixedCostsCents: 0, coveredPct: null, moreBookingsNeeded: 0 });
    });

    it('periods: this month by default, a chosen range, nonsense refused', async () => {
        const fin = await makeFinanceAdmin({ adminRoles: ['finance'] });
        const now = new Date('2026-10-14T22:30:00Z'); // 00:30 on 15 October in Windhoek
        expect(periodOf(undefined, undefined, now)).toMatchObject({ from: '2026-10-01', to: '2026-10-15' });
        expect(periodOf('2026-01-01', '2026-03-31').start.toISOString()).toBe('2025-12-31T22:00:00.000Z');
        expect(monthsIn('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
        expect(periodOf('2026-03-01', '2026-01-01')).toBeNull();
        expect(periodOf('2020-01-01', '2026-01-01')).toBeNull();
        expect((await request(app).get('/api/admin/finance/dashboard?from=2026-03-01&to=2026-01-01').set(financeHeader(fin))).body.code).toBe('bad_period');
        // A business can't see it.
        const owner = await makeProvider();
        expect((await request(app).get('/api/admin/finance/dashboard').set(authHeader(owner))).status).toBe(403);
    });
});
