/**
 * scripts/migrate_owner_performs.js — deciding, for services that predate
 * Service.ownerPerforms, whether the OWNER offers them.
 *
 * Production holds rows a team member added for themselves (and rows the owner
 * added for one member from the Team screen) that look like any other menu
 * item, priced at the member's price. The migration marks those team-only from
 * the safest signals the data has, and leaves everything else with the owner —
 * printing every decision. It must be safe to run on every deploy.
 *
 * Rows are made through the real endpoints, then the flag is stripped to
 * reproduce what production data looks like before this change.
 */
const request = require('supertest');
const mongoose = require('mongoose');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { futureDate } = require('../helpers/dates');
const { makeProvider, makeUser, makeService, authHeader } = require('../helpers/factories');
const Service = require('../../models/Service');
const TeamMember = require('../../models/TeamMember');
const Appointment = require('../../models/Appointment');
const { migrateOwnerPerforms, report, MEMBER_SELF_ADD_SINCE } = require('../../../scripts/migrate_owner_performs');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// Back to "no decision yet", as every production row is before this deploy.
// (Ids from a response body are strings; the raw collection needs ObjectIds.)
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const legacy = async (id, createdAt) => {
    const $set = createdAt ? { createdAt } : {};
    await Service.collection.updateOne({ _id: oid(id) }, { $unset: { ownerPerforms: 1 }, ...(Object.keys($set).length ? { $set } : {}) });
};
const flagOf = async (id) => (await Service.collection.findOne({ _id: oid(id) })).ownerPerforms;

const setup = async () => {
    const owner = await makeProvider({ name: 'Vido Barber', businessProfile: { businessName: 'Vido Barber' } });
    const erastusUser = await makeUser({ role: 'staff', staffOf: owner._id, staffTier: 'low', name: 'Erastus Driver' });
    const erastus = await TeamMember.create({
        provider: owner._id, name: 'Erastus', role: 'Driver', email: 'erastus@test.com',
        user: erastusUser._id, offersAllServices: false, services: [],
    });
    const john = await TeamMember.create({ provider: owner._id, name: 'John', role: 'Barber', offersAllServices: false, services: [] });
    return { owner, erastusUser, erastus, john };
};
const memberAdds = (ctx, body, as = ctx.erastusUser) => request(app).post('/api/team/mine/services').set(authHeader(as)).send(body);
const ownerAddsFor = (ctx, member, body) => request(app).post(`/api/team/${member._id}/services`).set(authHeader(ctx.owner)).send(body);

