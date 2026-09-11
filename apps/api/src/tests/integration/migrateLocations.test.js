/**
 * Multi-location backfill — every provider ends up with exactly one primary
 * "Main" location, and the migration is idempotent + provider-only.
 */
const testDb = require('../helpers/testDb');
const { makeProvider, makeUser } = require('../helpers/factories');
const Location = require('../../models/Location');
const { migrateLocations } = require('../../../scripts/migrate_locations');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('migrate_locations — backfill a primary Main location per provider', () => {
    it('creates exactly one primary Main location for each provider and none for non-providers', async () => {
        const p1 = await makeProvider({ businessProfile: { address: '5 Market Rd' } });
        const p2 = await makeProvider();
        await makeUser(); // a customer — must not get a location

        const created = await migrateLocations();
        expect(created).toBe(2);

        const l1 = await Location.find({ provider: p1._id });
        expect(l1).toHaveLength(1);
        expect(l1[0].name).toBe('Main');
        expect(l1[0].isPrimary).toBe(true);
        expect(l1[0].isActive).toBe(true);
        expect(l1[0].address).toBe('5 Market Rd'); // seeded from the business profile

        expect(await Location.find({ provider: p2._id })).toHaveLength(1);
    });

    it('is idempotent — a second run creates nothing', async () => {
        await makeProvider();
        expect(await migrateLocations()).toBe(1);
        expect(await migrateLocations()).toBe(0);
    });

    it('leaves a provider who already has a location untouched', async () => {
        const p = await makeProvider();
        await Location.create({ provider: p._id, name: 'Custom', isPrimary: true, isActive: true });

        expect(await migrateLocations()).toBe(0);
        const locs = await Location.find({ provider: p._id });
        expect(locs).toHaveLength(1);
        expect(locs[0].name).toBe('Custom'); // not overwritten with a 'Main'
    });
});
