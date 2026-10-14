/**
 * A password hashed at an older, cheaper bcrypt cost is re-hashed at today's on
 * the next correct sign-in, together with the same person's twin account (the
 * twins share the byte-identical hash, which is how they recognise each other).
 * Tests normally hash at cost 4; this file runs the model at cost 5.
 */
process.env.BCRYPT_ROUNDS = '5';
const bcrypt = require('bcryptjs');
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const User = require('../../models/User');
const { makeUser, makeProvider } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

it('re-hashes an old cost-4 password at the current cost, twins included', async () => {
    expect(User.BCRYPT_ROUNDS).toBe(5);
    const oldHash = bcrypt.hashSync('Password1!', 4);
    const customer = await makeUser({ email: 'twin@example.com' });
    const business = await makeProvider({ email: 'twin@example.com' });
    await User.updateMany({ _id: { $in: [customer._id, business._id] } }, { $set: { password: oldHash } });

    const res = await request(app).post('/api/auth/login').send({ email: 'twin@example.com', password: 'Password1!', accountType: 'customer' });
    expect(res.status).toBe(200);

    const [c, b] = await Promise.all([
        User.findById(customer._id).select('+password'),
        User.findById(business._id).select('+password'),
    ]);
    expect(bcrypt.getRounds(c.password)).toBe(5);
    expect(b.password).toBe(c.password);
    expect(await bcrypt.compare('Password1!', c.password)).toBe(true);
});
