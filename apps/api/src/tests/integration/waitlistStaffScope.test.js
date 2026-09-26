/**
 * The waiting list holds clients' contact details. A team member who sees only
 * their own calendar (Service provider — the default level) sees only the
 * clients waiting on them or on "anyone"; never a colleague's. Members who see
 * the whole calendar (Reception / Manager) still see every entry.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const WaitingList = require('../../models/WaitingList');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

let seq = 0;
const makeStaff = async (provider, tier) => {
    seq += 1;
    const login = await makeUser({ role: 'staff', staffOf: provider._id, email: `wl-${seq}@test.com`, ...(tier !== undefined ? { staffTier: tier } : {}) });
    const member = await TeamMember.create({ provider: provider._id, name: `Member ${seq}`, user: login._id, offersAllServices: true });
    return { login, member };
};

const setup = async () => {
    const provider = await makeProvider();
    const service = await makeService(provider._id);
    const john = await makeStaff(provider); // no level chosen → Service provider
    const sarah = await makeStaff(provider, 'low');
    const date = new Date(Date.now() + 5 * 864e5);
    const entry = async (name, teamMember) => {
        const customer = await makeUser({ name, email: `${name.split(' ')[0].toLowerCase()}@wl.test` });
        return WaitingList.create({ customer: customer._id, provider: provider._id, service: service._id, appointmentDate: date, startTime: '10:00', endTime: '10:30', position: 1, teamMember });
    };
    await entry('Tomas Johns', john.member._id);
    await entry('Ndapewa Sarahs', sarah.member._id);
    await entry('Petrina Anyone', null);
    return { provider, john, sarah };
};

const names = (res) => res.body.data.map((e) => e.customer.name).sort();

describe('GET /api/waitinglist/provider for team members', () => {
    it("a Service provider sees clients waiting on them and on anyone, not a colleague's", async () => {
        const { john } = await setup();
        const res = await request(app).get('/api/waitinglist/provider').set(authHeader(john.login));
        expect(res.status).toBe(200);
        expect(names(res)).toEqual(['Petrina Anyone', 'Tomas Johns']);
    });

    it('a member who sees the whole calendar sees every entry', async () => {
        const { provider } = await setup();
        const { login } = await makeStaff(provider, 'medium');
        const res = await request(app).get('/api/waitinglist/provider').set(authHeader(login));
        expect(res.status).toBe(200);
        expect(names(res)).toHaveLength(3);
    });

    it('the owner sees every entry', async () => {
        const { provider } = await setup();
        const res = await request(app).get('/api/waitinglist/provider').set(authHeader(provider));
        expect(names(res)).toHaveLength(3);
    });
});
