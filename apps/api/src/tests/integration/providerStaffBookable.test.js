/**
 * The professionals a client can choose are only those they can actually book:
 * active AND bookable. A front desk member (bookable:false) used to be listed,
 * picked, and then refused at the last step.
 */
const request = require('supertest');

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const TeamMember = require('../../models/TeamMember');
const { makeProvider } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

describe('GET /api/providers/:id/staff', () => {
    test('leaves out members who don’t take bookings', async () => {
        const owner = await makeProvider();
        await TeamMember.create([
            { provider: owner._id, name: 'John Shikongo', role: 'Barber' },
            { provider: owner._id, name: 'Lina Nghipandulwa', role: 'Front desk', bookable: false },
            { provider: owner._id, name: 'Paul Amutenya', role: 'Barber', isActive: false },
        ]);
        const res = await request(app).get(`/api/providers/${owner._id}/staff`);
        expect(res.status).toBe(200);
        expect(res.body.data.filter((m) => !m.isOwner).map((m) => m.name)).toEqual(['John Shikongo']);
    });

    test('a business whose only other member is the front desk books the owner directly (no picker)', async () => {
        const owner = await makeProvider();
        await TeamMember.create({ provider: owner._id, name: 'Lina Nghipandulwa', role: 'Front desk', bookable: false });
        const res = await request(app).get(`/api/providers/${owner._id}/staff`);
        expect(res.body.data).toEqual([]);
    });
});
