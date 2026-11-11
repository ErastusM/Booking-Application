import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getPushState shows notifications as on only when the server has this device
 * for the signed-in user. The browser keeps its subscription when the server
 * forgets it (another account turned it on here, or the list was cleared after
 * a key rotation, docs/ROTATING_SECRETS.md), and then the banner and the
 * switch must offer to turn it on again.
 */
const svc = vi.hoisted(() => ({ pushService: {} }));
vi.mock('../services', () => svc);

import { getPushState } from './push';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const setDevice = ({ sub = { endpoint: ENDPOINT } } = {}) => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('PushManager', function PushManager() {});
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) } }) },
    });
};

beforeEach(() => {
    svc.pushService = {
        getPublicKey: vi.fn().mockResolvedValue({ data: { enabled: true, publicKey: 'pk' } }),
        status: vi.fn().mockResolvedValue({ data: { registered: true } }),
    };
});
afterEach(() => { vi.unstubAllGlobals(); delete navigator.serviceWorker; });

describe('getPushState', () => {
    it('on when the server has this device for me', async () => {
        setDevice();
        expect(await getPushState()).toMatchObject({ supported: true, enabled: true, subscribed: true });
        expect(svc.pushService.status).toHaveBeenCalledWith(ENDPOINT);
    });

    it('off when the browser has a subscription the server does not hold for me', async () => {
        setDevice();
        svc.pushService.status = vi.fn().mockResolvedValue({ data: { registered: false } });
        expect(await getPushState()).toMatchObject({ subscribed: false });
    });

    it('off with no browser subscription, without asking the server', async () => {
        setDevice({ sub: null });
        expect(await getPushState()).toMatchObject({ subscribed: false });
        expect(svc.pushService.status).not.toHaveBeenCalled();
    });

    it('if the server cannot be asked, keeps the browser\'s view', async () => {
        setDevice();
        svc.pushService.status = vi.fn().mockRejectedValue(new Error('offline'));
        expect(await getPushState()).toMatchObject({ subscribed: true });
    });
});
