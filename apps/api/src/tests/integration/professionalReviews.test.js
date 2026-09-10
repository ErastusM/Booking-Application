/**
 * Per-professional review attribution + the public per-professional views.
 *
 * A review is attributed to the professional who performed the booking, so a
 * business's roster shows each pro's own rating and a pro's reviews can be
 * listed on their profile. These pin: attribution at creation, the per-member
 * aggregate on the public staff list, the public per-professional reviews
 * endpoint (and that it never leaks the reviewer's email), and the backfill
 * migration for reviews written before attribution existed.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Review = require('../../models/Review');
const { migrateReviewAttribution } = require('../../../scripts/migrate_review_attribution');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A completed booking performed by `member`, ready to be reviewed by `customer`.
const completedFor = (customer, service, provider, member) =>
    makeAppointment(customer._id, service._id, provider._id, { teamMember: member?._id || null, status: 'completed' });

const postReview = (customer, appointmentId, rating, comment = 'Great cut') =>
    request(app).post('/api/reviews').set(authHeader(customer)).send({ appointmentId, rating, comment });

describe('review attribution at creation', () => {
    it('stamps the performing professional and the business onto the review', async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const service = await makeService(provider._id);
        const moses = await TeamMember.create({ provider: provider._id, name: 'Moses', role: 'Barber' });
        const appt = await completedFor(customer, service, provider, moses);

        const res = await postReview(customer, appt._id.toString(), 5);
        expect(res.status).toBe(201);

        const saved = await Review.findOne({ appointment: appt._id });
        expect(String(saved.teamMember)).toBe(String(moses._id));
        expect(String(saved.provider)).toBe(String(provider._id));
    });

    it('attributes an owner-column booking to the owner (teamMember null)', async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const service = await makeService(provider._id);
        const appt = await completedFor(customer, service, provider, null); // no member → owner column

        await postReview(customer, appt._id.toString(), 4);
        const saved = await Review.findOne({ appointment: appt._id });
        expect(saved.teamMember).toBeNull();
        expect(String(saved.provider)).toBe(String(provider._id));
    });
});

describe('per-professional rating on the public staff list', () => {
    it('shows each professional their own average and count', async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const service = await makeService(provider._id);
        const moses = await TeamMember.create({ provider: provider._id, name: 'Moses', role: 'Barber' });
        const sarah = await TeamMember.create({ provider: provider._id, name: 'Sarah', role: 'Stylist' });

        // Moses: 4 and 5 → avg 4.5, count 2. Sarah: none.
        for (const r of [4, 5]) {
            const appt = await completedFor(customer, service, provider, moses);
            await postReview(customer, appt._id.toString(), r);
        }

        const res = await request(app).get(`/api/providers/${provider._id}/staff`);
        expect(res.status).toBe(200);
        const mTile = res.body.data.find((m) => String(m._id) === String(moses._id));
        const sTile = res.body.data.find((m) => String(m._id) === String(sarah._id));
        expect(mTile.ratingAvg).toBe(4.5);
        expect(mTile.ratingCount).toBe(2);
        expect(sTile.ratingAvg).toBeNull();
        expect(sTile.ratingCount).toBe(0);
    });
});

describe('public per-professional reviews endpoint', () => {
    it("returns a professional's own reviews with the average, and never the reviewer's email", async () => {
        const provider = await makeProvider();
        const customer = await makeUser({ email: 'reviewer@test.com' });
        const service = await makeService(provider._id);
        const moses = await TeamMember.create({ provider: provider._id, name: 'Moses', role: 'Barber' });
        const sarah = await TeamMember.create({ provider: provider._id, name: 'Sarah', role: 'Stylist' });

        const a1 = await completedFor(customer, service, provider, moses);
        await postReview(customer, a1._id.toString(), 5, 'Best fade in town');
        const a2 = await completedFor(customer, service, provider, sarah);
        await postReview(customer, a2._id.toString(), 3, 'Fine');

        const res = await request(app).get(`/api/providers/${provider._id}/staff/${moses._id}/reviews`);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.avgRating).toBe(5);
        expect(res.body.data[0].comment).toBe('Best fade in town');
        // Sarah's review is not in Moses's list.
        expect(res.body.data.every((r) => r.comment !== 'Fine')).toBe(true);
        // The reviewer's email never ships.
        expect(JSON.stringify(res.body)).not.toMatch(/reviewer@test.com/);
    });

    it("the 'owner' sentinel returns the owner-column reviews", async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const service = await makeService(provider._id);
        const appt = await completedFor(customer, service, provider, null); // owner column
        await postReview(customer, appt._id.toString(), 4, 'Owner did it');

        const res = await request(app).get(`/api/providers/${provider._id}/staff/owner/reviews`);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.data[0].comment).toBe('Owner did it');
    });
});

describe('backfill migration', () => {
    it('attributes reviews written before attribution existed', async () => {
        const provider = await makeProvider();
        const customer = await makeUser();
        const service = await makeService(provider._id);
        const moses = await TeamMember.create({ provider: provider._id, name: 'Moses', role: 'Barber' });
        const appt = await completedFor(customer, service, provider, moses);

        // A pre-attribution review: created directly with no teamMember/provider.
        const legacy = await Review.create({
            customer: customer._id, service: service._id, appointment: appt._id, rating: 5, comment: 'Old review',
        });
        expect(legacy.provider).toBeNull();

        const updated = await migrateReviewAttribution();
        expect(updated).toBe(1);

        const after = await Review.findById(legacy._id);
        expect(String(after.teamMember)).toBe(String(moses._id));
        expect(String(after.provider)).toBe(String(provider._id));

        // Idempotent: a second run changes nothing.
        expect(await migrateReviewAttribution()).toBe(0);
    });
});
