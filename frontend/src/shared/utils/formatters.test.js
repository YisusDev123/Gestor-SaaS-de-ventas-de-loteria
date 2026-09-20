import { describe, expect, test } from 'vitest';

import { costaRicaBusinessDate, formatCrc } from './formatters.js';

describe('formatters', () => {
  test('formatea montos sin modificar el valor monetario', () => {
    expect(formatCrc('1250.50')).toContain('1 250,50');
  });

  test('produce una fecha de negocio canónica', () => {
    expect(costaRicaBusinessDate(new Date('2026-09-10T05:30:00.000Z'))).toBe('2026-09-09');
  });
});
