import bcrypt from 'bcrypt';
import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

import { loadConfig } from '../config/environment.js';
import { createAuthTokenManager } from '../modules/auth/auth-token.js';
import { iniciarSaasAdminController } from '../modules/saas-admin/saas-admin-controller.js';
import * as servicio from '../modules/saas-admin/saas-admin-services.js';
import {
  createSaasAdminTokenManager,
  hashAdminRefreshToken,
} from '../modules/saas-admin/saas-admin-token.js';
import { iniciarSaasAdminAuthMiddleware } from '../shared/middleware/saas-admin-auth-middleware.js';

const runtimeConfig = loadConfig({ NODE_ENV: 'test' });

function adminActivo(overrides = {}) {
  return {
    adminId: '1',
    email: 'admin@example.com',
    passwordHash: bcrypt.hashSync('clave-admin-segura', 4),
    status: 'ACTIVE',
    ...overrides,
  };
}

function crearBase(overrides = {}) {
  const admin = adminActivo();
  return {
    buscarAdminPorEmail: jest.fn().mockResolvedValue(admin),
    registrarLoginAdminTransaccional: jest.fn().mockResolvedValue({ admin, sessionId: '10' }),
    refrescarAdminSesionTransaccional: jest.fn().mockResolvedValue({ admin, sessionId: '11' }),
    cerrarAdminSesionTransaccional: jest.fn().mockResolvedValue(),
    buscarSesionAdminActiva: jest.fn().mockResolvedValue({
      id: '10', adminId: '1', email: admin.email,
    }),
    crearTenantTransaccional: jest.fn().mockResolvedValue({
      tenantId: '20', userId: '30', resetTokenId: '40',
      trialEndsAt: '2026-09-11 12:00:00.000000', planCode: 'MONTHLY_BASE',
    }),
    cambiarEstadoTenantTransaccional: jest.fn().mockResolvedValue({
      previousStatus: 'ACTIVE', status: 'SUSPENDED',
    }),
    crearRestablecimientoTenantTransaccional: jest.fn().mockResolvedValue({
      tenantId: '20', userId: '30', email: 'owner@example.com', resetTokenId: '41',
    }),
    actualizarPrecioPlanTransaccional: jest.fn().mockResolvedValue({
      planCode: 'MONTHLY_BASE', previousPrice: '5000.00',
      currentPrice: '5500.00', currencyCode: 'CRC',
    }),
    confirmarPagoSuscripcionTransaccional: jest.fn().mockResolvedValue({
      contenido: { subscription: { status: 'ACTIVE', agreedPrice: '5000.00' } },
      replay: false, tenantId: '20',
    }),
    ...overrides,
  };
}

