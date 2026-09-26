/**
 * A team member's services and prices never leak onto the OWNER.
 *
 * The production report: on a barbershop's booking page, choosing the owner
 * ("Vido") listed a driver's own trips — "North to south N$ 20000", "Walvis to
 * Arandis N$ 9000" — above the owner's real Trim at N$70. A member's "add a
 * service I offer" writes an ordinary catalogue row priced at the member's
 * price, and the owner was assumed to perform the whole catalogue, so every
 * surface that reads "the catalogue" read it as the owner's: the owner's tile,
 * the feed card's "Starting at" and service count, the profile, search, the
 * owner's own New Appointment, and even server-side booking of the owner.
 *
 * The owner now has their own list (Service.ownerPerforms, absent = yes), and
 * every surface below is pinned against it.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { futureDate } = require('../helpers/dates');
const { makeProvider, makeUser, makeService, authHeader } = require('../helpers/factories');
const Service = require('../../models/Service');
const TeamMember = require('../../models/TeamMember');
const Availability = require('../../models/Availability');
const StaffAvailability = require('../../models/StaffAvailability');
const Appointment = require('../../models/Appointment');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => Object.fromEntries(DAYS.map((d) => [d, { enabled: true, slots: [{ start, end }] }]));
const DATE = futureDate(0);

// Vido's barbershop: his own Trim (an old row, no flag) and Beard (from the
// catalogue form), a driver Erastus who logs in and adds his own trips, and a
// barber John who does Trim.
const setup = async () => {
    const owner = await makeProvider({ name: 'Vido Barber', businessProfile: { businessName: 'Vido Barber' } });
    await Availability.create({ provider: owner._id, schedule: everyDay('06:00', '22:00') });
    const trim = await makeService(owner._id, { name: 'Trim', price: 70, duration: 30 });
    const beardRes = await request(app).post('/api/services/my-services').set(authHeader(owner))
        .send({ name: 'Beard', description: 'Beard', price: 60, duration: 20 });
    const beard = await Service.findById(beardRes.body.data._id);

    const erastusUser = await makeUser({ role: 'staff', staffOf: owner._id, name: 'Erastus Driver' });
    const erastus = await TeamMember.create({
        provider: owner._id, name: 'Erastus', role: 'Driver', email: 'erastus@test.com',
        user: erastusUser._id, offersAllServices: false, services: [],
    });
    const john = await TeamMember.create({
        provider: owner._id, name: 'John', role: 'Barber', offersAllServices: false, services: [trim._id],
    });
    await StaffAvailability.create({ provider: owner._id, teamMember: erastus._id, schedule: everyDay('06:00', '22:00') });
    await StaffAvailability.create({ provider: owner._id, teamMember: john._id, schedule: everyDay('06:00', '22:00') });
    const customer = await makeUser({ name: 'Ndapewa Client' });
    return { owner, trim, beard, erastusUser, erastus, john, customer };
};

const memberAdds = (ctx, body) => request(app).post('/api/team/mine/services').set(authHeader(ctx.erastusUser)).send(body);
const ownerAddsFor = (ctx, member, body, as = ctx.owner) => request(app).post(`/api/team/${member._id}/services`).set(authHeader(as)).send(body);
const staffList = (ctx, q = '') => request(app).get(`/api/providers/${ctx.owner._id}/staff${q}`).then((r) => r.body.data);
const ownerTile = async (ctx, q) => (await staffList(ctx, q)).find((m) => m._id === 'owner');
const profile = (ctx) => request(app).get(`/api/providers/${ctx.owner._id}`).then((r) => r.body.data);
const feedCard = (ctx) => request(app).get('/api/providers').then((r) => r.body.data.find((p) => String(p._id) === String(ctx.owner._id)));
const book = (who, svc, teamMember, startTime = '10:00', minutes) => {
    const [h, m] = startTime.split(':').map(Number);
    const end = h * 60 + m + (minutes || svc.duration);
    const endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    return request(app).post('/api/appointments').set(authHeader(who))
        .send({ service: String(svc._id), appointmentDate: DATE, startTime, endTime, ...(teamMember ? { teamMember } : {}) });
};

describe('a service a team member adds is theirs, not the owner\'s', () => {
    it('the member\'s own add writes ownerPerforms:false; the catalogue writes true', async () => {
        const ctx = await setup();
        const res = await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 180 });
        expect(res.status).toBe(201);
        const trip = await Service.findById(res.body.data.service._id);
        expect(trip.ownerPerforms).toBe(false);
        expect(trip.price).toBe(20000); // the member's price — and nobody else's
        expect(ctx.beard.ownerPerforms).toBe(true);
    });

    it('the owner\'s "Add a service <member> offers" is the member\'s too — unless the owner says they offer it', async () => {
        const ctx = await setup();
        const forHim = await ownerAddsFor(ctx, ctx.erastus, { name: 'Windhoek to Swakop', price: 6000, duration: 180 });
        expect(forHim.status).toBe(201);
        expect((await Service.findById(forHim.body.data.service._id)).ownerPerforms).toBe(false);

        const both = await ownerAddsFor(ctx, ctx.erastus, { name: 'Airport run', price: 900, duration: 120, ownerPerforms: true });
        expect((await Service.findById(both.body.data.service._id)).ownerPerforms).toBe(true);
    });

    it('a manager adding for a colleague cannot opt the owner in', async () => {
        const ctx = await setup();
        const mgrUser = await makeUser({ role: 'staff', staffOf: ctx.owner._id, staffTier: 'high', name: 'Mara Manager' });
        await TeamMember.create({ provider: ctx.owner._id, name: 'Mara', email: 'mara@test.com', user: mgrUser._id, bookable: false });
        const res = await ownerAddsFor(ctx, ctx.erastus, { name: 'Car wash', price: 150, duration: 45, ownerPerforms: true }, mgrUser);
        expect([200, 201]).toContain(res.status);
        expect((await Service.findById(res.body.data.service._id)).ownerPerforms).toBe(false);
    });
});

describe('the owner\'s tile on the booking page', () => {
    it('lists only the owner\'s own services — never a member\'s', async () => {
        const ctx = await setup();
        const trip = (await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 180 })).body.data.service;

        const tile = await ownerTile(ctx);
        expect(tile.offersAllServices).toBe(false);
        expect(tile.services.sort()).toEqual([String(ctx.trim._id), String(ctx.beard._id)].sort());
        expect(tile.services).not.toContain(String(trip._id));

        // Erastus still has his trip, at his price.
        const er = (await staffList(ctx)).find((m) => m.name === 'Erastus');
        expect(er.services.map(String)).toContain(String(trip._id));
        expect(er.serviceOverrides.find((o) => String(o.service) === String(trip._id)).price).toBe(20000);
    });

    it('narrowed to a member-only service, the owner is not offered', async () => {
        const ctx = await setup();
        const trip = (await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 180 })).body.data.service;
        const names = (await staffList(ctx, `?serviceId=${trip._id}`)).map((m) => m.name);
        expect(names).toEqual(['Erastus']);
        // …but for the owner's own service they are.
        expect((await staffList(ctx, `?serviceId=${ctx.trim._id}`)).map((m) => m._id)).toContain('owner');
    });

    it('an owner who offers nothing themselves gets no tile', async () => {
        const ctx = await setup();
        await Service.updateMany({ provider: ctx.owner._id }, { $set: { ownerPerforms: false } });
        expect(await ownerTile(ctx)).toBeUndefined();
    });
});

describe('what clients see on the feed card and the profile', () => {
    it('"Starting at" and the service count describe the owner\'s offering, not a member\'s', async () => {
        const ctx = await setup();
        await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 180 });
        await memberAdds(ctx, { name: 'Tyre pressure check', price: 15, duration: 10 }); // cheaper than anything of the owner's

        const card = await feedCard(ctx);
        expect(card.serviceCount).toBe(2);
        expect(card.minPrice).toBe(60);
        expect(card.maxPrice).toBe(70);

        const p = await profile(ctx);
        expect(p.provider.serviceCount).toBe(2);
        expect(p.provider.minPrice).toBe(60);
    });

    it('the profile shows a member\'s service as THEIRS, at their price', async () => {
        const ctx = await setup();
        const trip = (await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 180 })).body.data.service;
        const featured = (await profile(ctx)).categories.featured.services;

        const tripRow = featured.find((s) => s._id === String(trip._id));
        expect(tripRow.ownerPerforms).toBe(false);
        expect(tripRow.performers).toEqual([{ _id: String(ctx.erastus._id), name: 'Erastus', price: 20000, duration: 180 }]);

        const trimRow = featured.find((s) => s._id === String(ctx.trim._id));
        expect(trimRow.ownerPerforms).toBe(true);
        expect(trimRow.performers[0]).toEqual({ _id: 'owner', name: 'Vido Barber', price: 70, duration: 30 });
    });

    it('a service nobody performs any more is not offered anywhere', async () => {
        const ctx = await setup();
        const trip = (await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 180 })).body.data.service;
        // Erastus stops doing it: it stays in the catalogue, but has nobody.
        await request(app).put('/api/team/mine/services').set(authHeader(ctx.erastusUser)).send({ services: [], offersAllServices: false });

        expect((await profile(ctx)).categories.featured.services.map((s) => s.name)).not.toContain('North to south');
        const pub = await request(app).get('/api/services');
        expect(pub.body.data.map((s) => s.name)).not.toContain('North to south');
        expect(pub.body.data.map((s) => s.name)).toContain('Trim');
        const booked = await book(ctx.customer, trip, null);
        expect(booked.status).toBe(400);
    });
});

describe('search', () => {
    it('finds the business by a member\'s service while someone performs it, not after', async () => {
        const ctx = await setup();
        await memberAdds(ctx, { name: 'North to south', price: 20000, duration: 60 });
        const hit = await request(app).get(`/api/providers/search?date=${DATE}&q=north`);
        expect(hit.status).toBe(200);
        expect(hit.body.data.map((r) => String(r.provider))).toContain(String(ctx.owner._id));

        await request(app).put('/api/team/mine/services').set(authHeader(ctx.erastusUser)).send({ services: [], offersAllServices: false });
        const miss = await request(app).get(`/api/providers/search?date=${DATE}&q=north`);
        expect(miss.body.data.map((r) => String(r.provider))).not.toContain(String(ctx.owner._id));
    });
});

describe('booking the owner', () => {
    it('a client cannot book the owner for a member\'s service — the price never becomes the owner\'s', async () => {
        const ctx = await setup();
        const trip = (await memberAdds(ctx, { name: 'Airport run', price: 900, duration: 120 })).body.data.service;

        const asOwner = await book(ctx.customer, trip, 'owner');
        expect(asOwner.status).toBe(400);
        expect(await Appointment.countDocuments({ service: trip._id })).toBe(0);

        // With Erastus it books, at his price.
        const withHim = await book(ctx.customer, trip, String(ctx.erastus._id));
        expect(withHim.status).toBe(201);
        expect(withHim.body.data.totalPrice).toBe(900);
    });

    it('the owner\'s own service still books with the owner, at the owner\'s price', async () => {
        const ctx = await setup();
        const res = await book(ctx.customer, ctx.trim, 'owner');
        expect(res.status).toBe(201);
        expect(res.body.data.teamMember == null).toBe(true);
        expect(res.body.data.totalPrice).toBe(70);
    });

    it('"any professional" never falls back to an owner who doesn\'t offer it', async () => {
        const ctx = await setup();
        const orphan = await makeService(ctx.owner._id, { name: 'Detailing', ownerPerforms: false, price: 500, duration: 60 });
        const res = await book(ctx.customer, orphan, null);
        expect(res.status).toBe(400);

        // …and the slot picker says so, instead of advertising the owner's free time.
        const slots = await request(app).get(`/api/appointments/booked-slots?providerId=${ctx.owner._id}&date=${DATE}&service=${orphan._id}`);
        expect(slots.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'off_shift', startTime: '00:00' })]));
    });

    it('the owner may still log a walk-in on their own column for anything (owner override)', async () => {
        const ctx = await setup();
        const trip = (await memberAdds(ctx, { name: 'Airport run', price: 900, duration: 120 })).body.data.service;
        const res = await request(app).post('/api/appointments').set(authHeader(ctx.owner))
            .send({ service: String(trip._id), appointmentDate: DATE, startTime: '10:00', endTime: '12:00', walkInName: 'Walk In' });
        expect(res.status).toBe(201);
    });
});

describe('a service BOTH perform, and same-name adds', () => {
    it('shows under each at their own price, and the member\'s add never reprices the owner', async () => {
        const ctx = await setup();
        const res = await memberAdds(ctx, { name: 'trim', price: 90, duration: 40 });
        expect(res.status).toBe(200);
        expect(res.body.data.reused).toBe(true);

        const trim = await Service.findById(ctx.trim._id);
        expect(trim.price).toBe(70);
        expect(trim.duration).toBe(30);
        expect(trim.ownerPerforms).toBeUndefined(); // untouched: still the owner's by the legacy reading

        expect((await ownerTile(ctx)).services).toContain(String(ctx.trim._id));
        const row = (await profile(ctx)).categories.featured.services.find((s) => s.name === 'Trim');
        expect(row.performers).toEqual(expect.arrayContaining([
            { _id: 'owner', name: 'Vido Barber', price: 70, duration: 30 },
            { _id: String(ctx.erastus._id), name: 'Erastus', price: 90, duration: 40 },
            { _id: String(ctx.john._id), name: 'John', price: 70, duration: 30 },
        ]));

        expect((await book(ctx.customer, ctx.trim, 'owner', '09:00')).body.data.totalPrice).toBe(70);
        expect((await book(ctx.customer, ctx.trim, String(ctx.erastus._id), '11:00', 40)).body.data.totalPrice).toBe(90);
        expect((await feedCard(ctx)).minPrice).toBe(60);
    });

    it('reviving a service the owner retired brings it back as the member\'s, at the old price', async () => {
        const ctx = await setup();
        const old = await makeService(ctx.owner._id, { name: 'Shave', price: 50, duration: 20, isActive: false, ownerPerforms: true });
        const res = await memberAdds(ctx, { name: 'Shave', price: 80, duration: 25 });
        expect(res.body.data.reused).toBe(true);
        const after = await Service.findById(old._id);
        expect(after.isActive).toBe(true);
        expect(after.ownerPerforms).toBe(false);
        expect(after.price).toBe(50);
        expect((await ownerTile(ctx)).services).not.toContain(String(old._id));
    });
});

describe('the owner\'s own control', () => {
    it('"I offer this" is the owner\'s switch — a services:edit team member cannot flip it', async () => {
        const ctx = await setup();
        const off = await request(app).put(`/api/services/${ctx.trim._id}`).set(authHeader(ctx.owner)).send({ ownerPerforms: false });
        expect(off.status).toBe(200);
        expect(off.body.data.ownerPerforms).toBe(false);
        expect((await ownerTile(ctx)).services).not.toContain(String(ctx.trim._id));

        const high = await makeUser({ role: 'staff', staffOf: ctx.owner._id, staffTier: 'high', name: 'Hilda High' });
        const tried = await request(app).put(`/api/services/${ctx.trim._id}`).set(authHeader(high)).send({ ownerPerforms: true, price: 75 });
        expect(tried.status).toBe(200);
        const trim = await Service.findById(ctx.trim._id);
        expect(trim.ownerPerforms).toBe(false); // unchanged
        expect(trim.price).toBe(75);            // the menu edit itself went through
    });

    it('a new menu item can be created as "only my team does this"', async () => {
        const ctx = await setup();
        const res = await request(app).post('/api/services/my-services').set(authHeader(ctx.owner))
            .send({ name: 'Colour', description: 'Colour', price: 300, duration: 90, ownerPerforms: false });
        expect(res.body.data.ownerPerforms).toBe(false);
    });
});

describe('the owner\'s own New Appointment (multi-service)', () => {
    it('prices each segment for the person doing it', async () => {
        const ctx = await setup();
        await memberAdds(ctx, { name: 'trim', price: 90, duration: 40 }); // Erastus's own Trim price
        const res = await request(app).post('/api/appointments/multi').set(authHeader(ctx.owner)).send({
            appointmentDate: DATE, startTime: '10:00', walkInName: 'Walk In',
            services: [
                { serviceId: String(ctx.trim._id), teamMember: String(ctx.erastus._id) },
                { serviceId: String(ctx.beard._id) },
            ],
        });
        expect(res.status).toBe(201);
        const segs = res.body.data.services;
        expect(segs[0]).toMatchObject({ price: 90, duration: 40, startTime: '10:00', endTime: '10:40' });
        expect(segs[1]).toMatchObject({ price: 60, duration: 20, startTime: '10:40', endTime: '11:00' });
        expect(res.body.data.totalPrice).toBe(150);
    });
});
