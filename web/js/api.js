// Talks to the Cosmos Notebook API (served under /api on the same site).
import { getAccessToken, refresh } from './auth.js';

const CFG = window.COSMOS_CONFIG || {};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(method, path, body, { retry = true } = {}) {
  const token = await getAccessToken();
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${CFG.apiBase || ''}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }
  if (res.status === 401 && token && retry && (await refresh())) return api(method, path, body, { retry: false });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback =
      res.status === 404 ? 'Not found — it may have been removed.' : res.status === 429 ? 'Too many requests — please slow down a little.' : `Request failed (${res.status})`;
    throw new ApiError(res.status, data.error || data.message || fallback);
  }
  return data;
}

export const get = (path) => api('GET', path);
export const put = (path, body) => api('PUT', path, body);
export const post = (path, body) => api('POST', path, body ?? {});
export const del = (path) => api('DELETE', path);

/** The full library: the built-in items plus approved community additions. */
let libraryCache;
export function loadLibrary() {
  libraryCache ||= Promise.all([
    fetch('/library.json').then((r) => r.json()),
    get('/library').catch(() => ({ items: [] })),
  ]).then(([seed, community]) => ({
    phases: seed.phases,
    items: [
      ...seed.items,
      ...community.items.map((i) => ({ ...i, community: true, url: `/library/item/?id=${encodeURIComponent(i.id)}` })),
    ],
  }));
  return libraryCache;
}