describe('servicio funcional de administración SaaS', () => {
  test('usa un contexto de token y refresh separado del vendedor', async () => {
    const baseDeDatos = crearBase();
    const adminTokens = createSaasAdminTokenManager(runtimeConfig);
    const resultado = await servicio.login(
      baseDeDatos,
      adminTokens,
      'admin@example.com',
      'clave-admin-segura',
      '127.0.0.1',
      'Jest',
    );
    expect(resultado.contenido.admin.scope).toBe('SAAS_ADMIN');
    expect(baseDeDatos.registrarLoginAdminTransaccional).toHaveBeenCalledWith(
      '1', expect.any(String), expect.objectContaining({
        tokenHash: hashAdminRefreshToken(resultado.refreshToken),
      }),
    );
    expect(() => createAuthTokenManager(runtimeConfig)
      .verifyAccessToken(resultado.contenido.accessToken)).toThrow();
  });

  test('rechaza credenciales desconocidas sin revelar la cuenta', async () => {
    const baseDeDatos = crearBase({ buscarAdminPorEmail: jest.fn().mockResolvedValue(null) });
    await expect(servicio.login(
      baseDeDatos,
      createSaasAdminTokenManager(runtimeConfig),
      'nadie@example.com',
      'clave-admin-segura',
    )).rejects.toMatchObject({ code: 'INVALID_ADMIN_CREDENTIALS', statusCode: 401 });
  });

  test('normaliza refresh inválido y reutilizado', async () => {
    const tokens = createSaasAdminTokenManager(runtimeConfig);
    const invalid = crearBase({
      refrescarAdminSesionTransaccional: jest.fn().mockResolvedValue({ invalid: true }),
    });
    await expect(servicio.refrescarToken(invalid, tokens, 'A'.repeat(64)))
      .rejects.toMatchObject({ code: 'INVALID_ADMIN_REFRESH_TOKEN' });
    const reused = crearBase({
      refrescarAdminSesionTransaccional: jest.fn().mockResolvedValue({ reused: true }),
    });
    await expect(servicio.refrescarToken(reused, tokens, 'B'.repeat(64)))
      .rejects.toMatchObject({ code: 'ADMIN_REFRESH_TOKEN_REUSED' });
  });

  test('crea tenant con prueba y secreto inicial de entrega manual', async () => {
    const baseDeDatos = crearBase();
    const userTokens = createAuthTokenManager(runtimeConfig);
    const proveedor = {
      enviarTokenRestablecimiento: jest.fn().mockResolvedValue({ skipped: true }),
    };
    const resultado = await servicio.crearTenant(
      baseDeDatos,
      userTokens,
      proveedor,
      '1',
      { displayName: 'Puesto Uno', ownerEmail: 'owner@example.com', planCode: 'MONTHLY_BASE' },
      'correlation-1',
    );
    expect(resultado.tenant.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(resultado.owner.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(resultado.subscription.status).toBe('TRIAL');
    expect(resultado.accessSetup).toMatchObject({
      delivery: 'MANUAL', token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    const [, persisted] = baseDeDatos.crearTenantTransaccional.mock.calls[0];
    expect(persisted).not.toHaveProperty('resetToken');
    expect(persisted.resetTokenHash).toEqual(expect.any(Buffer));
    await expect(bcrypt.compare(resultado.accessSetup.token, persisted.unusablePasswordHash))
      .resolves.toBe(false);
  });

  test('oculta el token cuando el proveedor confirma la entrega', async () => {
    const resultado = await servicio.crearTenant(
      crearBase(),
      createAuthTokenManager(runtimeConfig),
      { enviarTokenRestablecimiento: jest.fn().mockResolvedValue({ skipped: false }) },
      '1',
      { displayName: 'Puesto Uno', ownerEmail: 'owner@example.com', planCode: 'MONTHLY_BASE' },
      'correlation-1',
    );
    expect(resultado.accessSetup).toEqual({ delivery: 'EMAIL' });
  });

  test('suspende tenant y genera restablecimiento auditado mediante el SQL', async () => {
    const baseDeDatos = crearBase();
    const tenantId = '01J00000000000000000000000';
    await expect(servicio.cambiarEstadoTenant(
      baseDeDatos,
      '1',
      tenantId,
      { status: 'SUSPENDED', reason: 'Solicitud del cliente' },
      'correlation-2',
    )).resolves.toMatchObject({ tenant: { id: tenantId, status: 'SUSPENDED' } });
    const acceso = await servicio.restablecerAccesoTenant(
      baseDeDatos,
      createAuthTokenManager(runtimeConfig),
      { enviarTokenRestablecimiento: jest.fn().mockResolvedValue({ skipped: true }) },
      '1',
      tenantId,
      'correlation-3',
    );
    expect(acceso.accessSetup.delivery).toBe('MANUAL');
    expect(baseDeDatos.crearRestablecimientoTenantTransaccional).toHaveBeenCalledWith(
      '1', tenantId, expect.any(Buffer), expect.any(Date), 'correlation-3',
    );
  });

  test('normaliza precio y genera fingerprint idempotente para el pago', async () => {
    const baseDeDatos = crearBase();
    await servicio.actualizarPrecioPlan(
      baseDeDatos, '1', 'MONTHLY_BASE', '5500', 'correlation-4',
    );
    expect(baseDeDatos.actualizarPrecioPlanTransaccional).toHaveBeenCalledWith(
      '1', 'MONTHLY_BASE', '5500.00', 'correlation-4',
    );

    const input = {
      requestId: 'ec5b52d5-4c58-4ef9-9e9e-7563bc395f46',
      amount: '5000',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      accessEndsAt: new Date('2026-11-01T00:00:00Z'),
      paidAt: new Date('2026-09-30T12:00:00Z'),
      note: 'Pago manual',
    };
    await servicio.confirmarPagoSuscripcion(
      baseDeDatos,
      '1',
      '01J00000000000000000000000',
      input,
      'correlation-5',
    );
    const [, , persisted] = baseDeDatos.confirmarPagoSuscripcionTransaccional.mock.calls[0];
    expect(persisted.amount).toBe('5000.00');
    expect(persisted.payloadFingerprint).toEqual(expect.any(Buffer));
    expect(persisted.payloadFingerprint).toHaveLength(32);
    expect(persisted).not.toHaveProperty('tenantId');
  });

  test('reactivar solicita recuperación de sorteos del tenant', async () => {
    const baseDeDatos = crearBase();
    const jobsService = {
      generarSorteosParaTenant: jest.fn().mockResolvedValue({
        acquired: true,
        result: { status: 'COMPLETED', created: 0, existing: 0, skipped: 1, incomplete: 1 },
      }),
    };
    baseDeDatos.cambiarEstadoTenantTransaccional.mockResolvedValue({
      tenantId: '20', previousStatus: 'SUSPENDED', status: 'ACTIVE',
    });
    await servicio.cambiarEstadoTenant(
      baseDeDatos, '1', '01J00000000000000000000000',
      { status: 'ACTIVE' }, 'correlation-reactivate', jobsService,
    );
    expect(jobsService.generarSorteosParaTenant).toHaveBeenCalledWith(
      '20', { trigger: 'TENANT_REACTIVATED' },
    );
  });
});

function crearAppHttp() {
  const baseDeDatos = crearBase();
  const adminTokens = createSaasAdminTokenManager(runtimeConfig);
  const userTokens = createAuthTokenManager(runtimeConfig);
  const proveedor = { enviarTokenRestablecimiento: jest.fn().mockResolvedValue({ skipped: true }) };
  const controlador = iniciarSaasAdminController(
    servicio,
    baseDeDatos,
    adminTokens,
    userTokens,
    proveedor,
    runtimeConfig,
  );
  const auth = iniciarSaasAdminAuthMiddleware(baseDeDatos, adminTokens);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.correlationId = 'correlation-http'; next(); });
  app.post('/login', controlador.login);
  app.get('/me', auth, controlador.getMe);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({
    error: { code: error.code || 'INTERNAL_ERROR' },
  }));
  return { app, baseDeDatos, adminTokens };
}

describe('controller y middleware de administración SaaS', () => {
  test('usa cookie administrativa con nombre y path independientes', async () => {
    const { app } = crearAppHttp();
    const response = await request(app).post('/login').send({
      email: 'admin@example.com', password: 'clave-admin-segura',
    });
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie'][0]).toContain('saas_jps_admin_refresh=');
    expect(response.headers['set-cookie'][0]).toContain('Path=/saas-admin/auth');
  });

  test('inyecta identidad administrativa sólo desde una sesión vigente', async () => {
    const { app, baseDeDatos, adminTokens } = crearAppHttp();
    const token = adminTokens.issueAccessToken('1', '10');
    const response = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.admin).toEqual({
      email: 'admin@example.com', scope: 'SAAS_ADMIN',
    });
    expect(baseDeDatos.buscarSesionAdminActiva).toHaveBeenCalledWith('10', '1');

    baseDeDatos.buscarSesionAdminActiva.mockResolvedValueOnce(null);
    const revoked = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe('ADMIN_SESSION_INACTIVE');
  });
});