describe('migrate_owner_performs', () => {
    it('makes a member\'s own service team-only and leaves the owner\'s services with the owner', async () => {
        const ctx = await setup();
        // The owner's Trim, from long before members could add anything.
        const trim = await makeService(ctx.owner._id, { name: 'Trim', price: 70 });
        await legacy(trim._id, new Date('2026-06-01T10:00:00.000Z'));
        // The owner's own menu item, made through the catalogue this week.
        const beard = (await request(app).post('/api/services/my-services').set(authHeader(ctx.owner))
            .send({ name: 'Beard', description: 'A proper beard shape-up', price: 60, duration: 20 })).body.data;
        await legacy(beard._id);
        // Erastus's own trip — the production leak.
        const trip = (await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 3600 })).body.data.service;
        await legacy(trip._id);
        // Added for John from the Team screen.
        const fade = (await ownerAddsFor(ctx, ctx.john, { name: 'Skin fade', price: 150, duration: 45 })).body.data.service;
        await legacy(fade._id);

        const result = await migrateOwnerPerforms();

        expect(await flagOf(trip._id)).toBe(false);
        expect(await flagOf(fade._id)).toBe(false);
        expect(await flagOf(trim._id)).toBe(true);
        expect(await flagOf(beard._id)).toBe(true);
        // The member's prices are theirs and untouched; so are the owner's.
        expect((await Service.findById(trip._id)).price).toBe(20000);
        expect((await Service.findById(trim._id)).price).toBe(70);

        const byName = Object.fromEntries(result.decisions.map((d) => [d.name, d]));
        expect(byName['North to south'].why).toMatch(/Erastus added it as their own service/);
        expect(byName['Skin fade'].why).toMatch(/added for John from the Team screen/);
        expect(byName.Trim.why).toMatch(/before team members could add services/);
        expect(byName.Beard.why).toMatch(/a menu item/);
        expect(result.confirm).toHaveLength(0);

        // …and the owner's tile now shows only the owner's.
        const staff = (await request(app).get(`/api/providers/${ctx.owner._id}/staff`)).body.data;
        const tile = staff.find((m) => m._id === 'owner');
        expect(tile.services.sort()).toEqual([String(trim._id), String(beard._id)].sort());
    });

    it('is idempotent and never overrides a decision already made', async () => {
        const ctx = await setup();
        const trip = (await memberAdds(ctx, { name: 'Airport run', price: 900, duration: 120 })).body.data.service;
        await legacy(trip._id);
        // The owner has already said: "my team does Colour, not me" — and "I do this Wash".
        const colour = await makeService(ctx.owner._id, { name: 'Colour', ownerPerforms: false });
        const wash = await makeService(ctx.owner._id, { name: 'Wash', ownerPerforms: true });
        const beforeRun = await Service.find({}).lean();

        const first = await migrateOwnerPerforms();
        expect(first.decisions.map((d) => d.name)).toEqual(['Airport run']);
        expect(await flagOf(colour._id)).toBe(false);
        expect(await flagOf(wash._id)).toBe(true);

        const afterFirst = await Service.find({}).sort({ _id: 1 }).lean();
        const second = await migrateOwnerPerforms();
        expect(second.decisions).toBeUndefined(); // nothing left undecided
        expect(second.teamOnly).toHaveLength(0);
        expect(await Service.find({}).sort({ _id: 1 }).lean()).toEqual(afterFirst);
        // Only the undecided row was written.
        const changed = afterFirst.filter((s) => {
            const was = beforeRun.find((b) => String(b._id) === String(s._id));
            return JSON.stringify(was.ownerPerforms) !== JSON.stringify(s.ownerPerforms);
        });
        expect(changed.map((s) => s.name)).toEqual(['Airport run']);
    });

    it('leaves the owner\'s services alone even when a member also offers them (same-name add)', async () => {
        const ctx = await setup();
        const trim = await makeService(ctx.owner._id, { name: 'Trim', price: 70, duration: 30 });
        await legacy(trim._id, new Date('2026-06-01T10:00:00.000Z'));
        const res = await memberAdds(ctx, { name: 'trim', price: 90, duration: 40 });
        expect(res.body.data.reused).toBe(true);

        await migrateOwnerPerforms();
        const after = await Service.findById(trim._id);
        expect(after.ownerPerforms).toBe(true);
        expect(after.price).toBe(70);
        expect(after.duration).toBe(30);
    });

    it('where the data can\'t tell, the owner keeps it and it is reported to confirm', async () => {
        const ctx = await setup();
        // A manager (can edit the menu) whose own price for it has since changed:
        // it could be a menu item they made, so it stays with the owner.
        const mgrUser = await makeUser({ role: 'staff', staffOf: ctx.owner._id, staffTier: 'high', name: 'Mara Manager' });
        const mara = await TeamMember.create({ provider: ctx.owner._id, name: 'Mara', email: 'mara@test.com', user: mgrUser._id, offersAllServices: false });
        const nails = (await memberAdds(ctx, { name: 'Nails', price: 200, duration: 60 }, mgrUser)).body.data.service;
        await TeamMember.updateOne({ _id: mara._id }, { $set: { serviceOverrides: [{ service: nails._id, price: 250, duration: 60 }] } });
        await legacy(nails._id);
        // A member added it, then stopped offering it.
        const wash = (await memberAdds(ctx, { name: 'Car wash', price: 100, duration: 30 })).body.data.service;
        await TeamMember.updateOne({ _id: ctx.erastus._id }, { $set: { services: [] } });
        await legacy(wash._id);
        // The same manager's add where her price still matches IS hers.
        const lashes = (await memberAdds(ctx, { name: 'Lashes', price: 180, duration: 50 }, mgrUser)).body.data.service;
        await legacy(lashes._id);

        const result = await migrateOwnerPerforms();
        expect(await flagOf(nails._id)).toBe(true);
        expect(await flagOf(wash._id)).toBe(true);
        expect(await flagOf(lashes._id)).toBe(false);
        expect(result.confirm.map((d) => d.name).sort()).toEqual(['Car wash', 'Nails']);
        expect(result.confirm.find((d) => d.name === 'Car wash').why).toMatch(/no longer offers it/);
        expect(result.confirm.find((d) => d.name === 'Nails').why).toMatch(/can also edit the business menu/);
    });

    it('nothing made before members could add services is ever taken from the owner', async () => {
        const ctx = await setup();
        // Looks exactly like a member's add, but predates the feature.
        const old = await makeService(ctx.owner._id, { name: 'Shave', description: 'Shave', price: 50, createdBy: ctx.erastusUser._id });
        await TeamMember.updateOne({ _id: ctx.erastus._id }, { $set: { services: [old._id], serviceOverrides: [{ service: old._id, price: 50 }] } });
        await legacy(old._id, new Date(MEMBER_SELF_ADD_SINCE.getTime() - 60000));
        await migrateOwnerPerforms();
        expect(await flagOf(old._id)).toBe(true);
    });

    it('--dry-run decides and reports but writes nothing', async () => {
        const ctx = await setup();
        const trip = (await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 180 })).body.data.service;
        await legacy(trip._id);
        const result = await migrateOwnerPerforms({ dryRun: true });
        expect(result.teamOnly.map((d) => d.name)).toEqual(['North to south']);
        expect(await flagOf(trip._id)).toBeUndefined();
    });

    it('prints every decision, the bookings clients made with the owner for it, and a rollback — without touching bookings', async () => {
        const ctx = await setup();
        const trim = await makeService(ctx.owner._id, { name: 'Trim', price: 70 });
        await legacy(trim._id, new Date('2026-06-01T10:00:00.000Z'));
        const trip = (await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 180 })).body.data.service;
        await legacy(trip._id);
        const customer = await makeUser({ name: 'Ndapewa Client' });
        const appt = await Appointment.create({
            customer: customer._id, provider: ctx.owner._id, service: trip._id, teamMember: null,
            appointmentDate: futureDate(2), startTime: '09:00', endTime: '12:00', status: 'confirmed', totalPrice: 20000,
        });

        const lines = [];
        report(await migrateOwnerPerforms(), (l) => lines.push(l));
        const out = lines.join('\n');
        expect(out).toMatch(/Decided who performs 2 service\(s\): 1 team-only/);
        expect(out).toMatch(/North to south \[.+\]: TEAM ONLY \(Erastus\) — Erastus added it as their own service/);
        expect(out).toMatch(/Trim \[.+\]: owner keeps — created 2026-06-01/);
        expect(out).toContain(`appointment ${appt._id}`);
        expect(out).toContain(`$unset:{ownerPerforms:1}`);
        expect(out).toContain(`ObjectId("${trip._id}")`);

        const kept = await Appointment.findById(appt._id).lean();
        expect(kept.teamMember).toBeNull();
        expect(kept.status).toBe('confirmed');
    });
});
