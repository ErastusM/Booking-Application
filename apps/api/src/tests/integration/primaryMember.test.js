/**
 * Primary team member — the "face of the business", shown first everywhere a
 * client chooses a professional. At most one per provider; setting one clears
 * the rest.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// The public staff list now leads with a synthetic owner tile; this suite is
// about STAFF ordering, so drop the owner and compare the real members.
const staffNames = (provider) => request(app)
    .get(`/api/providers/${provider._id}/staff`)
    .then((r) => r.body.data.filter((m) => !m.isOwner).map((m) => m.name));

const setPrimary = (provider, member, body = {}) => request(app)
    .put(`/api/team/${member._id}/primary`).set(authHeader(provider)).send(body);

describe('primary team member', () => {
    it('lists the primary first, and naming another moves it', async () => {
        const provider = await makeProvider();
        const alice = await TeamMember.create({ provider: provider._id, name: 'Alice' });
        const bob = await TeamMember.create({ provider: provider._id, name: 'Bob' });

        // Default order is creation order.
        expect(await staffNames(provider)).toEqual(['Alice', 'Bob']);

        // Bob primary → Bob first.
        expect((await setPrimary(provider, bob)).status).toBe(200);
        expect(await staffNames(provider)).toEqual(['Bob', 'Alice']);

        // Alice primary clears Bob → Alice first, and only one is primary.
        await setPrimary(provider, alice);
        expect((await TeamMember.findById(bob._id)).isPrimary).toBe(false);
        expect((await TeamMember.findById(alice._id)).isPrimary).toBe(true);
        expect(await staffNames(provider)).toEqual(['Alice', 'Bob']);

        // Clearing the primary falls back to creation order.
        await setPrimary(provider, alice, { isPrimary: false });
        const fresh = await TeamMember.find({ provider: provider._id });
        expect(fresh.every((m) => !m.isPrimary)).toBe(true);
    });

    it("won't let a provider set another business's member primary", async () => {
        const provider = await makeProvider();
        const other = await makeProvider();
        const theirs = await TeamMember.create({ provider: other._id, name: 'Theirs' });
        expect((await setPrimary(provider, theirs)).status).toBe(404);
        expect((await TeamMember.findById(theirs._id)).isPrimary).toBe(false);
    });
});
