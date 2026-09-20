import { AppError } from '../error/app-error.js';

function cookieOptions(runtimeConfig, path) {
  const crossSiteProduction = runtimeConfig.app.environment === 'production';
  return {
    httpOnly: true,
    secure: crossSiteProduction,
    sameSite: crossSiteProduction ? 'none' : 'lax',
    partitioned: crossSiteProduction,
    path,
  };
}

function setSessionCookie(res, name, path, token, expiresAt, runtimeConfig) {
  res.cookie(name, token, {
    ...cookieOptions(runtimeConfig, path),
    expires: expiresAt,
  });
}

function clearSessionCookie(res, name, path, runtimeConfig) {
  res.clearCookie(name, cookieOptions(runtimeConfig, path));
}

function readSessionCookie(req, name, errorCode) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = decodeURIComponent(part.slice(separator + 1));
    if (/^[A-Za-z0-9_-]{64}$/.test(value)) return value;
  }
  throw new AppError('Falta una sesión de renovación válida.', {
    statusCode: 401,
    code: errorCode,
  });
}

export function setRefreshCookie(res, token, expiresAt, runtimeConfig) {
  setSessionCookie(
    res, runtimeConfig.security.refreshCookieName, '/auth', token, expiresAt, runtimeConfig,
  );
}

export function clearRefreshCookie(res, runtimeConfig) {
  clearSessionCookie(res, runtimeConfig.security.refreshCookieName, '/auth', runtimeConfig);
}

export function readRefreshCookie(req, runtimeConfig) {
  return readSessionCookie(
    req, runtimeConfig.security.refreshCookieName, 'REFRESH_TOKEN_REQUIRED',
  );
}

export function setAdminRefreshCookie(res, token, expiresAt, runtimeConfig) {
  setSessionCookie(
    res,
    runtimeConfig.security.adminRefreshCookieName,
    '/saas-admin/auth',
    token,
    expiresAt,
    runtimeConfig,
  );
}

export function clearAdminRefreshCookie(res, runtimeConfig) {
  clearSessionCookie(
    res,
    runtimeConfig.security.adminRefreshCookieName,
    '/saas-admin/auth',
    runtimeConfig,
  );
}

export function readAdminRefreshCookie(req, runtimeConfig) {
  return readSessionCookie(
    req,
    runtimeConfig.security.adminRefreshCookieName,
    'ADMIN_REFRESH_TOKEN_REQUIRED',
  );
}
