import { pushService } from '../services';

const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export const pushSupported = () =>
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const getPushState = async () => {
    if (!pushSupported()) return { supported: false, enabled: false, subscribed: false };
    try {
        const { data } = await pushService.getPublicKey();
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        return { supported: true, enabled: !!data.enabled, subscribed: !!sub, publicKey: data.publicKey };
    } catch {
        return { supported: true, enabled: false, subscribed: false };
    }
};

export const enablePush = async () => {
    if (!pushSupported()) throw new Error('Push not supported on this device');
    const { data } = await pushService.getPublicKey();
    if (!data.enabled || !data.publicKey) throw new Error('Push is not enabled on the server');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission denied');

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
    await pushService.subscribe(sub.toJSON());
    return true;
};

export const disablePush = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return true;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
        await pushService.unsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
    }
    return true;
};
