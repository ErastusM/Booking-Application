import { ApiClientOptions, createHttp, inferApiBase } from './http';
import { makeServices, BookplusServices } from './services';

export type { ApiClientOptions, BookplusServices };
export { inferApiBase };

export const createBookplusClient = (options: ApiClientOptions = {}) => {
    const apiBase = inferApiBase(options.apiUrl);
    const api = createHttp(apiBase);
    const services = makeServices(api);
    return { api, apiBase, services };
};

export type BookplusClient = ReturnType<typeof createBookplusClient>;
