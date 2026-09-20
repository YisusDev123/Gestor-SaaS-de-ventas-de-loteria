import { jest } from '@jest/globals';

import { iniciarBaseDeDatosAuth } from '../shared/database/auth-sql.js';

function contextoActivo() {
  return {
    userId: '1', userPublicId: 'U', email: 'vendedor@example.com', passwordHash: 'hash',
    userStatus: 'ACTIVE', membershipId: '2', membershipStatus: 'ACTIVE', role: 'OWNER',
    tenantId: '3', tenantPublicId: 'T', tenantName: 'Puesto', tenantStatus: 'ACTIVE',
    timezone: 'America/Costa_Rica', currencyCode: 'CRC', subscriptionStatus: 'ACTIVE',
    accessEndsAt: '2099-01-01 00:00:00.000000', hasAccess: 1,
  };
}

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

describe('adaptador funcional auth-sql', () => {
  test('resuelve la membership únicamente cuando usuario, tenant e ID coinciden', async () => {
    const current = contextoActivo();
    const pool = { execute: jest.fn().mockResolvedValue([[current]]) };
    const baseDeDatos = iniciarBaseDeDatosAuth(pool);

    await expect(baseDeDatos.obtenerMembershipActual('1', '3', '2')).resolves.toEqual(current);
    expect(pool.execute).toHaveBeenCalledWith(
      expect.stringContaining('WHERE tm.id = ?'), ['2'],
    );

    pool.execute.mockResolvedValueOnce([[current]]);
    await expect(baseDeDatos.obtenerMembershipActual('1', '999', '2')).resolves.toBeNull();
  });

  test('la sesión exige simultáneamente sus cuatro identificadores vinculados', async () => {
    const session = { id: '10', userId: '1', tenantId: '3', membershipId: '2' };
    const pool = { execute: jest.fn().mockResolvedValue([[session]]) };
    const baseDeDatos = iniciarBaseDeDatosAuth(pool);

    await expect(baseDeDatos.buscarSesionActiva('10', '1', '3', '2'))
      .resolves.toEqual(session);
    expect(pool.execute).toHaveBeenCalledWith(
      expect.stringContaining('us.tenant_id = ? AND us.membership_id = ?'),
      ['10', '1', '3', '2'],
    );
  });

  test('no interpreta el string "0" de MySQL como sesión expirada', async () => {
    const current = contextoActivo();
    const { pool, connection } = crearPool([
      [[{
        sessionId: '10', userId: '1', tenantId: '3', membershipId: '2',
        familyId: 'family', revokedAt: null, isExpired: '0',
      }]],
      [[current]],
      [{ insertId: 11 }],
      [{ affectedRows: 1 }],
    ]);
    const baseDeDatos = iniciarBaseDeDatosAuth(pool);
    const resultado = await baseDeDatos.refrescarSesionTransaccional(
      Buffer.alloc(32),
      {
        tokenHash: Buffer.alloc(32, 1), expiresAt: new Date('2099-01-01T00:00:00Z'),
        ipHash: null, userAgent: null,
      },
    );

    expect(resultado).toEqual({ contexto: current, sessionId: '11' });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('un refresh ya revocado confirma la revocación de su familia', async () => {
    const { pool, connection } = crearPool([
      [[{
        sessionId: '10', userId: '1', tenantId: '3', membershipId: '2',
        familyId: 'family', revokedAt: '2026-01-01 00:00:00.000000', isExpired: 0,
      }]],
      [{ affectedRows: 2 }],
    ]);
    const resultado = await iniciarBaseDeDatosAuth(pool).refrescarSesionTransaccional(
      Buffer.alloc(32),
      { tokenHash: Buffer.alloc(32, 1), expiresAt: new Date(), ipHash: null, userAgent: null },
    );
    expect(resultado).toEqual({ reused: true });
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('reemplaza tokens de recuperación anteriores dentro de una transacción', async () => {
    const { pool, connection } = crearPool([
      [[{ id: '1' }]],
      [{ affectedRows: 2 }],
      [{ insertId: 30, affectedRows: 1 }],
    ]);
    const resultado = await iniciarBaseDeDatosAuth(pool)
      .crearTokenRestablecimientoTransaccional(
        '1', Buffer.alloc(32), new Date('2099-01-01T00:00:00Z'),
      );
    expect(resultado).toBe('30');
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('consume el token, actualiza contraseña y revoca sesiones atómicamente', async () => {
    const { pool, connection } = crearPool([
      [[{ userId: '1' }]],
      [[{ id: '1' }]],
      [[{ id: '30' }]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 2 }],
    ]);
    const resultado = await iniciarBaseDeDatosAuth(pool)
      .restablecerPasswordTransaccional(Buffer.alloc(32), 'nuevo-hash');
    expect(resultado).toBe(true);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.execute.mock.calls.at(-1)[0]).toContain('UPDATE user_sessions');
  });

  test('un token de recuperación desconocido no produce escrituras', async () => {
    const { pool, connection } = crearPool([[[]]]);
    const resultado = await iniciarBaseDeDatosAuth(pool)
      .restablecerPasswordTransaccional(Buffer.alloc(32), 'nuevo-hash');
    expect(resultado).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute).toHaveBeenCalledTimes(1);
  });
});
