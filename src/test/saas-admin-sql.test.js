import { jest } from '@jest/globals';

import { iniciarBaseDeDatosSaasAdmin } from '../shared/database/saas-admin-sql.js';

function crearPool(respuestas) {
  const connection = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    destroy: jest.fn(),
  };
  respuestas.forEach((respuesta) => connection.execute.mockResolvedValueOnce(respuesta));
  return {
    pool: {
      getConnection: jest.fn().mockResolvedValue(connection),
      execute: jest.fn(),
    },
    connection,
  };
}

const admin = {
  adminId: '1', email: 'admin@example.com', passwordHash: 'hash', status: 'ACTIVE',
};

describe('adaptador funcional saas-admin-sql', () => {
  test('registra login administrativo con hash y transacción', async () => {
    const { pool, connection } = crearPool([
      [[admin]],
      [{ insertId: 10, affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    const resultado = await iniciarBaseDeDatosSaasAdmin(pool)
      .registrarLoginAdminTransaccional('1', 'hash', {
        tokenHash: Buffer.alloc(32), familyId: 'family', expiresAt: new Date(),
        ipHash: null, userAgent: null,
      });
    expect(resultado).toEqual({ admin, sessionId: '10' });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('rota refresh administrativo y enlaza la sesión anterior', async () => {
    const { pool, connection } = crearPool([
      [[{
        sessionId: '10', adminId: '1', familyId: 'family', revokedAt: null,
        isExpired: '0', email: 'admin@example.com', status: 'ACTIVE',
      }]],
      [{ insertId: 11, affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    const resultado = await iniciarBaseDeDatosSaasAdmin(pool)
      .refrescarAdminSesionTransaccional(Buffer.alloc(32), {
        tokenHash: Buffer.alloc(32, 1), expiresAt: new Date(), ipHash: null, userAgent: null,
      });
    expect(resultado).toEqual({
      admin: { adminId: '1', email: 'admin@example.com' }, sessionId: '11',
    });
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('detecta reutilización y revoca la familia administrativa', async () => {
    const { pool, connection } = crearPool([
      [[{
        sessionId: '10', adminId: '1', familyId: 'family',
        revokedAt: '2026-01-01', isExpired: 0, status: 'ACTIVE',
      }]],
      [{ affectedRows: 2 }],
    ]);
    await expect(iniciarBaseDeDatosSaasAdmin(pool)
      .refrescarAdminSesionTransaccional(Buffer.alloc(32), {}))
      .resolves.toEqual({ reused: true });
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('crea tenant, propietario, prueba, token y auditoría atómicamente', async () => {
    const { pool, connection } = crearPool([
      [[admin]],
      [[{ id: '2', code: 'MONTHLY_BASE', trialDays: 3 }]],
      [[{ startsAt: '2026-09-08', endsAt: '2026-09-11' }]],
      [{ insertId: 20, affectedRows: 1 }],
      [{ insertId: 30, affectedRows: 1 }],
      [{ insertId: 31, affectedRows: 1 }],
      [{ affectedRows: 3 }],
      [{ affectedRows: 4 }],
      [{ affectedRows: 12 }],
      [{ affectedRows: 1 }],
      [{ insertId: 40, affectedRows: 1 }],
      [{ insertId: 41, affectedRows: 1 }],
      [{ insertId: 50, affectedRows: 1 }],
      [{ insertId: 60, affectedRows: 1 }],
    ]);
    const resultado = await iniciarBaseDeDatosSaasAdmin(pool).crearTenantTransaccional('1', {
      planCode: 'MONTHLY_BASE',
      tenantPublicId: '01J00000000000000000000000',
      userPublicId: '01J00000000000000000000001',
      displayName: 'Puesto Uno',
      ownerEmail: 'owner@example.com',
      unusablePasswordHash: 'hash-inutilizable',
      resetTokenHash: Buffer.alloc(32),
      resetExpiresAt: new Date(),
      correlationId: 'correlation-1',
    });
    expect(resultado).toEqual({
      tenantId: '20', userId: '30', resetTokenId: '50',
      trialEndsAt: '2026-09-11', planCode: 'MONTHLY_BASE',
    });
    expect(connection.execute.mock.calls.at(-1)[0]).toContain('INSERT INTO audit_events');
    expect(connection.execute.mock.calls.some(([sql]) => (
      sql.includes('INSERT INTO tenant_limit_settings')
        && sql.includes("'10000.00'")
    ))).toBe(true);
    expect(connection.execute.mock.calls.some(([sql]) => (
      sql.includes('INSERT INTO tenant_modalities') && sql.includes('TRUE, NULL')
    ))).toBe(true);
    const auditParams = connection.execute.mock.calls.at(-1)[1];
    expect(auditParams.join(' ')).not.toContain('hash-inutilizable');
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('suspende tenant, suscripción y sesiones con auditoría', async () => {
    const { pool, connection } = crearPool([
      [[admin]],
      [[{ tenantId: '20', tenantStatus: 'ACTIVE' }]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 2 }],
      [{ insertId: 60 }],
    ]);
    const resultado = await iniciarBaseDeDatosSaasAdmin(pool)
      .cambiarEstadoTenantTransaccional(
        '1', '01J00000000000000000000000', 'SUSPENDED', 'Falta de pago', 'correlation-2',
      );
    expect(resultado).toEqual({
      tenantId: '20', previousStatus: 'ACTIVE', status: 'SUSPENDED',
    });
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('UPDATE user_sessions')))
      .toBe(true);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('impide reactivar un tenant cerrado', async () => {
    const { pool, connection } = crearPool([
      [[admin]],
      [[{ tenantId: '20', tenantStatus: 'CLOSED' }]],
    ]);
    await expect(iniciarBaseDeDatosSaasAdmin(pool).cambiarEstadoTenantTransaccional(
      '1', '01J00000000000000000000000', 'ACTIVE', null, 'correlation-3',
    )).rejects.toMatchObject({ code: 'TENANT_CLOSED', statusCode: 409 });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('restablece acceso, consume tokens y revoca sesiones con auditoría', async () => {
    const { pool, connection } = crearPool([
      [[admin]],
      [[{ tenantId: '20', userId: '30', email: 'owner@example.com' }]],
      [{ affectedRows: 1 }],
      [{ insertId: 50, affectedRows: 1 }],
      [{ affectedRows: 2 }],
      [{ insertId: 60 }],
    ]);
    const resultado = await iniciarBaseDeDatosSaasAdmin(pool)
      .crearRestablecimientoTenantTransaccional(
        '1', '01J00000000000000000000000', Buffer.alloc(32), new Date(), 'correlation-4',
      );
    expect(resultado).toEqual({
      tenantId: '20', userId: '30', email: 'owner@example.com', resetTokenId: '50',
    });
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('actualiza sólo el precio futuro del plan y conserva auditoría', async () => {
    const { pool, connection } = crearPool([
      [[admin]],
      [[{ id: '2', currentPrice: '5000.00' }]],
      [{ affectedRows: 1 }],
      [{ insertId: 60 }],
    ]);
    const resultado = await iniciarBaseDeDatosSaasAdmin(pool)
      .actualizarPrecioPlanTransaccional('1', 'MONTHLY_BASE', '5500.00', 'correlation-5');
    expect(resultado).toEqual({
      planCode: 'MONTHLY_BASE', previousPrice: '5000.00',
      currentPrice: '5500.00', currencyCode: 'CRC',
    });
    expect(connection.execute.mock.calls[2][0]).toContain('UPDATE subscription_plans');
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('subscription_periods')))
      .toBe(false);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('confirma pago idempotente sin escribir en la caja del vendedor', async () => {
    const { pool, connection } = crearPool([
      [[admin]],
      [[]],
      [[{
        tenantId: '20', tenantStatus: 'SUSPENDED', subscriptionId: '40',
        planId: '2', planCode: 'MONTHLY_BASE',
      }]],
      [{ insertId: 70, affectedRows: 1 }],
      [{ insertId: 71, affectedRows: 1 }],
      [{ insertId: 72, affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ insertId: 73 }],
      [{ affectedRows: 1 }],
    ]);
    const data = {
      requestId: 'ec5b52d5-4c58-4ef9-9e9e-7563bc395f46',
      payloadFingerprint: Buffer.alloc(32, 1),
      amount: '5000.00',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      accessEndsAt: new Date('2026-11-01T00:00:00Z'),
      paidAt: new Date('2026-09-30T12:00:00Z'),
      note: 'Pago manual',
      correlationId: 'correlation-6',
    };
    const resultado = await iniciarBaseDeDatosSaasAdmin(pool)
      .confirmarPagoSuscripcionTransaccional(
        '1', '01J00000000000000000000000', data,
      );
    expect(resultado.replay).toBe(false);
    expect(resultado.contenido.subscription).toMatchObject({
      status: 'ACTIVE', agreedPrice: '5000.00', currencyCode: 'CRC',
    });
    const allSql = connection.execute.mock.calls.map(([sql]) => sql).join('\n');
    expect(allSql).toContain('INSERT INTO subscription_payments');
    expect(allSql).toContain('UPDATE operation_requests');
    expect(allSql).not.toContain('cash_accounts');
    expect(allSql).not.toContain('cash_movements');
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('repite la respuesta guardada para el mismo requestId y fingerprint', async () => {
    const contenido = { subscription: { status: 'ACTIVE', agreedPrice: '5000.00' } };
    const fingerprint = Buffer.alloc(32, 1);
    const { pool, connection } = crearPool([
      [[admin]],
      [[{
        id: '70', payloadFingerprint: fingerprint,
        status: 'COMPLETED', response: JSON.stringify(contenido),
      }]],
    ]);
    const resultado = await iniciarBaseDeDatosSaasAdmin(pool)
      .confirmarPagoSuscripcionTransaccional(
        '1',
        '01J00000000000000000000000',
        { requestId: 'request', payloadFingerprint: fingerprint },
      );
    expect(resultado).toEqual({ contenido, replay: true, tenantId: null });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('rechaza reutilizar requestId de pago con payload diferente', async () => {
    const { pool, connection } = crearPool([
      [[admin]],
      [[{
        id: '70', payloadFingerprint: Buffer.alloc(32, 1),
        status: 'COMPLETED', response: {},
      }]],
    ]);
    await expect(iniciarBaseDeDatosSaasAdmin(pool)
      .confirmarPagoSuscripcionTransaccional(
        '1',
        '01J00000000000000000000000',
        { requestId: 'request', payloadFingerprint: Buffer.alloc(32, 2) },
      )).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', statusCode: 409 });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});
