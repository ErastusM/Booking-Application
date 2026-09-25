/**
 * Gift cards — sold by a business (paid outside the app), redeemed by a client
 * into their wallet with that business. Redemption is single-winner and a
 * cancelled card can never be spent.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const GiftCard = require('../../models/GiftCard');
const emailService = require('../../utils/emailService');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

let seq = 0;
const walletProvider = (extra = {}) => makeProvider({
    email: `owner${++seq}@test.com`,
    businessProfile: { businessName: 'Vido Barber' },
    walletSettings: { enabled: true, bookingPaymentMode: 'wallet_optional' },
    ...extra,
});
const client = () => makeUser({ role: 'customer', email: `client${++seq}@test.com` });
const sell = (owner, body = {}) => request(app).post('/api/giftcards').set(authHeader(owner))
    .send({ amount: 300, recipientName: 'Ndapewa Shilongo', recipientEmail: 'ndapewa@example.com', fromName: 'Tomas', message: 'Happy birthday!', paid: true, ...body });

describe('selling', () => {
    test('creates a card with a readable code and emails the recipient', async () => {
        const owner = await walletProvider();
        const res = await sell(owner);
        expect(res.status).toBe(201);
        expect(res.body.data.code).toMatch(/^GIFT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
        expect(res.body.data.status).toBe('active');
        expect(res.body.data.emailed).toBe(true);
        expect(emailService.sendGiftCard).toHaveBeenCalledWith('ndapewa@example.com', expect.objectContaining({ code: res.body.data.code, businessName: 'Vido Barber' }));
    });

    test('refuses without payment confirmation, a name, or a sane amount', async () => {
        const owner = await walletProvider();
        expect((await sell(owner, { paid: false })).status).toBe(400);
        expect((await sell(owner, { recipientName: ' ' })).status).toBe(400);
        expect((await sell(owner, { amount: 0 })).status).toBe(400);
        expect((await sell(owner, { recipientEmail: 'not-an-email' })).status).toBe(400);
    });

    test('needs the client wallet switched on', async () => {
        const owner = await makeProvider({ email: 'nowallet@test.com' });
        const res = await sell(owner);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('wallet_off');
    });

    test('lists the business’s cards with sold and unused totals', async () => {
        const owner = await walletProvider();
        await sell(owner, { amount: 300 });
        const b = await sell(owner, { amount: 500 });
        const c = await sell(owner, { amount: 200 });
        await request(app).post(`/api/giftcards/${c.body.data._id}/void`).set(authHeader(owner));
        const redeemer = await client();
        await request(app).post('/api/giftcards/redeem').set(authHeader(redeemer)).send({ code: b.body.data.code });

        const res = await request(app).get('/api/giftcards').set(authHeader(owner));
        expect(res.status).toBe(200);
        expect(res.body.data.cards).toHaveLength(3);
        expect(res.body.data.totals).toEqual({ sold: 800, unused: 300 });
        expect(res.body.data.walletEnabled).toBe(true);
    });

    test('staff and clients cannot sell', async () => {
        const staff = await makeUser({ role: 'staff', email: 'staff@test.com' });
        expect((await sell(staff)).status).toBe(403);
        expect((await sell(await client())).status).toBe(403);
    });
});

describe('redeeming', () => {
    test('credits the client’s wallet with that business and records it', async () => {
        const owner = await walletProvider();
        const { body } = await sell(owner, { amount: 300 });
        const redeemer = await client();

        // Typed lower-case and without the dashes still works.
        const code = body.data.code.replace(/-/g, '').toLowerCase();
        const res = await request(app).post('/api/giftcards/redeem').set(authHeader(redeemer)).send({ code });
        expect(res.status).toBe(200);
        expect(res.body.data.amount).toBe(300);
        expect(res.body.data.balance).toBe(300);

        const wallet = await Wallet.findOne({ customer: redeemer._id, provider: owner._id });
        expect(wallet.totalBalance).toBe(300);
        const txn = await WalletTransaction.findOne({ wallet: wallet._id, type: 'giftcard' });
        expect(txn.status).toBe('approved');
        expect(txn.reference).toBe(body.data.code);
        const card = await GiftCard.findById(body.data._id);
        expect(card.status).toBe('redeemed');
        expect(String(card.redeemedBy)).toBe(String(redeemer._id));
    });

    test('a code can only be redeemed once, even by two people at the same time', async () => {
        const owner = await walletProvider();
        const { body } = await sell(owner);
        const [a, b] = await Promise.all([client(), client()]);
        const results = await Promise.all([a, b].map((u) =>
            request(app).post('/api/giftcards/redeem').set(authHeader(u)).send({ code: body.data.code })));
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        const credited = await Wallet.find({ provider: owner._id, totalBalance: { $gt: 0 } });
        expect(credited).toHaveLength(1);
    });

    test('a cancelled card or an unknown code credits nothing', async () => {
        const owner = await walletProvider();
        const { body } = await sell(owner);
        await request(app).post(`/api/giftcards/${body.data._id}/void`).set(authHeader(owner));
        const redeemer = await client();
        const voided = await request(app).post('/api/giftcards/redeem').set(authHeader(redeemer)).send({ code: body.data.code });
        expect(voided.status).toBe(409);
        expect(voided.body.message).toMatch(/cancelled/);
        expect((await request(app).post('/api/giftcards/redeem').set(authHeader(redeemer)).send({ code: 'GIFT-AAAA-BBBB' })).status).toBe(404);
        expect(await Wallet.countDocuments({ totalBalance: { $gt: 0 } })).toBe(0);
    });

    test('business accounts redeem with their client account, not here', async () => {
        const owner = await walletProvider();
        const { body } = await sell(owner);
        const res = await request(app).post('/api/giftcards/redeem').set(authHeader(owner)).send({ code: body.data.code });
        expect(res.status).toBe(403);
    });
});

describe('cancelling', () => {
    test('only the selling business can cancel, and only before redemption', async () => {
        const owner = await walletProvider();
        const other = await walletProvider();
        const { body } = await sell(owner);
        expect((await request(app).post(`/api/giftcards/${body.data._id}/void`).set(authHeader(other))).status).toBe(404);

        const redeemer = await client();
        await request(app).post('/api/giftcards/redeem').set(authHeader(redeemer)).send({ code: body.data.code });
        const late = await request(app).post(`/api/giftcards/${body.data._id}/void`).set(authHeader(owner));
        expect(late.status).toBe(409);
        expect((await GiftCard.findById(body.data._id)).status).toBe('redeemed');
    });
});
