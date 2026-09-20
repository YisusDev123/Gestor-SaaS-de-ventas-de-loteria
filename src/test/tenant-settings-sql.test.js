import { jest } from '@jest/globals';

import { iniciarBaseDeDatosTenantSettings } from '../shared/database/tenant-settings-sql.js';

function mockPool(responses) {
  const connection = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    destroy: jest.fn(),
  };
  responses.forEach((response) => connection.execute.mockResolvedValueOnce(response));
  return { pool: { getConnection: jest.fn().mockResolvedValue(connection) }, connection };
}

describe('adaptador SQL de configuración tenant', () => {
  test('crea una configuración de lotería aislada y auditada', async () => {
    const { pool, connection } = mockPool([
      [[{ id: 'membership-1' }]],
      [[{ id: '7', code: 'NICA', name: 'Nica' }]],
      [[]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    const result = await iniciarBaseDeDatosTenantSettings(pool)
      .actualizarLoteriaTransaccional(
        '10', '20', 'NICA', { isEnabled: true, expectedVersion: 0 }, 'correlation-1',
      );

    expect(result).toEqual({ lotteryCode: 'NICA', isEnabled: true, configVersion: 1 });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tenant_lotteries'), ['10', '7', true],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, 'USER', ?"),
      expect.arrayContaining(['10', '20', 'TENANT_LOTTERY_UPDATED']),
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('rechaza una versión obsoleta y revierte', async () => {
    const { pool, connection } = mockPool([
      [[{ id: 'membership-1' }]],
      [[{ id: '7', code: 'NICA', name: 'Nica' }]],
      [[{ isEnabled: 1, configVersion: '2' }]],
    ]);
    await expect(iniciarBaseDeDatosTenantSettings(pool)
      .actualizarLoteriaTransaccional(
        '10', '20', 'NICA', { isEnabled: false, expectedVersion: 1 }, 'correlation-2',
      )).rejects.toMatchObject({
      statusCode: 409, code: 'CONFIGURATION_VERSION_CONFLICT',
    });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('definir multiplicador abre los sorteos PENDING futuros de la modalidad', async () => {
    const { pool, connection } = mockPool([
      [[{ id: 'membership-1' }]],
      [[{ id: '8', code: 'NORMAL' }]],
      [[{ isEnabled: 1, multiplier: null, configVersion: '1' }]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 2 }],
      [{ affectedRows: 1 }],
    ]);
    const result = await iniciarBaseDeDatosTenantSettings(pool)
      .actualizarModalidadTransaccional(
        '10', '20', { lotteryCode: 'NICA', modalityCode: 'NORMAL' },
        { isEnabled: true, multiplier: '80.00', expectedVersion: 1 }, 'correlation-3',
      );

    expect(result.openedPendingDraws).toBe(2);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("d.status = 'PENDING'"), ['80.00', '10', '8'],
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('toda lectura deriva el tenant autenticado en sus joins', async () => {
    const pool = {
      execute: jest.fn()
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{
          displayName: 'Puesto', timezone: 'America/Costa_Rica', currencyCode: 'CRC',
          receiptFields: {}, businessConfigVersion: 0, generalNumberLimit: null,
          limitConfigVersion: 0,
        }]]),
    };
    await iniciarBaseDeDatosTenantSettings(pool).obtenerCatalogoConfigurado('55');
    expect(pool.execute.mock.calls[0][1]).toEqual(['55', '55', '55']);
    expect(pool.execute.mock.calls[1][1]).toEqual(['55']);
  });
});
