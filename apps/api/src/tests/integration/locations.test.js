/**
 * Multi-location foundation — owner CRUD for business locations.
 *
 * Pins the provider-scoped guarantees the later read-threading PRs will lean on:
 *   - the FIRST location a provider creates is primary; later ones are not
 *   - locations are strictly provider-scoped (no cross-tenant read/write)
 *   - exactly one primary; promoting one clears the rest
 *   - the primary can't be deactivated out from under a null locationId
 *   - only a provider (owner) can manage locations
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const Location = require('../../models/Location');
const Appointment = require('../../models/Appointment');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const list = (as) => request(app).get('/api/locations/mine').set(authHeader(as));
const create = (as, body) => request(app).post('/api/locations').set(authHeader(as)).send(body);
const update = (as, id, body) => request(app).put(`/api/locations/${id}`).set(authHeader(as)).send(body);
const setPrimary = (as, id) => request(app).put(`/api/locations/${id}/primary`).set(authHeader(as));

describe('locations — owner CRUD', () => {
    it('the first location is primary; the second is not', async () => {
        const owner = await makeProvider();
        const a = await create(owner, { name: 'Downtown', address: '1 High St' });
        expect(a.status).toBe(201);
        expect(a.body.data.isPrimary).toBe(true);
        expect(a.body.data.isActive).toBe(true);

        const b = await create(owner, { name: 'Uptown' });
        expect(b.status).toBe(201);
        expect(b.body.data.isPrimary).toBe(false);

        const mine = await list(owner);
        expect(mine.status).toBe(200);
        expect(mine.body.data).toHaveLength(2);
        expect(mine.body.data[0].isPrimary).toBe(true); // primary sorts first
    });

    it('rejects a blank name', async () => {
        const owner = await makeProvider();
        expect((await create(owner, { name: '   ' })).status).toBe(400);
    });

    it('locations are provider-scoped — one owner never sees or edits another\'s', async () => {
        const owner = await makeProvider();
        const other = await makeProvider();
        const mine = await create(owner, { name: 'Mine' });

        expect((await list(other)).body.data).toHaveLength(0);
        // another owner can't rename it (scoped findOne → 404)
        expect((await update(other, mine.body.data._id, { name: 'Hijack' })).status).toBe(404);
        expect((await setPrimary(other, mine.body.data._id)).status).toBe(404);
    });

    it('promoting a location to primary clears the previous primary', async () => {
        const owner = await makeProvider();
        const first = await create(owner, { name: 'First' });   // primary
        const second = await create(owner, { name: 'Second' }); // not

        const res = await setPrimary(owner, second.body.data._id);
        expect(res.status).toBe(200);
        expect(res.body.data.isPrimary).toBe(true);

        const mine = await list(owner);
        const byId = Object.fromEntries(mine.body.data.map((l) => [String(l._id), l]));
        expect(byId[String(second.body.data._id)].isPrimary).toBe(true);
        expect(byId[String(first.body.data._id)].isPrimary).toBe(false);
    });

    it('renames and deactivates a NON-primary location, but refuses to deactivate the primary', async () => {
        const owner = await makeProvider();
        const primary = await create(owner, { name: 'Primary' });
        const branch = await create(owner, { name: 'Branch' });

        // rename works
        const renamed = await update(owner, branch.body.data._id, { name: 'Branch B', address: '2 Side St' });
        expect(renamed.status).toBe(200);
        expect(renamed.body.data.name).toBe('Branch B');
        expect(renamed.body.data.address).toBe('2 Side St');

        // deactivating the non-primary is allowed (primary still active)
        const off = await update(owner, branch.body.data._id, { isActive: false });
        expect(off.status).toBe(200);
        expect(off.body.data.isActive).toBe(false);

        // deactivating the primary is refused — a null locationId must resolve to a live primary
        const refuse = await update(owner, primary.body.data._id, { isActive: false });
        expect(refuse.status).toBe(400);
        expect(refuse.body.message).toMatch(/primary/i);

        // can't make an inactive location primary either
        const badPromote = await setPrimary(owner, branch.body.data._id);
        expect(badPromote.status).toBe(400);
    });

    it('only a provider can manage locations', async () => {
        const owner = await makeProvider();
        const customer = await makeUser();
        const staff = await makeUser({ role: 'staff', staffOf: owner._id });
        expect((await list(customer)).status).toBe(403);
        expect((await create(customer, { name: 'X' })).status).toBe(403);
        expect((await list(staff)).status).toBe(403); // even an employee of a business can't
    });

    it('refuses to deactivate the last active location (defense in depth)', async () => {
        // Unreachable through the CRUD (the first location is always primary, and
        // the primary can't be retired), so seed the artificial state directly:
        // a lone active NON-primary location. Deactivating it must still be
        // refused — a business needs at least one active location.
        const owner = await makeProvider();
        const only = await Location.create({ provider: owner._id, name: 'Solo', isPrimary: false, isActive: true });
        const res = await update(owner, only._id, { isActive: false });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/at least one active/i);
    });

    it('at most one primary per provider is enforced by the DB (partial unique index)', async () => {
        await Location.init(); // ensure the partial unique index is built before we lean on it
        const owner = await makeProvider();
        await Location.create({ provider: owner._id, name: 'A', isPrimary: true, isActive: true });
        // A second primary for the same provider is rejected at the storage layer.
        await expect(
            Location.create({ provider: owner._id, name: 'B', isPrimary: true, isActive: true })
        ).rejects.toMatchObject({ code: 11000 });
        // …but two DIFFERENT providers can each have their own primary.
        const other = await makeProvider();
        await expect(
            Location.create({ provider: other._id, name: 'C', isPrimary: true, isActive: true })
        ).resolves.toBeTruthy();
    });
});

describe('Appointment.locationId — inert foundation field', () => {
    it('defaults to null and stays OUT of ordinary reads (byte-for-byte payloads)', async () => {
        const owner = await makeProvider();
        const svc = await makeService(owner._id);
        const customer = await makeUser();
        const appt = await makeAppointment(customer._id, svc._id, owner._id, { status: 'confirmed' });

        // A normal fetch must NOT carry the new field (select:false) — so every
        // existing appointment payload is unchanged.
        const plain = await Appointment.findById(appt._id);
        expect(plain.locationId).toBeUndefined();

        // It exists and defaults to null only when explicitly opted into.
        const withField = await Appointment.findById(appt._id).select('+locationId');
        expect(withField.locationId).toBeNull();
    });
});
