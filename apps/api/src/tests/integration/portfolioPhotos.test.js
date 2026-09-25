/**
 * Instagram-style portfolio: the owner picks a post shape and frames/adjusts
 * each photo; the feed and profile carry exactly that to the client.
 */
const request = require('supertest');

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const User = require('../../models/User');
const { makeProvider, authHeader } = require('../helpers/factories');
const { cleanEdit } = require('../../utils/photoEdits');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

const A = 'https://res.cloudinary.com/demo/image/upload/a.jpg';
const B = 'https://res.cloudinary.com/demo/image/upload/b.jpg';

describe('cleanEdit', () => {
    test('clamps the crop inside the photo and the adjustments to ±100', () => {
        expect(cleanEdit({ url: A, x: 0.9, y: -1, w: 0.5, h: 2, ar: 0.75, brightness: 250, warmth: -7.4, contrast: 0 }))
            .toEqual({ url: A, x: 0.5, y: 0, w: 0.5, h: 1, ar: 0.75, brightness: 100, warmth: -7 });
    });
    test('drops an edit with nothing valid in it', () => {
        expect(cleanEdit({ url: A, x: 'nope', brightness: 0 })).toBeNull();
        expect(cleanEdit({ x: 0.1 })).toBeNull();
    });
});

describe('PUT /api/auth/portfolio', () => {
    test('saves the shape and edits, and drops edits for photos no longer there', async () => {
        const owner = await makeProvider();
        const res = await request(app).put('/api/auth/portfolio').set(authHeader(owner)).send({
            images: [B, A], shape: '4:5',
            edits: [{ url: A, x: 0.1, y: 0.2, w: 0.4, h: 0.75, ar: 1.5, brightness: 10 }, { url: 'https://gone.jpg', x: 0, y: 0, w: 1, h: 1 }],
        });
        expect(res.status).toBe(200);
        expect(res.body.data.images).toEqual([B, A]); // order = the owner's order (B is now the cover)
        expect(res.body.data.shape).toBe('4:5');
        expect(res.body.data.edits).toEqual([{ url: A, x: 0.1, y: 0.2, w: 0.4, h: 0.75, ar: 1.5, brightness: 10 }]);

        // Removing a photo later drops its edit even when edits aren't resent.
        const again = await request(app).put('/api/auth/portfolio').set(authHeader(owner)).send({ images: [B] });
        expect(again.body.data.edits).toEqual([]);
    });

    test('changing only the shape re-fits every crop — same centre, same zoom', async () => {
        const owner = await makeProvider();
        await request(app).put('/api/auth/portfolio').set(authHeader(owner)).send({
            images: [A], shape: '1:1', edits: [{ url: A, x: 0.25, y: 0.1, w: 0.5, h: 0.5, ar: 1, brightness: 5 }],
        });
        const res = await request(app).put('/api/auth/portfolio').set(authHeader(owner)).send({ shape: '4:5' });
        const [e] = res.body.data.edits;
        // zoom 2 on a square photo: the 4:5 crop is 0.4 × 0.5 around the same centre (0.5, 0.35)
        expect(e.w).toBeCloseTo(0.4, 6);
        expect(e.h).toBeCloseTo(0.5, 6);
        expect(e.x).toBeCloseTo(0.3, 6);
        expect(e.y).toBeCloseTo(0.1, 6);
        expect(e.brightness).toBe(5);
    });

    test('a crop sent for another shape is fitted to the post shape, so it can never stretch', async () => {
        const owner = await makeProvider();
        const res = await request(app).put('/api/auth/portfolio').set(authHeader(owner)).send({
            images: [A], shape: '4:5', edits: [{ url: A, x: 0.25, y: 0.1, w: 0.5, h: 0.5, ar: 1 }],
        });
        const [e] = res.body.data.edits;
        expect((0.8 * e.h) / e.w).toBeCloseTo(e.ar, 6);
    });

    test('a crop without the photo\'s shape falls back to automatic framing on a shape change', async () => {
        const owner = await makeProvider();
        await User.updateOne({ _id: owner._id }, { portfolio: { images: [A], shape: '1:1', edits: [{ url: A, x: 0.1, y: 0.1, w: 0.5, h: 0.5, contrast: 12 }] } });
        const res = await request(app).put('/api/auth/portfolio').set(authHeader(owner)).send({ shape: '1.91:1' });
        expect(res.body.data.edits).toEqual([{ url: A, contrast: 12 }]);
    });

    test('refuses an unknown shape', async () => {
        const owner = await makeProvider();
        const res = await request(app).put('/api/auth/portfolio').set(authHeader(owner)).send({ shape: '16:9' });
        expect(res.status).toBe(400);
    });
});

describe('what clients receive', () => {
    const seed = async () => {
        const owner = await makeProvider({ businessProfile: { businessName: 'Vido Barber' } });
        await User.updateOne({ _id: owner._id }, { portfolio: { images: [A, B], shape: '4:5', edits: [{ url: B, x: 0, y: 0.25, w: 1, h: 0.5, ar: 1, saturation: 20 }] } });
        return owner;
    };

    test('the profile carries the shape and the edits of its photos', async () => {
        const owner = await seed();
        const res = await request(app).get(`/api/providers/${owner._id}`);
        const p = res.body.data.provider;
        expect(p.photos).toEqual([A, B]);
        expect(p.photoShape).toBe('4:5');
        expect(p.photoEdits).toEqual({ [B]: { url: B, x: 0, y: 0.25, w: 1, h: 0.5, ar: 1, saturation: 20 } });
    });

    test('a business that never framed its photos gets the square default', async () => {
        const owner = await makeProvider();
        await User.updateOne({ _id: owner._id }, { 'portfolio.images': [A] });
        const res = await request(app).get(`/api/providers/${owner._id}`);
        expect(res.body.data.provider.photoShape).toBe('1:1');
        expect(res.body.data.provider.photoEdits).toEqual({});
    });
});
