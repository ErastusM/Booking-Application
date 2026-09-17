/**
 * A team member's services are their OWN.
 *
 * This is a general booking platform, so one business's roster can mix trades —
 * someone who cuts hair, someone who cleans, someone who only runs the desk.
 * Hiring a cleaner into a barbershop must never make them bookable for the
 * barbering menu.
 *
 * The regression these tests pin: the public staff endpoint returned only
 * `services`, omitting `offersAllServices`. A new member (flag false, empty
 * list) and a legacy row (flag absent, empty list) were then IDENTICAL on the
 * wire, and the customer booking page read an empty list as "performs
 * everything" — so the cleaner was offered every barbering service.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const { migrateMemberServicesFlag } = require('../../../scripts/migrate_member_services_flag');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('public staff payload — a member says for itself what it performs', () => {
    it('returns offersAllServices so an empty list is never mistaken for "does everything"', async () => {
        const owner = await makeProvider();
        const haircut = await makeService(owner._id, { name: 'Haircut' });
        // A new hire, exactly as addTeamMember creates one: performs nothing yet.
        await TeamMember.create({
            provider: owner._id, name: 'Wendy', role: 'Cleaner', email: 'wendy@test.com',
            offersAllServices: false, services: [], isActive: true,
        });

        const res = await request(app).get(`/api/providers/${owner._id}/staff`);
        expect(res.status).toBe(200);
        const wendy = res.body.data.find((m) => m.name === 'Wendy');
        expect(wendy).toBeTruthy();
        // The field must be PRESENT and false — its absence is the whole bug.
        expect(wendy).toHaveProperty('offersAllServices');
        expect(wendy.offersAllServices).toBe(false);
        expect(wendy.services).toHaveLength(0);

        // And she is not offered as a performer of a service she does not do.
        const filtered = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${haircut._id}`);
        expect(filtered.status).toBe(200);
        expect(filtered.body.data.map((m) => m.name)).not.toContain('Wendy');
    });

    it('still surfaces a member for the services they DO perform', async () => {
        const owner = await makeProvider();
        const haircut = await makeService(owner._id, { name: 'Haircut' });
        const valet = await makeService(owner._id, { name: 'Car valet' });
        await TeamMember.create({
            provider: owner._id, name: 'Sam', role: 'Barber', email: 'sam@test.com',
            offersAllServices: false, services: [haircut._id], isActive: true,
        });

        const forHaircut = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${haircut._id}`);
        expect(forHaircut.body.data.map((m) => m.name)).toContain('Sam');

        const forValet = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${valet._id}`);
        expect(forValet.body.data.map((m) => m.name)).not.toContain('Sam');
    });

    it('a member the owner marked as doing everything is offered for every service', async () => {
        const owner = await makeProvider();
        const haircut = await makeService(owner._id, { name: 'Haircut' });
        await TeamMember.create({
            provider: owner._id, name: 'Ada', role: 'Senior stylist', email: 'ada@test.com',
            offersAllServices: true, services: [], isActive: true,
        });

        const res = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${haircut._id}`);
        expect(res.body.data.map((m) => m.name)).toContain('Ada');
    });
});

describe('migrate_member_services_flag — decide legacy rows without changing what they do', () => {
    it('preserves each legacy row\'s current behaviour and is idempotent', async () => {
        const owner = await makeProvider();
        const haircut = await makeService(owner._id, { name: 'Haircut' });

        // Legacy rows: the field never existed on them.
        const legacyAll = await TeamMember.create({ provider: owner._id, name: 'Old All', role: 'Barber', email: 'a@test.com', services: [], isActive: true });
        const legacyLimited = await TeamMember.create({ provider: owner._id, name: 'Old Limited', role: 'Barber', email: 'b@test.com', services: [haircut._id], isActive: true });
        await TeamMember.collection.updateMany(
            { _id: { $in: [legacyAll._id, legacyLimited._id] } },
            { $unset: { offersAllServices: '' } },
        );
        // A modern row that already decided — must not be touched.
        const modern = await TeamMember.create({ provider: owner._id, name: 'New Hire', role: 'Cleaner', email: 'c@test.com', offersAllServices: false, services: [], isActive: true });

        const first = await migrateMemberServicesFlag();
        expect(first.all).toBe(1);      // empty list was already treated as "everything"
        expect(first.limited).toBe(1);  // a listed set was already the limit

        expect((await TeamMember.findById(legacyAll._id)).offersAllServices).toBe(true);
        expect((await TeamMember.findById(legacyLimited._id)).offersAllServices).toBe(false);
        expect((await TeamMember.findById(modern._id)).offersAllServices).toBe(false);

        // Re-running writes nothing — the deploy runs this on every release.
        const second = await migrateMemberServicesFlag();
        expect(second).toEqual({ all: 0, limited: 0 });
    });

    it('after the backfill an empty-list member is no longer offered for a service', async () => {
        const owner = await makeProvider();
        const haircut = await makeService(owner._id, { name: 'Haircut' });
        const hire = await TeamMember.create({ provider: owner._id, name: 'Wendy', role: 'Cleaner', email: 'w@test.com', offersAllServices: false, services: [], isActive: true });

        await migrateMemberServicesFlag();
        // Her explicit "no" survives the backfill: it only fills in rows that never decided.
        expect((await TeamMember.findById(hire._id)).offersAllServices).toBe(false);

        const res = await request(app).get(`/api/providers/${owner._id}/staff?serviceId=${haircut._id}`);
        expect(res.body.data.map((m) => m.name)).not.toContain('Wendy');
    });
});
