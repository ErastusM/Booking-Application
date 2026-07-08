import { AccountType, ApiClientOptions, createHttp, inferApiBase, bootstrapSession } from './http';
import { makeServices, BookplusServices } from './services';

export type { AccountType, ApiClientOptions, BookplusServices };
export { inferApiBase, bootstrapSession };

export const createBookplusClient = (options: ApiClientOptions = {}) => {
    const apiBase = inferApiBase(options.apiUrl);
    const api = createHttp(apiBase);
    const services = makeServices(api, options.accountType);
    return {
        api,
        apiBase,
        accountType: options.accountType,
        services,
        // SSO: exchange the parent-domain refresh cookie for tokens when this
        // app has none of its own (login made on a sibling subdomain). Scoped
        // to this app's accountType so a wrong-side cookie is not adopted.
        bootstrapSession: () => bootstrapSession(apiBase, options.accountType),
    };
};

export type BookplusClient = ReturnType<typeof createBookplusClient>;
