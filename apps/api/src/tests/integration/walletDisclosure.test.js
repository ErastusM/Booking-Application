/**
 * Wallet disclosures (compliance scorecard point 13).
 *   - A business's wallet rules (refundable or not, expiry period) reach the
 *     client BEFORE they pay, on the top-up endpoint and on every wallet card.
 *   - The expiry date shown matches the date the nightly sweep would zero it.
 *   - Clients are warned 30 and 7 days before a balance expires, by email and
 *     in-app, once per reminder, without the reminder itself resetting the clock.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
    sendWalletExpiryReminder: jest.fn().mockResolvedValue(true),
    sendWalletTopUpReceipt: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Wallet = require('../../models/Wallet');
const Notification = require('../../models/Notification');
const WalletTransaction = require('../../models/WalletTransaction');
const emailService = require('../../utils/emailService');
const { runReminderSweep, runExpirySweep, expiryDateFor, effectiveExpiryFor } = require('../../utils/walletExpiryService');
const User = require('../../models/User');
const { makeProvider, makeUser, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => {
    await testDb.clearDatabase();
    jest.clearAllMocks();
});

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;

const providerWith = (walletSettings, businessProfile = {}) => makeProvider({
    walletSettings: { enabled: true, bookingPaymentMode: 'wallet_optional', ...walletSettings },
    businessProfile: { businessName: 'Glow Studio', currency: 'ZAR', ...businessProfile },
});

// A funded wallet whose last activity was `idleDays` ago.
const fundedWallet = async (client, provider, { balance = 250, idleDays = 0, reserved = 0 } = {}) => {
    const w = await Wallet.create({ customer: client._id, provider: provider._id, totalBalance: balance, reservedBalance: reserved });
    const at = new Date(Date.now() - idleDays * DAY);
    await Wallet.collection.updateOne({ _id: w._id }, { $set: { updatedAt: at } });
    return Wallet.findById(w._id);
};

describe('Wallet rules are disclosed to the client', () => {
    it('the top-up endpoint returns refundability and the expiry period before any wallet exists', async () => {
        const provider = await providerWith({ refundsAllowed: false, expiryMonths: 12 });
        const client = await makeUser();
        const res = await request(app).get(`/api/wallet/mine/${provider._id}`).set(authHeader(client));
        expect(res.status).toBe(200);
        expect(res.body.data.settings.refundsAllowed).toBe(false);
        expect(res.body.data.settings.expiryMonths).toBe(12);
        expect(res.body.data.settings.expiresAt).toBeNull(); // no balance yet
    });

    it('a business with no rules reads as refundable with no expiry', async () => {
        const provider = await makeProvider({ walletSettings: { enabled: true } });
        const client = await makeUser();
        const res = await request(app).get(`/api/wallet/mine/${provider._id}`).set(authHeader(client));
        expect(res.body.data.settings.refundsAllowed).toBe(true);
        expect(res.body.data.settings.expiryMonths).toBeNull();
    });

    it('each wallet card carries its rules and expiry date, and no other wallet settings', async () => {
        const provider = await providerWith({ refundsAllowed: false, expiryMonths: 6, paymentInstructions: 'Bank: 123' });
        const client = await makeUser();
        const w = await fundedWallet(client, provider, { idleDays: 10 });

        const res = await request(app).get('/api/wallet/mine').set(authHeader(client));
        expect(res.status).toBe(200);
        const card = res.body.data[0];
        expect(card.rules.refundsAllowed).toBe(false);
        expect(card.rules.expiryMonths).toBe(6);
        expect(new Date(card.rules.expiresAt).getTime()).toBe(new Date(w.updatedAt).getTime() + 6 * MONTH);
        expect(card.provider.walletSettings).toBeUndefined();
        expect(card.expiryReminder).toBeUndefined();
    });

    it('no expiry date when the business has no expiry or funds are reserved', async () => {
        const client = await makeUser();
        const noExpiry = await providerWith({ expiryMonths: null });
        await fundedWallet(client, noExpiry);
        const reservedBiz = await providerWith({ expiryMonths: 12 }, { businessName: 'Other' });
        await fundedWallet(client, reservedBiz, { reserved: 50 });

        const res = await request(app).get('/api/wallet/mine').set(authHeader(client));
        expect(res.body.data).toHaveLength(2);
        for (const card of res.body.data) expect(card.rules.expiresAt).toBeNull();
    });

    it('normal lifecycle: 30-day and 7-day reminders, then the sweep removes it on the date shown', async () => {
        const provider = await providerWith({ expiryMonths: 6 });
        const client = await makeUser();
        const now = Date.now();
        const w = await fundedWallet(client, provider, { idleDays: 6 * 30 - 20 }); // base date in 20 days
        expect(await runReminderSweep(now)).toBe(1); // 30-day
        expect(await runReminderSweep(now + 14 * DAY)).toBe(1); // 6 days left → 7-day
        const shown = effectiveExpiryFor(await Wallet.findById(w._id), 6);
        // The 7-day reminder always leaves at least 7 days.
        expect(shown.getTime()).toBe(now + 21 * DAY);

        // On the base date the notice has not run 7 days yet: nothing removed.
        expect((await runExpirySweep(now + 20 * DAY)).expired).toBe(0);
        expect((await Wallet.findById(w._id)).totalBalance).toBe(250);
        // Just after the date that was shown: removed.
        expect((await runExpirySweep(now + 21 * DAY + 60000)).expired).toBe(1);
        expect((await Wallet.findById(w._id)).totalBalance).toBe(0);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(2);
    });
});

describe('No balance expires without a delivered 7-day reminder', () => {
    it('switching expiry on for a long-idle wallet gives a 7-day notice instead of zeroing it', async () => {
        const provider = await providerWith({ expiryMonths: null });
        const client = await makeUser({ email: 'idle@example.com' });
        const w = await fundedWallet(client, provider, { idleDays: 200 });
        const now = Date.now();
        await User.updateOne({ _id: provider._id }, { $set: { 'walletSettings.expiryMonths': 6 } });

        const first = await runExpirySweep(now);
        expect(first).toEqual({ expired: 0, noticed: 1 });
        expect((await Wallet.findById(w._id)).totalBalance).toBe(250);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(1);
        expect(emailService.sendWalletExpiryReminder.mock.calls[0][1].daysLeft).toBe(7);

        // The wallet card shows the new, later date.
        const res = await request(app).get('/api/wallet/mine').set(authHeader(client));
        expect(new Date(res.body.data[0].rules.expiresAt).getTime()).toBe(now + 7 * DAY);

        expect((await runExpirySweep(now + 6 * DAY)).expired).toBe(0);
        expect((await runExpirySweep(now + 7 * DAY + 60000)).expired).toBe(1);
        expect((await Wallet.findById(w._id)).totalBalance).toBe(0);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(1);
    });

    it('shortening the expiry period gives a 7-day notice instead of zeroing it', async () => {
        const provider = await providerWith({ expiryMonths: 24 });
        const client = await makeUser();
        const w = await fundedWallet(client, provider, { idleDays: 300 });
        expect(await runReminderSweep()).toBe(0); // ~420 days left under 24 months
        await User.updateOne({ _id: provider._id }, { $set: { 'walletSettings.expiryMonths': 6 } });

        expect(await runExpirySweep()).toEqual({ expired: 0, noticed: 1 });
        expect((await Wallet.findById(w._id)).totalBalance).toBe(250);
        // The 07:15 reminder run does not send it again.
        expect(await runReminderSweep()).toBe(0);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(1);
    });

    it('a failed reminder email is not counted: nothing expires until one is delivered', async () => {
        const provider = await providerWith({ expiryMonths: 6 });
        const client = await makeUser();
        const w = await fundedWallet(client, provider, { idleDays: 6 * 30 + 3 });
        const now = Date.now();
        emailService.sendWalletExpiryReminder.mockResolvedValueOnce({ error: true });

        expect(await runExpirySweep(now)).toEqual({ expired: 0, noticed: 0 });
        let after = await Wallet.findById(w._id);
        expect(after.totalBalance).toBe(250);
        expect(after.expiryReminder.d7SentAt).toBeNull();
        expect(await Notification.countDocuments({ user: client._id })).toBe(0);

        // A week later still nothing expires; the reminder is retried and delivered.
        expect(await runExpirySweep(now + 8 * DAY)).toEqual({ expired: 0, noticed: 1 });
        after = await Wallet.findById(w._id);
        expect(after.totalBalance).toBe(250);
        // Removed only 7 days after the DELIVERED reminder.
        expect((await runExpirySweep(now + 14 * DAY)).expired).toBe(0);
        expect((await runExpirySweep(now + 15 * DAY + 60000)).expired).toBe(1);
    });

    it('a thrown email error is treated the same way', async () => {
        const provider = await providerWith({ expiryMonths: 6 });
        const client = await makeUser();
        const w = await fundedWallet(client, provider, { idleDays: 6 * 30 - 20 });
        emailService.sendWalletExpiryReminder.mockRejectedValueOnce(new Error('SMTP down'));
        expect(await runReminderSweep()).toBe(0);
        expect((await Wallet.findById(w._id)).expiryReminder.d30SentAt).toBeNull();
        expect(await runReminderSweep()).toBe(1); // retried next run
    });
});

describe('Expiry reminders (30 and 7 days before)', () => {
    it('sends the 30-day reminder once, by email and in-app, in the business currency', async () => {
        const provider = await providerWith({ expiryMonths: 6 });
        const client = await makeUser({ email: 'wallet-client@example.com' });
        // Expires in 20 days.
        const w = await fundedWallet(client, provider, { idleDays: 6 * 30 - 20 });

        expect(await runReminderSweep()).toBe(1);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(1);
        const [to, args] = emailService.sendWalletExpiryReminder.mock.calls[0];
        expect(to).toBe('wallet-client@example.com');
        expect(args).toMatchObject({ businessName: 'Glow Studio', amountLabel: 'R250.00', daysLeft: 20, months: 6 });

        const notes = await Notification.find({ user: client._id, type: 'wallet' });
        expect(notes).toHaveLength(1);
        expect(notes[0].message).toMatch(/R250\.00 wallet balance with Glow Studio expires on/);

        // Running again the same day (or tomorrow) does not repeat it.
        expect(await runReminderSweep()).toBe(0);
        expect(await runReminderSweep(Date.now() + DAY)).toBe(0);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(1);

        // Recording the reminder did not count as wallet activity.
        const after = await Wallet.findById(w._id);
        expect(after.updatedAt.getTime()).toBe(w.updatedAt.getTime());
        expect(after.expiryReminder.d30SentAt).toBeTruthy();
    });

    it('then sends the 7-day reminder when the date is a week away', async () => {
        const provider = await providerWith({ expiryMonths: 12 });
        const client = await makeUser();
        await fundedWallet(client, provider, { idleDays: 12 * 30 - 20 });
        expect(await runReminderSweep()).toBe(1); // 30-day
        expect(await runReminderSweep(Date.now() + 14 * DAY)).toBe(1); // now 6 days left → 7-day
        expect(await runReminderSweep(Date.now() + 15 * DAY)).toBe(0);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(2);
        expect(emailService.sendWalletExpiryReminder.mock.calls[1][1].daysLeft).toBe(7); // a 7-day notice always leaves 7 days
    });

    it('a wallet first seen inside the last week gets only the 7-day reminder', async () => {
        const provider = await providerWith({ expiryMonths: 6 });
        const client = await makeUser();
        await fundedWallet(client, provider, { idleDays: 6 * 30 - 3 });
        expect(await runReminderSweep()).toBe(1);
        expect(await runReminderSweep()).toBe(0);
        expect(emailService.sendWalletExpiryReminder.mock.calls[0][1].daysLeft).toBe(7); // pushed so the notice is a full week
    });

    it('does not remind too early, for reserved funds, empty wallets, or businesses without expiry', async () => {
        const client = await makeUser();
        const p1 = await providerWith({ expiryMonths: 6 });
        await fundedWallet(client, p1, { idleDays: 10 }); // ~170 days left
        const p2 = await providerWith({ expiryMonths: 6 }, { businessName: 'B2' });
        await fundedWallet(client, p2, { idleDays: 6 * 30 - 5, reserved: 20 });
        const p3 = await providerWith({ expiryMonths: 6 }, { businessName: 'B3' });
        await fundedWallet(client, p3, { idleDays: 6 * 30 - 5, balance: 0 });
        const p4 = await providerWith({ expiryMonths: null }, { businessName: 'B4' });
        await fundedWallet(client, p4, { idleDays: 400 });

        expect(await runReminderSweep()).toBe(0);
        expect(emailService.sendWalletExpiryReminder).not.toHaveBeenCalled();
    });

    it('activity after a reminder moves the date and starts a fresh cycle', async () => {
        const provider = await providerWith({ expiryMonths: 6 });
        const client = await makeUser();
        const w = await fundedWallet(client, provider, { idleDays: 6 * 30 - 20 });
        expect(await runReminderSweep()).toBe(1);

        // The client spends/tops up: the wallet changes (updatedAt moves on).
        await Wallet.updateOne({ _id: w._id }, { $inc: { totalBalance: 50 } });
        expect(await runReminderSweep()).toBe(0); // new date is ~6 months away

        // ~6 months later, inside the 30-day window of the NEW date: reminded again.
        expect(await runReminderSweep(Date.now() + (6 * 30 - 20) * DAY)).toBe(1);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(2);
    });
});

describe('Top-up receipt email', () => {
    it('emails the client a receipt with the business rules when a top-up is approved', async () => {
        const provider = await providerWith({ refundsAllowed: false, expiryMonths: 12 });
        const client = await makeUser({ email: 'receipt@example.com' });
        const created = await request(app).post('/api/wallet/topup').set(authHeader(client))
            .send({ providerId: provider._id.toString(), amount: 300, reference: 'BP-12345', rulesAcknowledged: true });
        expect(created.status).toBe(201);
        const ok = await request(app).post(`/api/wallet/topups/${created.body.data._id}/approve`).set(authHeader(provider));
        expect(ok.status).toBe(200);

        const end = Date.now() + 3000;
        while (!emailService.sendWalletTopUpReceipt.mock.calls.length && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
        expect(emailService.sendWalletTopUpReceipt).toHaveBeenCalledTimes(1);
        const [to, args] = emailService.sendWalletTopUpReceipt.mock.calls[0];
        expect(to).toBe('receipt@example.com');
        expect(args).toMatchObject({
            businessName: 'Glow Studio', amountLabel: 'R300.00', balanceLabel: 'R300.00', reference: 'BP-12345',
            refundsAllowed: false, expiryMonths: 12,
        });
    });
});

describe('Reminders are sent once, even when runs overlap', () => {
    it('two reminder runs at the same moment send one reminder (compare-and-set claim)', async () => {
        const provider = await providerWith({ expiryMonths: 6 });
        const client = await makeUser();
        await fundedWallet(client, provider, { idleDays: 6 * 30 - 20 });
        const counts = await Promise.all([runReminderSweep(), runReminderSweep(), runReminderSweep()]);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(1);
    });

    it('overlapping expiry runs give one late notice', async () => {
        const provider = await providerWith({ expiryMonths: 6 });
        const client = await makeUser();
        await fundedWallet(client, provider, { idleDays: 250 });
        const results = await Promise.all([runExpirySweep(), runExpirySweep(), runReminderSweep()]);
        const noticed = results[0].noticed + results[1].noticed + results[2];
        expect(noticed).toBe(1);
        expect(emailService.sendWalletExpiryReminder).toHaveBeenCalledTimes(1);
    });
});

describe('Deleted or deactivated customers get no reminders', () => {
    it.each([
        ['deactivated', { isActive: false }],
        ['deleted', { deletedAt: new Date() }],
        ['anonymised', { email: 'deleted_0123456789abcdef@deleted.bookplus' }],
    ])('%s account: skipped', async (_label, overrides) => {
        const provider = await providerWith({ expiryMonths: 6 });
        const client = await makeUser(overrides);
        await fundedWallet(client, provider, { idleDays: 6 * 30 - 5 });
        expect(await runReminderSweep()).toBe(0);
        expect(emailService.sendWalletExpiryReminder).not.toHaveBeenCalled();
        expect(await Notification.countDocuments({ user: client._id })).toBe(0);
    });
});

describe('Top-up requires confirming non-refundable or expiring rules', () => {
    const topUp = (client, provider, extra = {}) => request(app).post('/api/wallet/topup').set(authHeader(client))
        .send({ providerId: provider._id.toString(), amount: 100, ...extra });

    it('an older app that does not send the confirmation gets a clear 400', async () => {
        const provider = await providerWith({ refundsAllowed: false });
        const client = await makeUser();
        const res = await topUp(client, provider);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('WALLET_RULES_NOT_ACKNOWLEDGED');
        expect(res.body.message).toMatch(/update the app and confirm the wallet rules/i);
        expect(await WalletTransaction.countDocuments({ customer: client._id })).toBe(0);
    });

    it('expiring balances need it too; false is not accepted', async () => {
        const provider = await providerWith({ refundsAllowed: true, expiryMonths: 12 });
        const client = await makeUser();
        expect((await topUp(client, provider, { rulesAcknowledged: false })).status).toBe(400);
        expect((await topUp(client, provider, { rulesAcknowledged: 'yes' })).status).toBe(400);
    });

    it('with the confirmation, the top-up stores when and which rules were confirmed', async () => {
        const provider = await providerWith({ refundsAllowed: false, expiryMonths: 12 });
        const client = await makeUser();
        const res = await topUp(client, provider, { rulesAcknowledged: true });
        expect(res.status).toBe(201);
        const txn = await WalletTransaction.findById(res.body.data._id);
        expect(txn.rulesAcknowledgedAt).toBeInstanceOf(Date);
        expect(Date.now() - txn.rulesAcknowledgedAt.getTime()).toBeLessThan(60000);
        expect(txn.rulesShown).toMatchObject({ refundsAllowed: false, expiryMonths: 12 });
    });

    it('refundable balances with no expiry need no confirmation', async () => {
        const provider = await providerWith({ refundsAllowed: true, expiryMonths: null });
        const client = await makeUser();
        const res = await topUp(client, provider);
        expect(res.status).toBe(201);
        expect((await WalletTransaction.findById(res.body.data._id)).rulesAcknowledgedAt).toBeNull();
    });
});
