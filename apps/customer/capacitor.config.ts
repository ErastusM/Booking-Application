import type { CapacitorConfig } from '@capacitor/cli';

// Bookplus customer app — native shell (iOS + Android) wrapping the built PWA.
// The web bundle in dist/ is shipped inside the app; API calls still go to the
// remote backend (api.bookplus.pro), so build with VITE_API_URL set to prod.
const config: CapacitorConfig = {
    appId: 'pro.bookplus.customer',
    appName: 'Bookplus',
    webDir: 'dist',
    backgroundColor: '#040505',
    ios: {
        contentInset: 'always',
    },
    android: {
        // allow the app to reach the HTTPS API over cleartext-free connections
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
