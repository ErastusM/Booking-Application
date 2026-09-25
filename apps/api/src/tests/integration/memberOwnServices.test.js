/**
 * A team member's services are their OWN — not inherited from the business.
 *
 * The owner's Team screen used to frame a member's services as "pick from the
 * business's menu, or switch on 'offers everything'". For a washer hired into a
 * barbershop that meant a wall of haircuts and one switch away from inheriting
 * all of them. Now the owner types what the member does, at the member's own
 * price and minutes, and neither the owner's screen nor the member can widen a
 * member onto the whole menu.
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

const barbershop = async () => {
    const owner = await makeProvider();
    const trim = await makeService(owner._id, { name: 'Trim', price: 70, duration: 30 });
    const washer = await TeamMember.create({ provider: owner._id, name: 'Erastus', role: 'Washer', email: 'e@t.com', offersAllServices: false, services: [] });
    const barber = await TeamMember.create({ provider: owner._id, name: 'John', role: 'Barber', email: 'j@t.com', offersAllServices: false, services: [] });
    return { owner, trim, washer, barber };
};

describe('POST /api/team/:id/services — the owner gives one member a service of their own', () => {
    it('adds it to THAT member only, at their own price, without touching the rest of the menu', async () => {
        const { owner, trim, washer, barber } = await barbershop();

        const res = await request(app).post(`/api/team/${washer._id}/services`)
            .set(authHeader(owner)).send({ name: 'Car wash', price: 100, duration: 45 });

        expect(res.status).toBe(201);
        const svc = await Service.findOne({ provider: owner._id, name: 'Car wash' });
        expect(svc).toBeTruthy();

        const w = await TeamMember.findById(washer._id);
        expect(w.services.map(String)).toEqual([String(svc._id)]);      // only their own
        expect(w.services.map(String)).not.toContain(String(trim._id));  // not the barber's menu
        expect(w.offersAllServices).toBe(false);
        // Their price is pinned as THEIR price, not just the catalogue default.
        const ov = w.serviceOverrides.find((o) => String(o.service) === String(svc._id));
        expect(ov.price).toBe(100);
        expect(ov.duration).toBe(45);

        // Nobody else picked it up.
        expect((await TeamMember.findById(barber._id)).services).toHaveLength(0);
    });

    it('two members can offer the same service at their own, independent prices', async () => {
        const { owner, washer, barber } = await barbershop();

        await request(app).post(`/api/team/${washer._id}/services`).set(authHeader(owner)).send({ name: 'Car wash', price: 100 });
        const second = await request(app).post(`/api/team/${barber._id}/services`).set(authHeader(owner)).send({ name: 'car wash', price: 150 });

        expect(second.status).toBe(200);           // reused, not duplicated
        expect(second.body.data.reused).toBe(true);
        expect(await Service.countDocuments({ provider: owner._id, name: /^car wash$/i })).toBe(1);

        const priceOf = async (id) => {
            const m = await TeamMember.findById(id);
            const svc = await Service.findOne({ provider: owner._id, name: /^car wash$/i });
            return m.serviceOverrides.find((o) => String(o.service) === String(svc._id)).price;
        };
        expect(await priceOf(washer._id)).toBe(100);
        expect(await priceOf(barber._id)).toBe(150);
        // The first price set the menu row; the second member did not overwrite it.
        expect((await Service.findOne({ provider: owner._id, name: /^car wash$/i })).price).toBe(100);
    });

    it('cannot reach a member of another business', async () => {
        const { washer } = await barbershop();
        const stranger = await makeProvider();

        const res = await request(app).post(`/api/team/${washer._id}/services`)
            .set(authHeader(stranger)).send({ name: 'Car wash' });
        expect(res.status).toBe(404);
        expect(await Service.countDocuments({ name: 'Car wash' })).toBe(0);
    });

    it('is refused for a staff member without team management', async () => {
        const { owner, washer, barber } = await barbershop();
        const staff = await makeUser({ role: 'staff', staffOf: owner._id });
        await TeamMember.updateOne({ _id: barber._id }, { $set: { user: staff._id } });

        const res = await request(app).post(`/api/team/${washer._id}/services`)
            .set(authHeader(staff)).send({ name: 'Car wash' });
        expect(res.status).toBe(403);
    });
});

describe('PUT /api/team/mine/services — a member cannot widen themselves onto the whole menu', () => {
    const asStaff = async (owner, member) => {
        const staff = await makeUser({ role: 'staff', staffOf: owner._id });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: staff._id } });
        return staff;
    };

    it('refuses switching ON "offers everything"', async () => {
        const { owner, washer } = await barbershop();
        const staff = await asStaff(owner, washer);

        const res = await request(app).put('/api/team/mine/services')
            .set(authHeader(staff)).send({ services: [], offersAllServices: true });
        expect(res.status).toBe(403);
        expect((await TeamMember.findById(washer._id)).offersAllServices).toBe(false);
    });

    it('still lets a member already on it step OFF', async () => {
        const { owner, washer } = await barbershop();
        await TeamMember.updateOne({ _id: washer._id }, { $set: { offersAllServices: true } });
        const staff = await asStaff(owner, washer);

        const res = await request(app).put('/api/team/mine/services')
            .set(authHeader(staff)).send({ services: [], offersAllServices: false });
        expect(res.status).toBe(200);
        expect((await TeamMember.findById(washer._id)).offersAllServices).toBe(false);
    });
});
