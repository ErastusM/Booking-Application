/**
 * Multi-location — write threading (step 1): a booking may name one of the
 * provider's own active locations, and it is validated + recorded. Absent → null
 * (the single-location path, unchanged). A foreign/inactive location is refused.
 */
const request = require('supertest');
const { futureDate } = require('../helpers/dates');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');
const Location = require('../../models/Location');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => {
    const s = {};
    DAYS.forEach((d) => { s[d] = { enabled: true, slots: [{ start, end }] }; });
    return s;
};
const DATE = futureDate(0);

const setup = async () => {
    const provider = await makeProvider();
    const svc = await makeService(provider._id, { price: 100, duration: 60 });
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
    const customer = await makeUser();
    return { provider, svc, customer };
};
const book = (customer, svc, body) => request(app).post('/api/appointments').set(authHeader(customer)).send({
    service: svc._id.toString(), appointmentDate: DATE, startTime: '10:00', endTime: '11:00', ...body,
});
// Ordinary reads never carry locationId (select:false); opt in to check it.
const locOf = async (id) => (await Appointment.findById(id).select('+locationId')).locationId;

describe('booking write-threading — locationId', () => {
    it("records a provider's own active location when the booking names it", async () => {
        const { provider, svc, customer } = await setup();
        const loc = await Location.create({ provider: provider._id, name: 'Downtown', isPrimary: true, isActive: true });

        const res = await book(customer, svc, { locationId: loc._id.toString() });
        expect(res.status).toBe(201);
        expect(String(await locOf(res.body.data._id))).toBe(String(loc._id));
    });

    it('leaves locationId null when the booking names none (single-location path, unchanged)', async () => {
        const { svc, customer } = await setup();
        const res = await book(customer, svc, {});
        expect(res.status).toBe(201);
        expect(await locOf(res.body.data._id)).toBeNull();
    });

    it("refuses another business's location (cross-tenant)", async () => {
        const { svc, customer } = await setup();
        const otherBiz = await makeProvider();
        const foreign = await Location.create({ provider: otherBiz._id, name: 'Theirs', isPrimary: true, isActive: true });

        const res = await book(customer, svc, { locationId: foreign._id.toString() });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/location/i);
        expect(await Appointment.countDocuments({})).toBe(0); // nothing written
    });

    it('refuses an inactive location, and a malformed id', async () => {
        const { provider, svc, customer } = await setup();
        const off = await Location.create({ provider: provider._id, name: 'Closed', isPrimary: false, isActive: false });
        expect((await book(customer, svc, { locationId: off._id.toString() })).status).toBe(400);
        expect((await book(customer, svc, { locationId: 'not-an-id' })).status).toBe(400);
    });
});

describe('public provider locations read', () => {
    it('returns only ACTIVE locations, primary first, without owner-only noise', async () => {
        const provider = await makeProvider();
        await Location.create({ provider: provider._id, name: 'Main', address: '1 A St', isPrimary: true, isActive: true });
        await Location.create({ provider: provider._id, name: 'Branch', isPrimary: false, isActive: true });
        await Location.create({ provider: provider._id, name: 'Old', isPrimary: false, isActive: false });

        const res = await request(app).get(`/api/locations/provider/${provider._id}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);            // the inactive one is hidden
        expect(res.body.data[0].name).toBe('Main');       // primary first
        expect(res.body.data[0].address).toBe('1 A St');
        expect(res.body.data.some((l) => l.name === 'Old')).toBe(false);
    });
});
