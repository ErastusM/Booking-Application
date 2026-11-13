import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Public pictures go up with parameters the API signed (folder, formats,
 * resize), never with an unsigned preset.
 */
const svc = vi.hoisted(() => ({ uploadService: {}, walletService: {} }));
vi.mock('../services', () => svc);

import { uploadToCloudinary, PHOTO_MAX_BYTES } from './uploadImage';

const PARAMS = {
    uploadUrl: 'https://api.cloudinary.com/v1_1/cloud/image/upload', apiKey: 'key123', timestamp: 1700000000,
    signature: 'sig', folder: 'bookplus/photos/u1', allowed_formats: 'jpg,png', transformation: 'c_limit,w_2000,h_2000',
};

beforeEach(() => {
    svc.uploadService = { photoParams: vi.fn().mockResolvedValue({ data: { data: PARAMS } }) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/cloud/image/upload/x.jpg' }) }));
});
afterEach(() => vi.unstubAllGlobals());

describe('uploadToCloudinary', () => {
    it('uploads with the signed parameters and no preset', async () => {
        const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' });
        expect(await uploadToCloudinary(file)).toBe('https://res.cloudinary.com/cloud/image/upload/x.jpg');
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe(PARAMS.uploadUrl);
        const sent = Object.fromEntries([...init.body.entries()].filter(([k]) => k !== 'file'));
        expect(sent).toEqual({
            api_key: 'key123', timestamp: '1700000000', signature: 'sig',
            folder: 'bookplus/photos/u1', allowed_formats: 'jpg,png', transformation: 'c_limit,w_2000,h_2000',
        });
        expect(init.body.has('upload_preset')).toBe(false);
    });

    it('refuses a photo over 10 MB before asking the server', async () => {
        const big = { size: PHOTO_MAX_BYTES + 1, name: 'big.jpg', type: 'image/jpeg' };
        await expect(uploadToCloudinary(big)).rejects.toThrow('over 10 MB');
        expect(svc.uploadService.photoParams).not.toHaveBeenCalled();
    });

    it('passes on the server\'s reason when it cannot sign', async () => {
        svc.uploadService.photoParams = vi.fn().mockRejectedValue({ response: { data: { message: 'Photo uploads are unavailable right now.' } } });
        await expect(uploadToCloudinary(new File(['x'], 'a.jpg'))).rejects.toThrow('Photo uploads are unavailable right now.');
    });
});
