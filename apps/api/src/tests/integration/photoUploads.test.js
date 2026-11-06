/**
 * Public pictures (avatars, portfolio, team photos) are uploaded with a
 * signature from the API: images only, into the uploader's own folder, shrunk
 * on arrival. The unsigned preset that let anyone upload anything is gone.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');
const cloudinary = require('../../utils/cloudinary');

const CLOUD = 'testcloud';
beforeAll(() => testDb.connect());
beforeEach(() => { process.env.CLOUDINARY_URL = `cloudinary://key123:secret456@${CLOUD}`; });
afterEach(async () => { delete process.env.CLOUDINARY_URL; await testDb.clearDatabase(); });
afterAll(() => testDb.closeDatabase());

describe('POST /api/uploads/photo', () => {
    it('signs one image upload into the signed-in account\'s own folder', async () => {
        const provider = await makeProvider();
        const res = await request(app).post('/api/uploads/photo').set(authHeader(provider)).expect(200);
        const d = res.body.data;
        expect(d).toMatchObject({
            cloudName: CLOUD, apiKey: 'key123',
            uploadUrl: `https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`,
            folder: `bookplus/photos/${provider._id}`,
            allowed_formats: 'jpg,jpeg,png,webp,heic,heif',
            transformation: 'c_limit,w_2000,h_2000',
        });
        // Everything that limits the upload is covered by the signature.
        const { timestamp, folder, allowed_formats: allowedFormats, transformation } = d;
        expect(d.signature).toBe(cloudinary.signParams({ timestamp, folder, allowed_formats: allowedFormats, transformation }, 'secret456'));
        expect(JSON.stringify(res.body)).not.toContain('secret456');
    });

    it('each account gets its own folder; a client can upload an avatar too', async () => {
        const client = await makeUser();
        const res = await request(app).post('/api/uploads/photo').set(authHeader(client)).expect(200);
        expect(res.body.data.folder).toBe(`bookplus/photos/${client._id}`);
    });

    it('needs a signed-in account', async () => {
        expect((await request(app).post('/api/uploads/photo')).status).toBe(401);
    });

    it('without Cloudinary credentials it says so, rather than falling back to an unsigned upload', async () => {
        delete process.env.CLOUDINARY_URL;
        const res = await request(app).post('/api/uploads/photo').set(authHeader(await makeUser()));
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('photo_upload_unavailable');
    });
});
