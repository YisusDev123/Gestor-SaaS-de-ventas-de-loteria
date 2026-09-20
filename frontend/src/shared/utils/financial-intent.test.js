import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { prepareFinancialIntent, resolveFinancialIntent } from './financial-intent.js';

describe('intenciones financieras del cliente', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  test('reutiliza el requestId cuando el payload no cambió', async () => {
    const payload = { drawPublicId: 'DRAW-1', items: [{ number: '07', amount: '100.00' }] };
    const first = await prepareFinancialIntent('create-ticket', payload);
    const replay = await prepareFinancialIntent('create-ticket', payload);
    expect(replay).toBe(first);
  });

  test('genera una intención nueva al cambiar el payload y la elimina al resolver', async () => {
    const first = await prepareFinancialIntent('create-ticket', { amount: '100.00' });
    const changed = await prepareFinancialIntent('create-ticket', { amount: '200.00' });
    expect(changed).not.toBe(first);
    resolveFinancialIntent('create-ticket');
    expect(sessionStorage.getItem('pending-intent:create-ticket')).toBeNull();
  });

  test('sessionStorage conserva sólo metadata, no el payload financiero', async () => {
    await prepareFinancialIntent('create-ticket', { privateAmount: '999.00' });
    const persisted = sessionStorage.getItem('pending-intent:create-ticket');
    expect(persisted).not.toContain('999.00');
    expect(JSON.parse(persisted)).toEqual({
      requestId: expect.any(String), fingerprint: expect.any(String), createdAt: expect.any(String),
    });
  });

  test('conserva la idempotencia cuando el navegador no ofrece Web Crypto', async () => {
    vi.stubGlobal('crypto', undefined);
    const payload = { drawPublicId: 'DRAW-1', winningNumber: '07' };

    const first = await prepareFinancialIntent('publish-result', payload);
    const replay = await prepareFinancialIntent('publish-result', payload);
    const stored = JSON.parse(sessionStorage.getItem('pending-intent:publish-result'));

    expect(replay).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stored.fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });
});
