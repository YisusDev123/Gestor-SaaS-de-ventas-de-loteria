export function resolveApiBaseUrl(configuredBaseUrl, location = globalThis.location) {
  const explicitUrl = configuredBaseUrl?.trim();
  if (explicitUrl) return explicitUrl.replace(/\/$/, '');

  const protocol = location?.protocol === 'https:' ? 'https:' : 'http:';
  const hostname = location?.hostname || 'localhost';
  return `${protocol}//${hostname}:2000`;
}

const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

const scopes = {
  seller: { token: null, refreshPromise: null, refreshPath: '/auth/refresh' },
  admin: { token: null, refreshPromise: null, refreshPath: '/saas-admin/auth/refresh' },
};

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', correlationId = null, details = [] } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }
}

export function setAccessToken(scope, token) {
  scopes[scope].token = token || null;
}

export function clearAccessToken(scope) {
  scopes[scope].token = null;
}

async function readResponse(response, responseType) {
  if (responseType === 'blob') {
    if (response.ok) return response.blob();
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new ApiError(payload?.error?.message || 'No fue posible completar la solicitud.', {
      status: response.status,
      code: payload?.error?.code || 'HTTP_ERROR',
      correlationId: payload?.correlationId || response.headers.get('X-Correlation-Id'),
      details: payload?.error?.details || [],
    });
  }
  return payload;
}

async function rawRequest(path, { scope, method = 'GET', body, signal, responseType = 'json' } = {}) {
  const headers = new Headers({ Accept: responseType === 'blob' ? 'application/pdf' : 'application/json' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (scope && scopes[scope].token) headers.set('Authorization', `Bearer ${scopes[scope].token}`);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.');
  }
  return { response, content: await readResponse(response, responseType) };
}

export async function refreshSession(scope) {
  const state = scopes[scope];
  if (!state.refreshPromise) {
    state.refreshPromise = rawRequest(state.refreshPath, { scope, method: 'POST', body: {} })
      .then(({ content }) => {
        setAccessToken(scope, content.data.accessToken);
        return content.data;
      })
      .catch((error) => {
        clearAccessToken(scope);
        throw error;
      })
      .finally(() => { state.refreshPromise = null; });
  }
  return state.refreshPromise;
}

export async function apiRequest(path, options = {}) {
  const { scope = 'seller', allowRefresh = true, responseType = 'json' } = options;
  try {
    const { content } = await rawRequest(path, { ...options, scope, responseType });
    return content;
  } catch (error) {
    if (allowRefresh && error instanceof ApiError && error.status === 401) {
      await refreshSession(scope);
      const { content } = await rawRequest(path, {
        ...options, scope, responseType,
      });
      return content;
    }
    throw error;
  }
}

export async function login(scope, email, password) {
  const path = scope === 'admin' ? '/saas-admin/auth/login' : '/auth/login';
  const { content } = await rawRequest(path, {
    scope, method: 'POST', body: { email, password },
  });
  setAccessToken(scope, content.data.accessToken);
  return content.data;
}

export async function logout(scope) {
  const path = scope === 'admin' ? '/saas-admin/auth/logout' : '/auth/logout';
  try {
    await apiRequest(path, { scope, method: 'POST', body: {}, allowRefresh: false });
  } finally {
    clearAccessToken(scope);
  }
}

export function adminRequest(path, options = {}) {
  return apiRequest(`/saas-admin${path}`, { ...options, scope: 'admin' });
}
