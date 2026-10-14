/**
 * The pricing arithmetic against the owner's specification (section 4's worked
 * N$200 example) and its safeguards.
 */
const PlatformSettings = require('../../models/PlatformSettings');
const { feesFor, ratesFor, simulate, bookplusNetFor } = require('../../services/pricing');

const base = () => ({
    plans: JSON.parse(JSON.stringify(PlatformSettings.DEFAULTS.plans)),
    processingFee: { bps: null, fixedCents: null, payer: 'business' },
    chargebackFeeCents: null,
    minCommissionCents: 0,
    minOnlineBookingCents: 0,
    opsCostPerTxCents: 0,
    vat: { registered: false, number: '', ratePct: 15 },
});
const rates = (plan, s = base()) => ({ plan, commissionBps: s.plans[plan].commissionBps, fixedFeeCents: s.plans[plan].fixedFeeCents });

describe('feesFor: the specification\'s N$200 example', () => {
    it('Basic: N$3.00 commission, N$197.00 to the business before processing fees', () => {
        const f = feesFor(20000, rates('basic'), base());
        expect(f.commissionCents).toBe(300);
        expect(f.businessShareCents).toBe(19700);
    });
    it('Standard: N$7.50 commission (3% + N$1.50), N$192.50 to the business', () => {
        const f = feesFor(20000, rates('standard'), base());
        expect(f.percentCommissionCents).toBe(600);
        expect(f.fixedFeeCents).toBe(150);
        expect(f.commissionCents).toBe(750);
        expect(f.businessShareCents).toBe(19250);
    });
});

describe('feesFor: processing fee and safeguards', () => {
    it('the business bears the processing fee once it is entered', () => {
        const s = base();
        s.processingFee = { bps: 350, fixedCents: 200, payer: 'business' }; // illustrative values only
        const f = feesFor(20000, rates('standard', s), s);
        expect(f.processingFeeCents).toBe(700 + 200);
        expect(f.businessShareCents).toBe(20000 - 750 - 900);
        expect(bookplusNetFor(f, s)).toBe(750);
    });
    it('no processing fee is charged while it is unknown, and that is reported', () => {
        const f = feesFor(20000, rates('basic'), base());
        expect(f.processingFeeKnown).toBe(false);
        expect(f.processingFeeCents).toBe(0);
    });
    it('a minimum commission lifts small bookings, never above the amount', () => {
        const s = { ...base(), minCommissionCents: 500 };
        expect(feesFor(5000, rates('basic', s), s)).toMatchObject({ commissionCents: 500, minCommissionApplied: true });
        expect(feesFor(300, rates('basic', s), s).commissionCents).toBe(300);
    });
    it('Bookplus net takes off VAT when registered, its own processing fee and its ops cost', () => {
        const s = base();
        s.vat = { registered: true, ratePct: 15 };
        s.processingFee = { bps: 300, fixedCents: 0, payer: 'bookplus' };
        s.opsCostPerTxCents = 50;
        const f = feesFor(20000, rates('standard', s), s);
        expect(f.businessShareCents).toBe(19250); // Bookplus bears the processing fee
        expect(bookplusNetFor(f, s)).toBe(Math.round(750 / 1.15) - 600 - 50);
    });
});

describe('ratesFor', () => {
    it('no plan chosen: no online payments', () => {
        expect(ratesFor({ pricing: {} }, base())).toBeNull();
    });
    it('a business keeps the rates it agreed, unless overridden', () => {
        const s = base();
        s.plans.standard.commissionBps = 500; // the owner changed the default later
        const agreed = { pricing: { plan: 'standard', rates: { commissionBps: 300, fixedFeeCents: 150 } } };
        expect(ratesFor(agreed, s)).toEqual({ plan: 'standard', commissionBps: 300, fixedFeeCents: 150 });
        const custom = { pricing: { plan: 'standard', rates: { commissionBps: 300, fixedFeeCents: 150 }, override: { commissionBps: 250 } } };
        expect(ratesFor(custom, s)).toEqual({ plan: 'standard', commissionBps: 250, fixedFeeCents: 150 });
    });
});

describe('simulate', () => {
    it('covers both plans at N$50, 100, 200, 500 and 1 000', () => {
        const sim = simulate(base());
        expect(sim.rows).toHaveLength(10);
        expect(sim.rows.map((r) => r.bookingCents)).toEqual([5000, 10000, 20000, 50000, 100000, 5000, 10000, 20000, 50000, 100000]);
        const std50 = sim.rows.find((r) => r.plan === 'standard' && r.bookingCents === 5000);
        expect(std50.commissionCents).toBe(150 + 150);
        expect(sim.processingFeeKnown).toBe(false);
        expect(sim.chargebackFeeKnown).toBe(false);
    });
    it('flags a negative margin when Bookplus bears costs above its commission', () => {
        const s = base();
        s.processingFee = { bps: 300, fixedCents: 300, payer: 'bookplus' };
        const sim = simulate(s);
        const basic50 = sim.rows.find((r) => r.plan === 'basic' && r.bookingCents === 5000);
        expect(basic50.negativeMargin).toBe(true);
        expect(sim.anyNegative).toBe(true);
    });
});
