// Kept as a module so the app's existing `import API from '../services/api'`
// call sites don't change. The axios instance, base-URL inference, and the
// single-flight refresh interceptor live in @bookplus/api-client.
import client from './client';

export const API_BASE = client.apiBase;
export default client.api;
