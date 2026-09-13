/**
 * Permission tiers — Phase 3b: the High tier opens catalogue management
 * (services:edit) to a manager — service create/update/delete + categories —
 * scoped to the employer.
 *
 * The load-bearing check is the ownership FIX: updateService/deleteService
 * previously gated ownership on role==='provider' only, so a staff principal
 * fell THROUGH and could edit/delete ANY business's service. The remap keys the
 * check on the business (staffOf), so a High staff member can only touch their
 * own employer's catalogue.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Service = require('../../models/Service');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

let seq = 0;
const makeStaff = async (provider, tier) => {
    seq += 1;
    const login = await makeUser({ role: 'staff', staffOf: provider._id, email: `staff-${tier}-${seq}@test.com`, staffTier: tier });
    await TeamMember.create({ provider: provider._id, name: `Staff ${tier} ${seq}`, role: 'Manager', user: login._id });
    return login;
};

describe('services:edit — catalogue management', () => {
    it('a High staff member creates a service under their EMPLOYER (not their own id)', async () => {
        const provider = await makeProvider();
        const high = await makeStaff(provider, 'high');
        const res = await request(app)
            .post('/api/services/my-services')
            .set(authHeader(high))
            .send({ name: 'Fade', description: 'A fade', price: 120, duration: 30 });
        expect(res.status).toBe(201);
        expect(String(res.body.data.provider)).toBe(String(provider._id));
        expect(String(res.body.data.provider)).not.toBe(String(high._id));
    });

    it("a High staff member updates their own business's service", async () => {
        const provider = await makeProvider();
        const high = await makeStaff(provider, 'high');
        const svc = await makeService(provider._id);
        const res = await request(app)
            .put(`/api/services/${svc._id}`)
            .set(authHeader(high))
            .send({ name: 'Renamed', price: 99, duration: 30 });
        expect(res.status).toBe(200);
        expect(res.body.data.name).toBe('Renamed');
    });

    it("CANNOT edit another business's service (ownership fix — staff no longer fall through)", async () => {
        const businessA = await makeProvider();
        const svcA = await makeService(businessA._id);
        const businessB = await makeProvider();
        const highOfB = await makeStaff(businessB, 'high');

        const res = await request(app)
            .put(`/api/services/${svcA._id}`)
            .set(authHeader(highOfB))
            .send({ name: 'hijacked', price: 1, duration: 30 });
        expect(res.status).toBe(403);
        // And the service is untouched.
        expect((await Service.findById(svcA._id)).name).not.toBe('hijacked');
    });

    it("CANNOT delete another business's service", async () => {
        const businessA = await makeProvider();
        const svcA = await makeService(businessA._id);
        const businessB = await makeProvider();
        const highOfB = await makeStaff(businessB, 'high');

        const res = await request(app).delete(`/api/services/${svcA._id}`).set(authHeader(highOfB));
        expect(res.status).toBe(403);
        expect(await Service.findById(svcA._id)).not.toBeNull();
    });

    it('a Medium staff member cannot manage the catalogue (no services:edit)', async () => {
        const provider = await makeProvider();
        const medium = await makeStaff(provider, 'medium');
        const svc = await makeService(provider._id);
        const create = await request(app).post('/api/services/my-services').set(authHeader(medium))
            .send({ name: 'X', price: 10, duration: 30 });
        expect(create.status).toBe(403);
        const update = await request(app).put(`/api/services/${svc._id}`).set(authHeader(medium))
            .send({ name: 'X', price: 10, duration: 30 });
        expect(update.status).toBe(403);
    });

    it('a High staff member manages categories scoped to their employer', async () => {
        const provider = await makeProvider();
        const high = await makeStaff(provider, 'high');
        const res = await request(app).post('/api/categories').set(authHeader(high)).send({ name: 'Barbering' });
        expect(res.status).toBe(201);
        expect(String(res.body.data.provider)).toBe(String(provider._id));

        const list = await request(app).get('/api/categories/my-categories').set(authHeader(high));
        expect(list.status).toBe(200);
        expect(list.body.data.some((c) => c.name === 'Barbering')).toBe(true);
    });

    it('the public catalogue read stays open (no regression)', async () => {
        const provider = await makeProvider();
        await makeService(provider._id);
        const res = await request(app).get('/api/services'); // no auth
        expect(res.status).toBe(200);
    });
});
