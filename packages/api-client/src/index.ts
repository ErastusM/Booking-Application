import { AccountType, ApiClientOptions, createHttp, inferApiBase, bootstrapSession } from './http';
import { makeServices, BookplusServices } from './services';
import { createTelemetry, Telemetry } from './telemetry';

export type { AccountType, ApiClientOptions, BookplusServices, Telemetry };
export { inferApiBase, bootstrapSession, createTelemetry };

export const createBookplusClient = (options: ApiClientOptions = {}) => {
    const apiBase = inferApiBase(options.apiUrl);
    const api = createHttp(apiBase, options.accountType);
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
    };
};

export type BookplusClient = ReturnType<typeof createBookplusClient>;
