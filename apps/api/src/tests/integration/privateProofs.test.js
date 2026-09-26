/**
 * Bank proofs of payment are private (compliance audit point 10). They are
 * uploaded as Cloudinary `authenticated` assets with a server signature, never
 * serialized, and opened only through a short-lived signed link for the payer
 * and the business the money went to. Old public proofs are moved by an
 * idempotent migration. Cloudinary is mocked throughout (global fetch).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeAdmin, authHeader } = require('../helpers/factories');
const WalletTransaction = require('../../models/WalletTransaction');
const ProviderWalletTransaction = require('../../models/ProviderWalletTransaction');
const Wallet = require('../../models/Wallet');
const cloudinary = require('../../utils/cloudinary');
const { migratePrivateProofs, report } = require('../../../scripts/migrate_private_proofs');

const CLOUD = 'testcloud';
const realFetch = global.fetch;
let fetchCalls;

beforeAll(() => testDb.connect());
beforeEach(() => {
    process.env.CLOUDINARY_URL = `cloudinary://key123:secret456@${CLOUD}`;
    fetchCalls = [];
    global.fetch = jest.fn(async (url, opts = {}) => {
        fetchCalls.push({ url: String(url), opts });
        return { ok: true, status: 200, json: async () => ({}) };
    });
});
afterEach(async () => {
    global.fetch = realFetch;
    delete process.env.CLOUDINARY_URL;
    await testDb.clearDatabase();
});
afterAll(() => testDb.closeDatabase());

const proofFor = (user, name = 'receipt', format = 'pdf') => ({
    publicId: `${cloudinary.PROOF_FOLDER}/${user._id}/${name}`,
    resourceType: 'image',
    format,
});

describe('signed private upload', () => {
    it('hands out signed params for an authenticated upload in the caller’s own folder', async () => {
        const customer = await makeUser();
        const res = await request(app).post('/api/wallet/proof-upload').set(authHeader(customer));
        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(d.type).toBe('authenticated');
        expect(d.folder).toBe(`bookplus/proofs/${customer._id}`);
        expect(d.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${CLOUD}/auto/upload`);
        expect(d.apiKey).toBe('key123');
        expect(JSON.stringify(d)).not.toContain('secret456');
        const { timestamp, type, folder, allowed_formats: allowedFormats } = d;
        expect(d.signature).toBe(cloudinary.signParams({ timestamp, type, folder, allowed_formats: allowedFormats }, 'secret456'));
    });

    it('refuses (503) rather than falling back to a public upload when Cloudinary is not configured', async () => {
        delete process.env.CLOUDINARY_URL;
        const customer = await makeUser();
        const res = await request(app).post('/api/wallet/proof-upload').set(authHeader(customer));
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('proof_upload_unavailable');
    });

    it('needs a signed-in user', async () => {
        const res = await request(app).post('/api/wallet/proof-upload');
        expect(res.status).toBe(401);
    });
});

describe('client wallet top-up proofs', () => {
    const topUp = (customer, provider, body) => request(app).post('/api/wallet/topup').set(authHeader(customer))
        .send({ providerId: String(provider._id), amount: 100, reference: 'REF1', ...body });

    it('stores only a private reference from the payer’s own folder, and never serializes it', async () => {
        const [customer, provider] = [await makeUser(), await makeProvider()];
        const res = await topUp(customer, provider, { proof: proofFor(customer) });
        expect(res.status).toBe(201);
        expect(res.body.data.hasProof).toBe(true);
        expect(res.body.data.proof).toBeUndefined();
        expect(res.body.data.proofUrl).toBeUndefined();
        const row = await WalletTransaction.findById(res.body.data._id);
        expect(row.proof.publicId).toBe(`bookplus/proofs/${customer._id}/receipt`);
        expect(row.proof.deliveryType).toBe('authenticated');

        // Listings never carry it either.
        const list = await request(app).get('/api/wallet/provider/topups').set(authHeader(provider));
        expect(JSON.stringify(list.body)).not.toContain('bookplus/proofs');
    });

    it('logs the id (never the URL) when an old app sends a public proofUrl', async () => {
        const [customer, provider] = [await makeUser(), await makeProvider()];
        const warn = jest.spyOn(require('../../controllers/walletController')._logger, 'warn');
        const url = 'https://res.cloudinary.com/x/image/upload/v1/secret-proof.jpg';
        const r = await topUp(customer, provider, { proofUrl: url });
        expect(r.status).toBe(201);
        const call = warn.mock.calls.find(([o]) => o && o.legacyProofUrl);
        expect(call[0].transactionId).toBe(r.body.data._id);
        expect(JSON.stringify(call)).not.toContain('secret-proof');
        warn.mockRestore();
    });

    it('ignores someone else’s proof and bare public URLs', async () => {
        const [customer, other, provider] = [await makeUser(), await makeUser(), await makeProvider()];
        const a = await topUp(customer, provider, { proof: proofFor(other) });
        const b = await topUp(customer, provider, { proofUrl: 'https://res.cloudinary.com/x/image/upload/v1/p.jpg' });
        const c = await topUp(customer, provider, { proof: { ...proofFor(customer), publicId: `bookplus/proofs/${customer._id}/../x` } });
        for (const r of [a, b, c]) {
            expect(r.status).toBe(201);
            expect(r.body.data.hasProof).toBe(false);
        }
    });

    it('opens a short-lived signed link for the payer and the business owner only', async () => {
        const [customer, provider] = [await makeUser(), await makeProvider()];
        const [stranger, otherProvider, admin] = [await makeUser(), await makeProvider(), await makeAdmin()];
        const staff = await makeUser({ role: 'staff', staffOf: provider._id });
        const { body } = await topUp(customer, provider, { proof: proofFor(customer) });
        const id = body.data._id;

        for (const who of [customer, provider]) {
            const res = await request(app).get(`/api/wallet/topups/${id}/proof`).set(authHeader(who));
            expect(res.status).toBe(200);
            expect(res.headers['cache-control']).toBe('no-store');
            const url = new URL(res.body.data.url);
            expect(url.origin + url.pathname).toBe(`https://api.cloudinary.com/v1_1/${CLOUD}/image/download`);
            expect(url.searchParams.get('type')).toBe('authenticated');
            expect(url.searchParams.get('public_id')).toBe(`bookplus/proofs/${customer._id}/receipt`);
            const expires = Number(url.searchParams.get('expires_at'));
            expect(expires - Date.now() / 1000).toBeLessThanOrEqual(cloudinary.PROOF_LINK_SECONDS + 2);
            expect(expires - Date.now() / 1000).toBeGreaterThan(0);
            const params = Object.fromEntries([...url.searchParams].filter(([k]) => !['api_key', 'signature'].includes(k)));
            expect(url.searchParams.get('signature')).toBe(cloudinary.signParams(params, 'secret456'));
        }
        for (const who of [stranger, otherProvider, admin, staff]) {
            const res = await request(app).get(`/api/wallet/topups/${id}/proof`).set(authHeader(who));
            expect(res.status).toBe(404);
        }
    });
});

describe('business account top-up proofs', () => {
    it('only the paying business and Bookplus admins can open it', async () => {
        const [provider, otherProvider, admin, customer] = [await makeProvider(), await makeProvider(), await makeAdmin(), await makeUser()];
        const sub = await request(app).post('/api/provider-wallet/topup').set(authHeader(provider))
            .send({ amount: 500, reference: 'DEP-1', proof: proofFor(provider, 'dep', 'png') });
        expect(sub.status).toBe(201);
        expect(sub.body.data.transaction.hasProof).toBe(true);
        expect(sub.body.data.transaction.proofType).toBe('image');
        const id = sub.body.data.transaction._id;
        for (const who of [provider, admin]) {
            const res = await request(app).get(`/api/provider-wallet/topups/${id}/proof`).set(authHeader(who));
            expect(res.status).toBe(200);
            expect(res.body.data.url).toContain('/image/download?');
        }
        expect((await request(app).get(`/api/provider-wallet/topups/${id}/proof`).set(authHeader(otherProvider))).status).toBe(404);
        expect((await request(app).get(`/api/provider-wallet/topups/${id}/proof`).set(authHeader(customer))).status).toBe(403);
    });
});

describe('migrate_private_proofs', () => {
    const seedLegacy = async () => {
        const [customer, provider] = [await makeUser(), await makeProvider()];
        const wallet = await Wallet.create({ customer: customer._id, provider: provider._id });
        const t1 = await WalletTransaction.create({
            wallet: wallet._id, customer: customer._id, provider: provider._id, type: 'topup', status: 'pending', amount: 50,
            proofUrl: `https://res.cloudinary.com/${CLOUD}/image/upload/v1712345/abc123.jpg`,
        });
        const t2 = await ProviderWalletTransaction.create({
            provider: provider._id, type: 'topup', status: 'pending', amount: 90, proofType: 'pdf',
            proofUrl: `https://res.cloudinary.com/${CLOUD}/raw/upload/v99/folder/dep.pdf`,
        });
        const t3 = await WalletTransaction.create({
            wallet: wallet._id, customer: customer._id, provider: provider._id, type: 'topup', status: 'pending', amount: 5,
            proofUrl: 'https://example.com/elsewhere.png',
        });
        return { t1, t2, t3, customer, provider };
    };

    it('moves public proofs to authenticated delivery, records them, and is idempotent', async () => {
        const { t1, t2, t3 } = await seedLegacy();
        const r = await migratePrivateProofs();
        expect(r).toMatchObject({ configured: true, found: 3, moved: 2 });
        expect(r.skipped.map((s) => s.id)).toEqual([String(t3._id)]);

        const renames = fetchCalls.filter((c) => c.url.endsWith('/rename'));
        expect(renames.map((c) => c.url)).toEqual([
            `https://api.cloudinary.com/v1_1/${CLOUD}/image/rename`,
            `https://api.cloudinary.com/v1_1/${CLOUD}/raw/rename`,
        ]);
        const body = new URLSearchParams(renames[0].opts.body);
        expect(body.get('from_public_id')).toBe('abc123');
        expect(body.get('to_public_id')).toBe('abc123');
        expect(body.get('to_type')).toBe('authenticated');
        expect(body.get('invalidate')).toBe('true');

        const a = await WalletTransaction.findById(t1._id);
        expect(a.proofUrl).toBe('');
        expect(a.proof).toMatchObject({ publicId: 'abc123', resourceType: 'image', format: 'jpg', deliveryType: 'authenticated' });
        const b = await ProviderWalletTransaction.findById(t2._id);
        expect(b.proof).toMatchObject({ publicId: 'folder/dep.pdf', resourceType: 'raw' });

        // Second run: only the foreign URL is left, nothing is renamed again.
        fetchCalls.length = 0;
        const again = await migratePrivateProofs();
        expect(again.moved).toBe(0);
        expect(again.found).toBe(1);
        expect(fetchCalls.filter((c) => c.url.endsWith('/rename'))).toHaveLength(0);
    });

    it('records an asset an earlier run already moved (rename fails, asset exists as authenticated)', async () => {
        const { t1 } = await seedLegacy();
        global.fetch = jest.fn(async (url) => {
            const u = String(url);
            if (u.endsWith('/rename')) return { ok: false, status: 404, json: async () => ({ error: { message: 'Resource not found' } }) };
            if (u.includes('/resources/image/authenticated/abc123')) return { ok: true, status: 200, json: async () => ({}) };
            return { ok: false, status: 404, json: async () => ({}) };
        });
        const r = await migratePrivateProofs();
        expect(r.alreadyPrivate).toBe(1);
        expect((await WalletTransaction.findById(t1._id)).proof.publicId).toBe('abc123');
    });

    it('without Cloudinary credentials it changes nothing and lists the rows', async () => {
        delete process.env.CLOUDINARY_URL;
        const { t1 } = await seedLegacy();
        const r = await migratePrivateProofs();
        expect(r.configured).toBe(false);
        expect(r.pending).toHaveLength(3);
        expect(global.fetch).not.toHaveBeenCalled();
        expect((await WalletTransaction.findById(t1._id)).proofUrl).toContain('res.cloudinary.com');
    });

    it('the deploy log shows ids and counts only — never a proof URL', async () => {
        const { t1 } = await seedLegacy();
        delete process.env.CLOUDINARY_URL;
        const unconfigured = report(await migratePrivateProofs()).join('\n');
        process.env.CLOUDINARY_URL = `cloudinary://key123:secret456@${CLOUD}`;
        global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: `bad https://res.cloudinary.com/${CLOUD}/image/upload/abc123.jpg` } }) }));
        const failing = report(await migratePrivateProofs()).join('\n');
        // No keys: counts only — no ids, no URLs.
        expect(unconfigured).toContain('WalletTransaction: 2');
        expect(unconfigured).toContain('ProviderWalletTransaction: 1');
        expect(unconfigured).not.toContain(String(t1._id));
        // Keys but a failed move: the row id, so it can be fixed.
        expect(failing).toContain(String(t1._id));
        for (const out of [unconfigured, failing]) {
            expect(out).not.toMatch(/https?:\/\//);
            expect(out).not.toContain('abc123');
            expect(out).not.toContain('elsewhere.png');
        }
    });

    it('a legacy public proof is still shown only to the payer and the business', async () => {
        delete process.env.CLOUDINARY_URL;
        const { t1, customer, provider } = await seedLegacy();
        const stranger = await makeUser();
        expect((await request(app).get(`/api/wallet/topups/${t1._id}/proof`).set(authHeader(customer))).body.data.url).toContain('abc123.jpg');
        expect((await request(app).get(`/api/wallet/topups/${t1._id}/proof`).set(authHeader(provider))).status).toBe(200);
        expect((await request(app).get(`/api/wallet/topups/${t1._id}/proof`).set(authHeader(stranger))).status).toBe(404);
    });
});

describe('parseDeliveryUrl', () => {
    it.each([
        ['https://res.cloudinary.com/c/image/upload/v1/a/b.png', { cloudName: 'c', resourceType: 'image', type: 'upload', publicId: 'a/b', format: 'png' }],
        ['https://res.cloudinary.com/c/raw/upload/v1/r.pdf', { resourceType: 'raw', publicId: 'r.pdf', format: '' }],
        ['https://res.cloudinary.com/c/image/authenticated/s--AbC--/v2/x.jpg', { type: 'authenticated', publicId: 'x' }],
    ])('%s', (url, expected) => {
        expect(cloudinary.parseDeliveryUrl(url)).toMatchObject(expected);
    });
    it('rejects other hosts', () => expect(cloudinary.parseDeliveryUrl('https://evil.test/image/upload/x.jpg')).toBeNull());
});
