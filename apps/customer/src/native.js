// Native-only bootstrap for the Capacitor shell. Everything here is a no-op in
// a normal browser (Capacitor.isNativePlatform() === false), so importing it in
// main.jsx is safe for the web build too. Plugins are dynamically imported so
// their native code never weighs down the web bundle.
import { Capacitor } from '@capacitor/core';

export async function initNative() {
    if (!Capacitor.isNativePlatform()) return;

    try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        // App chrome is dark ink; light status-bar content reads on it.
        await StatusBar.setStyle({ style: Style.Dark });
        if (Capacitor.getPlatform() === 'android') {
            await StatusBar.setBackgroundColor({ color: '#040505' });
        }
    } catch { /* status-bar plugin absent — ignore */ }

    try {
        const { SplashScreen } = await import('@capacitor/splash-screen');
        // Hide once React has painted the first screen.
        await SplashScreen.hide();
    } catch { /* splash plugin absent — ignore */ }

    try {
        const { App } = await import('@capacitor/app');
        // Android hardware back: leave the app on the home route instead of
        // killing it on the first back-press from a deep screen.
        App.addListener('backButton', ({ canGoBack }) => {
            if (canGoBack) window.history.back();
            else App.exitApp();
        });
    } catch { /* app plugin absent — ignore */ }
}
