import { jest } from '@jest/globals';

import { createMySqlRateLimitStore } from '../shared/middleware/mysql-rate-limit-store.js';

describe('store MySQL de rate limiting', () => {
  test('incrementa el bucket y calcula el reinicio desde la ventana persistida', async () => {
    const windowStartedAt = '2026-09-12T12:00:00.000Z';
    const pool = {
      execute: jest.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ windowStartedAt, totalHits: '3' }]]),
    };
    const store = createMySqlRateLimitStore(pool, 'login', 60_000);

    await expect(store.init()).resolves.toBeUndefined();
    await expect(store.increment('ip:127.0.0.1')).resolves.toEqual({
      totalHits: 3,
      resetTime: new Date('2026-09-12T12:01:00.000Z'),
    });

    expect(pool.execute).toHaveBeenCalledTimes(2);
    expect(pool.execute.mock.calls[0][1][0]).toBe('login:ip:127.0.0.1');
    expect(pool.execute.mock.calls[0][1][1]).toBeInstanceOf(Date);
    expect(pool.execute.mock.calls[0][1][2]).toBeInstanceOf(Date);
    expect(pool.execute.mock.calls[1][1]).toEqual(['login:ip:127.0.0.1']);
  });

  test('devuelve valores seguros si el bucket no aparece después del incremento', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const pool = {
      execute: jest.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[]]),
    };
    const store = createMySqlRateLimitStore(pool, 'session', 30_000);

    await expect(store.increment('key')).resolves.toEqual({
      totalHits: 0,
      resetTime: new Date(1_800_000_030_000),
    });
    now.mockRestore();
  });

  test('decrementa y limpia únicamente buckets del prefijo configurado', async () => {
    const pool = { execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) };
    const store = createMySqlRateLimitStore(pool, 'admin', 60_000);

    await store.decrement('actor');
    await store.resetKey('actor');
    await store.resetAll();

    expect(pool.execute.mock.calls.map((call) => call[1])).toEqual([
      ['admin:actor'],
      ['admin:actor'],
      ['admin:%'],
    ]);
    expect(pool.execute.mock.calls[0][0]).toContain('GREATEST(hit_count - 1, 0)');
    expect(pool.execute.mock.calls[1][0]).toContain('bucket_key = ?');
    expect(pool.execute.mock.calls[2][0]).toContain('bucket_key LIKE ?');
  });
});
