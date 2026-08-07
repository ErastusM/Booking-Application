/**
 * Concurrency tests for the wallet money paths. The correctness guarantee is that
 * a resolution (complete / release / approve) claims its row via an atomic status
 * flip, so a double-click or retry can never move money twice. Uses walletService
 * directly against the in-memory Mongo (no HTTP layer).
 */
const mongoose = require('mongoose');
const testDb = require('../helpers/testDb');
const walletService = require('../../utils/walletService');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const pair = () => ({ customer: new mongoose.Types.ObjectId(), provider: new mongoose.Types.ObjectId() });
const fund = async (customer, provider, amount) => {
    const t = await walletService.createTopUp({ customer, provider, amount });
    await walletService.approveTopUp({ transactionId: t._id, providerId: provider });
};

describe('wallet resolution is single-winner under concurrency', () => {
    it('completing twice concurrently debits exactly once', async () => {
        const { customer, provider } = pair();
        await fund(customer, provider, 100);
        const appointmentId = new mongoose.Types.ObjectId();
        await walletService.reserveFunds({ customer, provider, amount: 40, appointmentId });

        const [a, b] = await Promise.all([
            walletService.deductForCompletion({ appointmentId }),
            walletService.deductForCompletion({ appointmentId }),
        ]);

        expect((a.deducted || 0) + (b.deducted || 0)).toBe(40); // one debit, not two
        const wallet = await Wallet.findOne({ customer, provider });
        expect(wallet.totalBalance).toBe(60);
        expect(wallet.reservedBalance).toBe(0);
        expect(await WalletTransaction.countDocuments({ appointment: appointmentId, type: 'deduction' })).toBe(1);
    });

    it('approving a top-up twice concurrently credits exactly once', async () => {
        const { customer, provider } = pair();
        const t = await walletService.createTopUp({ customer, provider, amount: 100 });

        const [a, b] = await Promise.all([
            walletService.approveTopUp({ transactionId: t._id, providerId: provider }),
            walletService.approveTopUp({ transactionId: t._id, providerId: provider }),
        ]);

        expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
        const wallet = await Wallet.findOne({ customer, provider });
        expect(wallet.totalBalance).toBe(100); // not 200
    });

    it('a release racing a completion resolves the hold exactly once', async () => {
        const { customer, provider } = pair();
        await fund(customer, provider, 100);
        const appointmentId = new mongoose.Types.ObjectId();
        await walletService.reserveFunds({ customer, provider, amount: 50, appointmentId });

        const [rel, ded] = await Promise.all([
            walletService.releaseReservation({ appointmentId }),
            walletService.deductForCompletion({ appointmentId }),
        ]);

        expect((rel.released ? 1 : 0) + (ded.deducted ? 1 : 0)).toBe(1);
        const wallet = await Wallet.findOne({ customer, provider });
        expect(wallet.reservedBalance).toBe(0);
        expect([50, 100]).toContain(wallet.totalBalance); // deducted → 50, released → 100
    });
});
