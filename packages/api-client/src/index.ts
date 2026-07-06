import { ApiClientOptions, createHttp, inferApiBase, bootstrapSession } from './http';
import { makeServices, BookplusServices } from './services';

export type { ApiClientOptions, BookplusServices };
export { inferApiBase, bootstrapSession };

export const createBookplusClient = (options: ApiClientOptions = {}) => {
    const apiBase = inferApiBase(options.apiUrl);
    const api = createHttp(apiBase);
    const services = makeServices(api);
    return {
        api,
        apiBase,
        services,
        // SSO: exchange the parent-domain refresh cookie for tokens when this
        // app has none of its own (login made on a sibling subdomain).
        bootstrapSession: () => bootstrapSession(apiBase),
    };
};

export type BookplusClient = ReturnType<typeof createBookplusClient>;
