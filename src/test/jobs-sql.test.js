import { jest } from '@jest/globals';

import { iniciarBaseDeDatosJobs } from '../shared/database/jobs-sql.js';

function poolWithConnection(responses) {
  const connection = {
    execute: jest.fn(),
    query: jest.fn().mockResolvedValue([{ affectedRows: 100 }]),
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    destroy: jest.fn(),
  };
  responses.forEach((response) => connection.execute.mockResolvedValueOnce(response));
  return { pool: { getConnection: jest.fn().mockResolvedValue(connection) }, connection };
}

describe('adaptador SQL de jobs', () => {
  test('marca como fallida una ejecución abandonada por caída del worker', async () => {
    const pool = {
      execute: jest.fn()
        .mockResolvedValueOnce([{ affectedRows: 3 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]),
    };

    await expect(iniciarBaseDeDatosJobs(pool).recuperarEjecucionesAbandonadas())
      .resolves.toEqual({ runs: 1, items: 3 });
    expect(pool.execute.mock.calls[0][0]).toContain("error_code = 'WORKER_INTERRUPTED'");
    expect(pool.execute.mock.calls[1][0]).toContain("status = 'FAILED'");
  });

  test('crea sorteo y sus 100 posiciones en una sola transacción', async () => {
    const { pool, connection } = poolWithConnection([
      [[]],
      [[{
        scheduleId: '8', lotteryConfigVersion: 1, modalityConfigVersion: 1,
        scheduleConfigVersion: 1, limitConfigVersion: 1,
      }]],
      [{ insertId: '70' }],
      [{ affectedRows: 1 }],
    ]);
    const db = iniciarBaseDeDatosJobs(pool);
    const result = await db.crearSorteoTransaccional('50', {
      tenantId: '10', scheduleId: '8', businessDate: '2026-09-08', isoWeekday: 2,
      publicId: '01J00000000000000000000000',
      scheduledAtUtc: new Date('2026-09-09T00:00:00Z'),
      closesAtUtc: new Date('2026-09-08T23:50:00Z'),
      lotteryCode: 'NICA', lotteryName: 'Nica', modalityCode: 'NORMAL',
      modalityName: 'Normal', localTime: '18:00:00', closeMinutesBefore: 10,
      multiplier: '80.00', generalNumberLimit: '10000.00', scheduleCode: '1800',
      lotteryConfigVersion: 1, modalityConfigVersion: 1,
      scheduleConfigVersion: 1, limitConfigVersion: 1,
    });

    expect(result).toMatchObject({ created: true, drawId: '70' });
    const positions = connection.query.mock.calls[0][1][0];
    expect(positions).toHaveLength(100);
    expect(positions[0]).toEqual(['70', 0, '10000.00', '10000.00']);
    expect(positions[99]).toEqual(['70', 99, '10000.00', '10000.00']);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('VALUES (?, ?, ?, ?, ?, ?, ?'),
      expect.arrayContaining(['OPEN', '80.00']),
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('persiste PENDING y multiplicador NULL durante la configuración inicial', async () => {
    const { pool, connection } = poolWithConnection([
      [[]],
      [[{
        scheduleId: '8', lotteryConfigVersion: 1, modalityConfigVersion: 1,
        scheduleConfigVersion: 1, limitConfigVersion: 1,
      }]],
      [{ insertId: '71' }],
      [{ affectedRows: 1 }],
    ]);
    await iniciarBaseDeDatosJobs(pool).crearSorteoTransaccional('50', {
      tenantId: '10', scheduleId: '8', businessDate: '2026-09-08', isoWeekday: 2,
      publicId: '01J00000000000000000000001', scheduledAtUtc: new Date(),
      closesAtUtc: new Date(), lotteryCode: 'NICA', lotteryName: 'Nica',
      modalityCode: 'NORMAL', modalityName: 'Normal', localTime: '18:00:00',
      closeMinutesBefore: 10, multiplier: null, generalNumberLimit: '10000.00',
      scheduleCode: '1800', lotteryConfigVersion: 1, modalityConfigVersion: 1,
      scheduleConfigVersion: 1, limitConfigVersion: 1,
    });

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO draws'),
      expect.arrayContaining(['PENDING', null]),
    );
  });

  test('un sorteo existente queda intacto', async () => {
    const { pool, connection } = poolWithConnection([
      [[{ id: '70', publicId: 'existing', status: 'CLOSED' }]],
    ]);
    const result = await iniciarBaseDeDatosJobs(pool).crearSorteoTransaccional('50', {
      tenantId: '10', scheduleId: '8', businessDate: '2026-09-08',
    });
    expect(result).toMatchObject({ exists: true, draw: { status: 'CLOSED' } });
    expect(connection.query).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('advisory lock ocupado no ejecuta la operación', async () => {
    const { pool, connection } = poolWithConnection([[[{ acquired: 0 }]]]);
    const operation = jest.fn();
    await expect(iniciarBaseDeDatosJobs(pool).conAdvisoryLock('lock', operation))
      .resolves.toEqual({ acquired: false });
    expect(operation).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
