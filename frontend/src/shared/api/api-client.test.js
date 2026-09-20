import { describe, expect, test } from 'vitest';

import { resolveApiBaseUrl } from './api-client.js';

describe('resolución de la URL de la API', () => {
  test('usa el mismo hostname del frontend para conservar la cookie local', () => {
    expect(resolveApiBaseUrl(undefined, {
      protocol: 'http:',
      hostname: '127.0.0.1',
    })).toBe('http://127.0.0.1:2000');

    expect(resolveApiBaseUrl(undefined, {
      protocol: 'http:',
      hostname: 'localhost',
    })).toBe('http://localhost:2000');
  });

  test('respeta la URL configurada para staging o producción', () => {
    expect(resolveApiBaseUrl('https://api.example.test/')).toBe('https://api.example.test');
  });
});
