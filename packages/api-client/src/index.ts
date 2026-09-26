import {
    AccountType, ApiClientOptions, createHttp, inferApiBase, bootstrapSession,
    forceLogout, isPublicTokenPath, PUBLIC_TOKEN_PATHS,
} from './http';
import { makeServices, BookplusServices } from './services';
import { createTelemetry, Telemetry } from './telemetry';
import { scrubUrl, scrubText, scrubPath, routeTemplate } from './redact';
import {
    CONSENT_KEY, ANALYTICS_ID_KEY, CONSENT_CHANGE_EVENT, CONSENT_OPEN_EVENT,
    getConsent, setConsent, hasAnalyticsConsent, openConsentSettings, onConsentChange,
} from './consent';
import type { ConsentChoice } from './consent';

export type { AccountType, ApiClientOptions, BookplusServices, Telemetry };
export { inferApiBase, bootstrapSession, createTelemetry, forceLogout, isPublicTokenPath, PUBLIC_TOKEN_PATHS };
export { scrubUrl, scrubText, scrubPath, routeTemplate };
export {
    CONSENT_KEY, ANALYTICS_ID_KEY, CONSENT_CHANGE_EVENT, CONSENT_OPEN_EVENT,
    getConsent, setConsent, hasAnalyticsConsent, openConsentSettings, onConsentChange,
};
export type { ConsentChoice };

export const createBookplusClient = (options: ApiClientOptions = {}) => {
    const apiBase = inferApiBase(options.apiUrl);
    const publicTokenPaths = options.publicTokenPaths || PUBLIC_TOKEN_PATHS;
    const api = createHttp(apiBase, options.accountType, publicTokenPaths);
    const services = makeServices(api, options.accountType);
    const telemetry = createTelemetry(api, apiBase, options.accountType === 'business' ? 'business' : 'customer');
    return {
        api,
        apiBase,
        accountType: options.accountType,
        services,
        telemetry,
        // SSO: exchange the parent-domain refresh cookie for tokens when this
        // app has none of its own (login made on a sibling subdomain). Scoped
        // to this app's accountType so a wrong-side cookie is not adopted.
        bootstrapSession: () => bootstrapSession(apiBase, options.accountType),
        // Emailed-link pages (invite / reset / verify): the app must not
        // validate, refresh or redirect a session while one is open.
        publicTokenPaths,
        isPublicTokenPath: (pathname: string) => isPublicTokenPath(pathname, publicTokenPaths),
    };
};

export type BookplusClient = ReturnType<typeof createBookplusClient>;
