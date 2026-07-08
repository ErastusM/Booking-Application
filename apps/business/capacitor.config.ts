import type { CapacitorConfig } from '@capacitor/cli';

// Bookplus for Business — native shell (iOS + Android) wrapping the built PWA.
// The web bundle in dist/ ships inside the app; API calls go to the remote
// backend (api.bookplus.pro), so build with VITE_API_URL set to prod.
const config: CapacitorConfig = {
    appId: 'pro.bookplus.business',
    appName: 'Bookplus for Business',
    webDir: 'dist',
    backgroundColor: '#040505',
    ios: {
        contentInset: 'always',
    },
    android: {
        allowMixedContent: false,
    },
    plugins: {
        SplashScreen: {
            launchShowDuration: 600,
            backgroundColor: '#040505',
            showSpinner: false,
            androidScaleType: 'CENTER_CROP',
        },
    },
};

export default config;
