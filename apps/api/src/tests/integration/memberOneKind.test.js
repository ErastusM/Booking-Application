/**
 * "I don't think we should have high or low members. Just members."
 *
 * Every team member — whatever access level (staffTier) or grant
 * (staffPermissions) their old record still holds — gets exactly the member
 * set: their own column, bookings, clients, blocked time, services, hours,
 * waiting list, messages and earnings. Nothing business-wide is reachable: only
 * the owner sees the whole business. And the old level setting is gone (410).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

let seq = 0;
const FORMER = [
    ['View only', { staffTier: 'basic' }],
    ['Service provider', { staffTier: 'low' }],
    ['no level chosen', { staffTier: null }],
    ['Reception', { staffTier: 'medium' }],
    ['Manager', { staffTier: 'high' }],
    ['Manager with every old grant', { staffTier: 'high', staffPermissions: ['calendar:all', 'clients:view_all', 'team:manage', 'reports:view', 'wallet:view', 'services:edit', 'forms:manage'] }],
];

const setup = async (rec) => {
    seq += 1;
    const owner = await makeProvider({ name: 'Olivia Owner' });
    const svc = await makeService(owner._id, { name: 'Cut', price: 100 });
    const login = await makeUser({ role: 'staff', staffOf: owner._id, email: `one-${seq}@test.com`, ...rec });
    const me = await TeamMember.create({ provider: owner._id, name: 'Me Member', user: login._id, offersAllServices: true });
    const colleague = await TeamMember.create({ provider: owner._id, name: 'Colleague', offersAllServices: true });
    const myClient = await makeUser({ name: 'My Client' });
    const theirClient = await makeUser({ name: 'Their Client' });
    const ownersClient = await makeUser({ name: 'Owners Client' });
    const mine = await makeAppointment(myClient._id, svc._id, owner._id, { status: 'confirmed', teamMember: me._id, totalPrice: 100 });
    const theirs = await makeAppointment(theirClient._id, svc._id, owner._id, { status: 'confirmed', teamMember: colleague._id, startTime: '12:00', endTime: '12:30' });
    const owners = await makeAppointment(ownersClient._id, svc._id, owner._id, { status: 'confirmed', startTime: '13:00', endTime: '13:30' });
    return { owner, svc, login, me, colleague, mine, theirs, owners };
};

const as = (user) => ({
    get: (url) => request(app).get(url).set(authHeader(user)),
    put: (url, body = {}) => request(app).put(url).set(authHeader(user)).send(body),
    post: (url, body = {}) => request(app).post(url).set(authHeader(user)).send(body),
});

describe.each(FORMER)('a former "%s" member is a plain member', (_label, rec) => {
    it('sees only their own bookings and clients', async () => {
        const { login, mine } = await setup(rec);
        const appts = await as(login).get('/api/appointments?all=true');
        expect(appts.status).toBe(200);
        expect(appts.body.data.map((a) => String(a._id))).toEqual([String(mine._id)]);
        const clients = await as(login).get('/api/crm/clients');
        expect(clients.body.data.map((c) => c.customer.name)).toEqual(['My Client']);
    });

    it("runs their own bookings, never a colleague's or the owner's", async () => {
        const { login, mine, theirs, owners } = await setup(rec);
        expect((await as(login).put(`/api/appointments/${mine._id}/status`, { status: 'completed' })).status).toBe(200);
        for (const other of [theirs, owners]) {
            expect([403, 404]).toContain((await as(login).put(`/api/appointments/${other._id}/status`, { status: 'cancelled' })).status);
        }
    });

    it('reaches nothing business-wide', async () => {
        const { login, colleague } = await setup(rec);
        const refused = [
            ['get', '/api/earnings'],
            ['get', '/api/analytics/provider'],
            ['get', '/api/wallet/provider/summary'],
            ['get', '/api/wallet/provider/wallets'],
            ['get', '/api/team'],
            ['get', `/api/team/${colleague._id}/stats`],
            ['get', '/api/categories/my-categories'],
            ['get', '/api/packages/my-packages'],
            ['get', '/api/giftcards'],
            ['get', '/api/forms/templates'],
            ['get', '/api/forms/submissions'],
            ['get', '/api/appointments/history'],
            ['post', '/api/services/my-services'],
            ['put', `/api/team/${colleague._id}`],
            ['post', '/api/blocked-times'],
        ];
        for (const [m, url] of refused) {
            const res = await as(login)[m](url, m === 'post' && url.includes('blocked') ? { date: '2030-01-07', startTime: '09:00', endTime: '10:00' } : {});
            expect([url, res.status]).toEqual([url, 403]);
        }
    });

    it('gets their own earnings, and their calendar lists only themselves', async () => {
        const { login } = await setup(rec);
        expect((await as(login).get('/api/earnings/mine')).status).toBe(200);
        const roster = await as(login).get('/api/team/mine/calendar');
        expect(roster.body.data.members).toHaveLength(1);
    });
});

describe('the access-level setting is gone', () => {
    it('PUT /team/:id/permissions answers 410 and writes nothing', async () => {
        const { owner, login, me } = await setup({ staffTier: 'low' });
        const res = await as(owner).put(`/api/team/${me._id}/permissions`, { tier: 'high', permissions: ['clients:view_all'] });
        expect(res.status).toBe(410);
        const u = await User.findById(login._id);
        expect(u.staffTier).toBe('low');
        expect(u.staffPermissions).toEqual([]);
    });

    it('login no longer hands the app an access level', async () => {
        const owner = await makeProvider();
        await makeUser({ role: 'staff', staffOf: owner._id, email: 'plain@test.com', password: 'Password1!', staffTier: 'high' });
        const res = await request(app).post('/api/auth/login').send({ email: 'plain@test.com', password: 'Password1!' });
        expect(res.status).toBe(200);
        expect(res.body.data.user.role).toBe('staff');
        expect(res.body.data.user).not.toHaveProperty('staffTier');
        expect(res.body.data.user).not.toHaveProperty('staffPermissions');
    });
});
