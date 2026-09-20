import bcrypt from 'bcrypt';
import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

import { loadConfig } from '../config/environment.js';
import { iniciarAuthController } from '../modules/auth/auth-controller.js';
import * as servicioAuth from '../modules/auth/auth-services.js';
import {
  createAuthTokenManager,
  hashPasswordResetToken,
  hashRefreshToken,
} from '../modules/auth/auth-token.js';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  webSessionSchema,
} from '../schemas/auth-schema.js';
import { AppError } from '../shared/error/app-error.js';
import { iniciarAuthMiddleware } from '../shared/middleware/auth-middleware.js';
import { validar } from '../shared/middleware/joi-schema.js';
import { iniciarMembershipActivaMiddleware } from '../shared/middleware/membership-middleware.js';
import { claveIdentidad } from '../shared/middleware/rate-limit.js';
import { subscriptionAccessMiddleware } from '../shared/middleware/subscription-access-middleware.js';
import { iniciarTrustedOrigin } from '../shared/middleware/trusted-origin.js';

const runtimeConfig = loadConfig({ NODE_ENV: 'test' });

function contexto(overrides = {}) {
  return {
    userId: '1', userPublicId: '01JUSER0000000000000000000',
    email: 'vendedor@example.com', passwordHash: bcrypt.hashSync('clave-segura', 4),
    userStatus: 'ACTIVE', membershipId: '2', membershipStatus: 'ACTIVE', role: 'OWNER',
    tenantId: '3', tenantPublicId: '01JTENANT00000000000000000', tenantName: 'Puesto José',
    tenantStatus: 'ACTIVE', timezone: 'America/Costa_Rica', currencyCode: 'CRC',
    subscriptionStatus: 'ACTIVE', accessEndsAt: '2027-01-01 00:00:00.000000',
    hasAccess: 1, ...overrides,
  };
}

