import { jest } from '@jest/globals';

import {
  clearAdminRefreshCookie,
  clearRefreshCookie,
  setAdminRefreshCookie,
  setRefreshCookie,
} from '../shared/utils/session-cookie.js';

function config(environment) {
  return {
    app: { environment },
    security: {
      refreshCookieName: 'seller_refresh',
      adminRefreshCookieName: 'admin_refresh',
    },
  };
}

describe('cookies persistentes de sesión', () => {
  test('producción permite restaurar la sesión desde el frontend HTTPS separado', () => {
    const res = { cookie: jest.fn(), clearCookie: jest.fn() };
    const expiresAt = new Date('2099-01-01T00:00:00.000Z');

    setRefreshCookie(res, 'A'.repeat(64), expiresAt, config('production'));
    setAdminRefreshCookie(res, 'B'.repeat(64), expiresAt, config('production'));

    expect(res.cookie).toHaveBeenNthCalledWith(1, 'seller_refresh', 'A'.repeat(64), {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
      path: '/auth',
      expires: expiresAt,
    });
    expect(res.cookie).toHaveBeenNthCalledWith(2, 'admin_refresh', 'B'.repeat(64), {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
      path: '/saas-admin/auth',
      expires: expiresAt,
    });
  });

  test('entornos locales conservan SameSite Lax sin exigir cookie particionada', () => {
    const res = { cookie: jest.fn(), clearCookie: jest.fn() };
    const runtimeConfig = config('test');

    clearRefreshCookie(res, runtimeConfig);
    clearAdminRefreshCookie(res, runtimeConfig);

    expect(res.clearCookie).toHaveBeenNthCalledWith(1, 'seller_refresh', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      partitioned: false,
      path: '/auth',
    });
    expect(res.clearCookie).toHaveBeenNthCalledWith(2, 'admin_refresh', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      partitioned: false,
      path: '/saas-admin/auth',
    });
  });
});
