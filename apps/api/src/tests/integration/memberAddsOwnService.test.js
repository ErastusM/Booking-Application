/**
 * A member can add the service THEY perform.
 *
 * Ticking from the business's menu is not enough on a platform that covers every
 * kind of booking: a roster can mix trades, so a cleaner hired into a barbershop
 * had nothing to tick and stayed unbookable until the owner added "Cleaning" for
 * them. This lets the member say what they do and be bookable for it — while the
 * service still belongs to the BUSINESS, so one catalogue keeps feeding booking,
 * pricing, earnings and reporting, and the owner can edit or retire it.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const TeamMember = require('../../models/TeamMember');
const Service = require('../../models/Service');
const { makeProvider, makeUser, makeService, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A barbershop, and a cleaner on its roster with nothing they can perform.
const setup = async () => {
    const owner = await makeProvider();
    const haircut = await makeService(owner._id, { name: 'Haircut' });
    const user = await makeUser({ role: 'staff', staffOf: owner._id });
    const member = await TeamMember.create({
        provider: owner._id, name: 'Wendy', role: 'Cleaner', email: 'wendy@test.com',
        user: user._id, offersAllServices: false, services: [], isActive: true,
    });
    return { owner, haircut, user, member };
};

describe('POST /api/team/mine/services — a member adds their own trade', () => {
    it('creates the service on the business and makes the member bookable for it', async () => {
        const { owner, user, member } = await setup();

        const res = await request(app)
            .post('/api/team/mine/services')
            .set(authHeader(user))
            .send({ name: 'Cleaning', price: 250, duration: 90 });

        expect(res.status).toBe(201);
        expect(res.body.data.reused).toBe(false);

        // It belongs to the BUSINESS, and records who added it.
        const svc = await Service.findOne({ provider: owner._id, name: 'Cleaning' });
        expect(svc).toBeTruthy();
        expect(svc.price).toBe(250);
        expect(svc.duration).toBe(90);
        expect(String(svc.createdBy)).toBe(String(user._id));

        // And the member is assigned to it without being widened to everything.
        const after = await TeamMember.findById(member._id);
        expect(after.services.map(String)).toEqual([String(svc._id)]);
        expect(after.offersAllServices).toBe(false);

        // Customers can now find them for it — and still not for the haircut.
        const forCleaning = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${svc._id}`);
        expect(forCleaning.body.data.map((m) => m.name)).toContain('Wendy');
    });

    it('does not make them bookable for the rest of the menu', async () => {
        const { owner, haircut, user } = await setup();
        await request(app).post('/api/team/mine/services').set(authHeader(user)).send({ name: 'Cleaning' });

        const forHaircut = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${haircut._id}`);
        expect(forHaircut.body.data.map((m) => m.name)).not.toContain('Wendy');
    });

    it('reuses a service the business already offers instead of duplicating it', async () => {
        const { owner, haircut, user, member } = await setup();

        // Same name, different case — a second "Haircut" row would split bookings
        // across records that look identical to everyone.
        const res = await request(app)
            .post('/api/team/mine/services')
            .set(authHeader(user))
            .send({ name: 'haircut', price: 999 });

        expect(res.status).toBe(200);
        expect(res.body.data.reused).toBe(true);
        expect(await Service.countDocuments({ provider: owner._id, name: /^haircut$/i })).toBe(1);
        // The existing price is NOT overwritten by the member.
        expect((await Service.findById(haircut._id)).price).toBe(haircut.price);
        expect((await TeamMember.findById(member._id)).services.map(String)).toEqual([String(haircut._id)]);
    });

    it('is idempotent — adding the same thing twice assigns it once', async () => {
        const { owner, user, member } = await setup();
        await request(app).post('/api/team/mine/services').set(authHeader(user)).send({ name: 'Cleaning' });
        await request(app).post('/api/team/mine/services').set(authHeader(user)).send({ name: 'Cleaning' });

        expect(await Service.countDocuments({ provider: owner._id, name: /^cleaning$/i })).toBe(1);
        expect((await TeamMember.findById(member._id)).services).toHaveLength(1);
    });

    it('requires a name, and defaults price and duration sensibly', async () => {
        const { owner, user } = await setup();

        const blank = await request(app).post('/api/team/mine/services').set(authHeader(user)).send({ name: '   ' });
        expect(blank.status).toBe(400);

        await request(app).post('/api/team/mine/services').set(authHeader(user)).send({ name: 'Dog walking' });
        const svc = await Service.findOne({ provider: owner._id, name: 'Dog walking' });
        expect(svc.price).toBe(0);
        expect(svc.duration).toBe(30);
        expect(svc.description).toBeTruthy(); // the model requires one
    });

    it('cannot be used by someone with no business, and never touches another business', async () => {
        const { user } = await setup();
        const stranger = await makeProvider();

        // An owner has no roster row of their own — they already have the
        // catalogue CRUD, so this staff-self route is not for them.
        const asOwner = await request(app)
            .post('/api/team/mine/services')
            .set(authHeader(stranger))
            .send({ name: 'Cleaning' });
        expect(asOwner.status).toBe(403);

        // The staff member's service landed on THEIR employer, not anyone else.
        await request(app).post('/api/team/mine/services').set(authHeader(user)).send({ name: 'Cleaning' });
        expect(await Service.countDocuments({ provider: stranger._id })).toBe(0);
    });
});