function crearBaseDeDatos(overrides = {}) {
  const current = contexto();
  return {
    buscarContextosPorEmail: jest.fn().mockResolvedValue([current]),
    registrarLoginTransaccional: jest.fn().mockResolvedValue({ contexto: current, sessionId: '10' }),
    refrescarSesionTransaccional: jest.fn().mockResolvedValue({ contexto: current, sessionId: '11' }),
    cerrarSesionTransaccional: jest.fn().mockResolvedValue(),
    obtenerMembershipActual: jest.fn().mockResolvedValue(current),
    buscarSesionActiva: jest.fn().mockResolvedValue({
      id: '10', userId: '1', tenantId: '3', membershipId: '2',
    }),
    buscarUsuarioRecuperacionPorEmail: jest.fn().mockResolvedValue({
      userId: '1', email: 'vendedor@example.com',
    }),
    crearTokenRestablecimientoTransaccional: jest.fn().mockResolvedValue('20'),
    restablecerPasswordTransaccional: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('servicio funcional de autenticación', () => {
  test('inicia sesión y entrega al SQL únicamente el hash del refresh', async () => {
    const baseDeDatos = crearBaseDeDatos();
    const tokens = createAuthTokenManager(runtimeConfig);
    const resultado = await servicioAuth.login(
      baseDeDatos, tokens, 'vendedor@example.com', 'clave-segura', '127.0.0.1', 'Jest',
    );
    expect(resultado.contenido.accessToken).toEqual(expect.any(String));
    expect(resultado.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(baseDeDatos.registrarLoginTransaccional).toHaveBeenCalledWith(
      '2', expect.any(String), expect.objectContaining({
        tokenHash: hashRefreshToken(resultado.refreshToken),
      }),
    );
  });

  test('no revela si el correo no existe', async () => {
    const baseDeDatos = crearBaseDeDatos({
      buscarContextosPorEmail: jest.fn().mockResolvedValue([]),
    });
    await expect(servicioAuth.login(
      baseDeDatos, createAuthTokenManager(runtimeConfig),
      'nadie@example.com', 'clave-segura',
    )).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
  });

  test('permite autenticar una suscripción vencida para mostrar renovación', async () => {
    const vencido = contexto({ hasAccess: 0, subscriptionStatus: 'EXPIRED' });
    const baseDeDatos = crearBaseDeDatos({
      buscarContextosPorEmail: jest.fn().mockResolvedValue([vencido]),
      registrarLoginTransaccional: jest.fn().mockResolvedValue({
        contexto: vencido, sessionId: '10',
      }),
    });
    const resultado = await servicioAuth.login(
      baseDeDatos, createAuthTokenManager(runtimeConfig), vencido.email, 'clave-segura',
    );
    expect(resultado.contenido.subscription.renewalRequired).toBe(true);
    expect(baseDeDatos.registrarLoginTransaccional).toHaveBeenCalled();
  });

  test('rota refresh y conserva el contrato público', async () => {
    const baseDeDatos = crearBaseDeDatos();
    const resultado = await servicioAuth.refrescarToken(
      baseDeDatos, createAuthTokenManager(runtimeConfig), 'A'.repeat(64), '127.0.0.1', 'Jest',
    );
    expect(baseDeDatos.refrescarSesionTransaccional).toHaveBeenCalledWith(
      hashRefreshToken('A'.repeat(64)), expect.objectContaining({ tokenHash: expect.any(Buffer) }),
    );
    expect(resultado.contenido.accessToken).toEqual(expect.any(String));
  });

  test('normaliza los resultados inválido y reutilizado del SQL', async () => {
    const tokens = createAuthTokenManager(runtimeConfig);
    const invalid = crearBaseDeDatos({
      refrescarSesionTransaccional: jest.fn().mockResolvedValue({ invalid: true }),
    });
    await expect(servicioAuth.refrescarToken(invalid, tokens, 'B'.repeat(64)))
      .rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });

    const reused = crearBaseDeDatos({
      refrescarSesionTransaccional: jest.fn().mockResolvedValue({ reused: true }),
    });
    await expect(servicioAuth.refrescarToken(reused, tokens, 'C'.repeat(64)))
      .rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
  });

  test('logout revoca por hash y el perfil se limita al contexto autenticado', async () => {
    const baseDeDatos = crearBaseDeDatos();
    await expect(servicioAuth.logout(baseDeDatos, 'D'.repeat(64)))
      .resolves.toEqual({ loggedOut: true });
    expect(baseDeDatos.cerrarSesionTransaccional).toHaveBeenCalledWith(
      hashRefreshToken('D'.repeat(64)),
    );
    const perfil = servicioAuth.obtenerPerfil(contexto());
    expect(perfil.tenant.name).toBe('Puesto José');
    expect(perfil).not.toHaveProperty('accessToken');
  });

  test('solicita recuperación sin persistir ni devolver el token legible', async () => {
    const baseDeDatos = crearBaseDeDatos();
    const proveedor = { enviarTokenRestablecimiento: jest.fn().mockResolvedValue({}) };
    const resultado = await servicioAuth.solicitarRestablecimiento(
      baseDeDatos,
      createAuthTokenManager(runtimeConfig),
      proveedor,
      'vendedor@example.com',
    );
    const entrega = proveedor.enviarTokenRestablecimiento.mock.calls[0][0];

    expect(resultado.message).toMatch(/Si existe una cuenta/);
    expect(entrega.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(baseDeDatos.crearTokenRestablecimientoTransaccional).toHaveBeenCalledWith(
      '1', hashPasswordResetToken(entrega.token), expect.any(Date),
    );
    expect(JSON.stringify(resultado)).not.toContain(entrega.token);
  });

  test('la solicitud es neutral para correo inexistente y fallo del proveedor', async () => {
    const inexistente = crearBaseDeDatos({
      buscarUsuarioRecuperacionPorEmail: jest.fn().mockResolvedValue(null),
    });
    const proveedor = { enviarTokenRestablecimiento: jest.fn() };
    const desconocido = await servicioAuth.solicitarRestablecimiento(
      inexistente, createAuthTokenManager(runtimeConfig), proveedor, 'nadie@example.com',
    );
    expect(proveedor.enviarTokenRestablecimiento).not.toHaveBeenCalled();

    proveedor.enviarTokenRestablecimiento.mockRejectedValueOnce(new Error('proveedor caído'));
    const conocido = await servicioAuth.solicitarRestablecimiento(
      crearBaseDeDatos(), createAuthTokenManager(runtimeConfig), proveedor, 'vendedor@example.com',
    );
    expect(conocido).toEqual(desconocido);
  });

  test('confirma recuperación con hash seguro y normaliza tokens inválidos', async () => {
    const baseDeDatos = crearBaseDeDatos();
    const token = 'A'.repeat(43);
    await expect(servicioAuth.confirmarRestablecimiento(
      baseDeDatos, token, 'nueva-clave-segura',
    )).resolves.toMatchObject({ message: expect.stringContaining('actualizada') });
    const [, passwordHash] = baseDeDatos.restablecerPasswordTransaccional.mock.calls[0];
    expect(baseDeDatos.restablecerPasswordTransaccional).toHaveBeenCalledWith(
      hashPasswordResetToken(token), expect.any(String),
    );
    await expect(bcrypt.compare('nueva-clave-segura', passwordHash)).resolves.toBe(true);

    baseDeDatos.restablecerPasswordTransaccional.mockResolvedValueOnce(false);
    await expect(servicioAuth.confirmarRestablecimiento(
      baseDeDatos, token, 'otra-clave-segura',
    )).rejects.toMatchObject({ code: 'INVALID_PASSWORD_RESET_TOKEN', statusCode: 400 });
  });

  test('la clave de rate limit normaliza la identidad sin exponer el correo', () => {
    const primera = claveIdentidad({
      ip: '127.0.0.1', validated: { body: { email: 'Vendedor@Example.com' } },
    });
    const segunda = claveIdentidad({
      ip: '203.0.113.8', validated: { body: { email: 'vendedor@example.com' } },
    });
    expect(primera).toBe(segunda);
    expect(primera).not.toContain('vendedor@example.com');
  });
});

function crearAppControlador(servicio, baseDeDatos, tokenManager) {
  const app = express();
  const proveedor = { enviarTokenRestablecimiento: jest.fn().mockResolvedValue({}) };
  const controlador = iniciarAuthController(
    servicio, baseDeDatos, tokenManager, runtimeConfig, proveedor,
  );
  const trustedOrigin = iniciarTrustedOrigin(runtimeConfig.security.corsAllowedOrigins);
  const authMiddleware = iniciarAuthMiddleware(baseDeDatos, tokenManager);
  const membershipActivaMiddleware = iniciarMembershipActivaMiddleware(baseDeDatos);
  app.use(express.json());
  app.post('/auth/login', trustedOrigin, validar(loginSchema), controlador.login);
  app.post('/auth/refresh', trustedOrigin, validar(webSessionSchema), controlador.refresh);
  app.post('/auth/logout', trustedOrigin, validar(webSessionSchema), controlador.logout);
  app.post('/auth/forgot-password', validar(forgotPasswordSchema), controlador.forgotPassword);
  app.post('/auth/reset-password', validar(resetPasswordSchema), controlador.resetPassword);
  app.get('/auth/me', authMiddleware, membershipActivaMiddleware, controlador.getMe);
  app.get('/auth/renewal', authMiddleware, membershipActivaMiddleware, controlador.getRenewal);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({
    error: { code: error.code || 'INTERNAL_ERROR' },
  }));
  return app;
}

describe('controller, cookie y middleware funcional', () => {
  function fixtureHttp() {
    const tokenManager = createAuthTokenManager(runtimeConfig);
    const resultado = {
      contenido: {
        accessToken: tokenManager.issueAccessToken(contexto(), '10'),
        tenant: { name: 'Puesto José' },
      },
      refreshToken: 'R'.repeat(64),
      refreshExpiresAt: new Date('2099-01-01T00:00:00Z'),
    };
    const servicio = {
      login: jest.fn().mockResolvedValue(resultado),
      refrescarToken: jest.fn().mockResolvedValue(resultado),
      logout: jest.fn().mockResolvedValue({ loggedOut: true }),
      obtenerPerfil: jest.fn().mockResolvedValue({ tenant: { name: 'Puesto José' } }),
      obtenerRenovacion: jest.fn().mockImplementation((current) => ({
        subscription: { renewalRequired: Number(current.hasAccess) !== 1 },
      })),
      solicitarRestablecimiento: jest.fn().mockResolvedValue({ message: 'Solicitud recibida.' }),
      confirmarRestablecimiento: jest.fn().mockResolvedValue({ message: 'Contraseña actualizada.' }),
    };
    const baseDeDatos = crearBaseDeDatos();
    return {
      app: crearAppControlador(servicio, baseDeDatos, tokenManager),
      servicio, resultado, baseDeDatos, tokenManager,
    };
  }

  test('login exige origen confiable y nunca expone el refresh en JSON', async () => {
    const { app } = fixtureHttp();
    const bloqueado = await request(app).post('/auth/login').send({
      email: 'vendedor@example.com', password: 'clave-segura',
    });
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.error.code).toBe('UNTRUSTED_ORIGIN');

    const response = await request(app)
      .post('/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'VENDEDOR@example.com', password: 'clave-segura' });
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(JSON.stringify(response.body)).not.toContain('R'.repeat(64));
  });

  test('refresh lee la cookie y limpia una sesión rechazada', async () => {
    const { app, servicio } = fixtureHttp();
    const response = await request(app)
      .post('/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `${runtimeConfig.security.refreshCookieName}=${'A'.repeat(64)}`)
      .send({});
    expect(response.status).toBe(200);
    expect(servicio.refrescarToken).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'A'.repeat(64), expect.any(String), undefined,
    );

    servicio.refrescarToken.mockRejectedValueOnce(new AppError('Inválida', {
      statusCode: 401, code: 'INVALID_REFRESH_TOKEN',
    }));
    const rejected = await request(app)
      .post('/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `${runtimeConfig.security.refreshCookieName}=${'B'.repeat(64)}`)
      .send({});
    expect(rejected.status).toBe(401);
    expect(rejected.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
  });

  test('middleware verifica JWT y sesión MySQL antes de inyectar identidad', async () => {
    const {
      app, resultado, baseDeDatos, servicio,
    } = fixtureHttp();
    const missing = await request(app).get('/auth/me');
    expect(missing.status).toBe(401);

    const profile = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${resultado.contenido.accessToken}`);
    expect(profile.status).toBe(200);
    expect(profile.body.data.tenant.name).toBe('Puesto José');
    expect(baseDeDatos.buscarSesionActiva).toHaveBeenCalledWith('10', '1', '3', '2');
    expect(baseDeDatos.obtenerMembershipActual).toHaveBeenCalledWith('1', '3', '2');
    expect(servicio.obtenerPerfil).toHaveBeenCalledWith(expect.objectContaining({
      userId: '1', tenantId: '3', membershipId: '2', role: 'OWNER',
    }));
  });

  test('rechaza una membership inactiva aunque el JWT y la sesión sean válidos', async () => {
    const { app, resultado, baseDeDatos } = fixtureHttp();
    baseDeDatos.obtenerMembershipActual.mockResolvedValueOnce(
      contexto({ membershipStatus: 'DISABLED' }),
    );
    const response = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${resultado.contenido.accessToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCOUNT_UNAVAILABLE');
  });

  test('expone renovación pero la guarda bloquea módulos operativos al vencer', async () => {
    const { app, resultado, baseDeDatos } = fixtureHttp();
    baseDeDatos.obtenerMembershipActual.mockResolvedValueOnce(contexto({ hasAccess: '0' }));
    const response = await request(app)
      .get('/auth/renewal')
      .set('Authorization', `Bearer ${resultado.contenido.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.subscription.renewalRequired).toBe(true);

    const protectedApp = express();
    protectedApp.get('/operation', (req, _res, next) => {
      req.tenantContext = contexto({ hasAccess: '0' });
      next();
    }, subscriptionAccessMiddleware, (_req, res) => res.json({ ok: true }));
    protectedApp.use((error, _req, res, _next) => res.status(error.statusCode).json({
      error: { code: error.code },
    }));
    const blocked = await request(protectedApp).get('/operation');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('SUBSCRIPTION_RENEWAL_REQUIRED');
  });

  test('no permite sustituir el tenant autenticado mediante URL o claims cruzados', async () => {
    const {
      app, resultado, baseDeDatos, tokenManager,
    } = fixtureHttp();
    const queryInyectado = await request(app)
      .get('/auth/me?tenantId=999')
      .set('Authorization', `Bearer ${resultado.contenido.accessToken}`);
    expect(queryInyectado.status).toBe(200);
    expect(queryInyectado.body.data.tenant.name).toBe('Puesto José');
    expect(baseDeDatos.obtenerMembershipActual).toHaveBeenLastCalledWith('1', '3', '2');

    const tokenCruzado = tokenManager.issueAccessToken(contexto({ tenantId: '999' }), '10');
    baseDeDatos.buscarSesionActiva.mockResolvedValueOnce(null);
    const claimsCruzados = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokenCruzado}`);
    expect(claimsCruzados.status).toBe(401);
    expect(claimsCruzados.body.error.code).toBe('SESSION_INACTIVE');
    expect(baseDeDatos.buscarSesionActiva).toHaveBeenLastCalledWith('10', '1', '999', '2');
  });

  test('expone solicitud y confirmación de recuperación mediante el controller', async () => {
    const { app, servicio } = fixtureHttp();
    const solicitud = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'VENDEDOR@example.com' });
    expect(solicitud.status).toBe(200);
    expect(servicio.solicitarRestablecimiento).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), 'vendedor@example.com',
    );

    const identidadInyectada = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'vendedor@example.com', tenantId: '999', role: 'OWNER' });
    expect(identidadInyectada.status).toBe(400);

    const confirmacion = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'A'.repeat(43), newPassword: 'nueva-clave-segura' });
    expect(confirmacion.status).toBe(200);
    expect(confirmacion.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
    expect(servicio.confirmarRestablecimiento).toHaveBeenCalledWith(
      expect.anything(), 'A'.repeat(43), 'nueva-clave-segura',
    );
  });
});
