/**
 * Regression cover for the second batch of medium/low QA findings implemented
 * directly (the workflow's dead agents):
 *   #20 staff cannot self-upgrade to provider via /auth/become-provider
 *   #27 GET /auth/profile must not leak the live verificationToken
 *   #25 updatePackage must not let the body reassign a package's provider
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const Package = require('../../models/Package');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('#20 — staff cannot self-upgrade to provider', () => {
    it('rejects become-provider from a staff account', async () => {
        const owner = await makeProvider();
        const staff = await User.create({
            name: 'Staff Member', email: `staff_${Date.now()}@x.com`, password: 'Password1!',
            phone: '1', role: 'staff', staffOf: owner._id, isVerified: true,
        });
        const res = await request(app).put('/api/auth/become-provider')
            .set(authHeader(staff)).send({ providerCategory: 'Barber' });
        expect(res.status).toBe(403);
        const after = await User.findById(staff._id);
        expect(after.role).toBe('staff'); // unchanged
    });

    it('still lets a plain customer become a provider', async () => {
        const customer = await makeUser();
        const res = await request(app).put('/api/auth/become-provider')
            .set(authHeader(customer)).send({ providerCategory: 'Barber' });
        expect(res.status).toBe(200);
    });
});

describe('#27 — GET /auth/profile does not leak the verification token', () => {
    it('omits verificationToken/expiry from the profile response', async () => {
        const user = await makeUser();
        await User.updateOne(
            { _id: user._id },
            { $set: { verificationToken: 'super-secret-token', verificationTokenExpiry: new Date() } },
        );
        const res = await request(app).get('/api/auth/profile').set(authHeader(user));
        expect(res.status).toBe(200);
        expect(res.body.data.verificationToken).toBeUndefined();
        expect(res.body.data.verificationTokenExpiry).toBeUndefined();
    });
});

describe('#25 — updatePackage cannot reassign the provider from the body', () => {
    it('ignores a body-supplied provider id', async () => {
        const owner = await makeProvider();
        const attacker = await makeProvider();
        const pkg = await Package.create({
            name: 'Cuts x5', provider: owner._id,
            price: 500, totalSessions: 5, services: [],
        });

        const res = await request(app).put(`/api/packages/my-packages/${pkg._id}`)
            .set(authHeader(owner))
            .send({ name: 'Cuts x5 (renamed)', provider: attacker._id.toString() });

        expect(res.status).toBe(200);
        expect(res.body.data.name).toBe('Cuts x5 (renamed)'); // legit field updated
        const after = await Package.findById(pkg._id);
        expect(String(after.provider)).toBe(String(owner._id)); // ownership NOT reassigned
    });
});
