import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { paginationQuerySchema } from '../schemas/pagination-schema.js';
import {
  businessDateSchema,
  closeMinutesSchema,
  lotteryNumberSchema,
  positiveMoneyAmountSchema,
  requestIdSchema,
} from '../schemas/common-schema.js';
import { businessDateQuerySchema } from '../schemas/tenant-settings-schema.js';
import { globalErrorHandler } from '../shared/error/global-error-handler.js';
import { asyncHandler } from '../shared/middleware/async-handler.js';
import { correlationId } from '../shared/middleware/correlation-id.js';
import { validateRequest } from '../shared/middleware/validate-request.js';
import {
  createCursorCodec, CursorError, parseUtcCursorDate,
} from '../shared/utils/cursor.js';
import {
  createCostaRicaDrawTimes,
  getCostaRicaBusinessDate,
  getIsoWeekday,
} from '../shared/utils/costa-rica-time.js';
import {
  addMoney,
  DecimalValidationError,
  formatMoney,
  multiplyMoneyByMultiplier,
  parseMoney,
  subtractMoney,
} from '../shared/utils/money.js';
import { paginated } from '../shared/utils/http-response.js';
import {
  formatTicketCode,
  generateTicketCode,
  normalizeTicketCode,
} from '../shared/utils/ticket-code.js';

describe('dinero decimal exacto', () => {
  test('convierte strings a unidades BigInt y vuelve al formato canónico', () => {
    expect(parseMoney('1234.5')).toBe(123450n);
    expect(formatMoney(123450n)).toBe('1234.50');
    expect(formatMoney(-5n)).toBe('-0.05');
  });

  test('suma, resta y multiplica sin usar punto flotante', () => {
    expect(addMoney('0.10', '0.20', '3')).toBe('3.30');
    expect(subtractMoney('10.00', '3.25')).toBe('6.75');
    expect(multiplyMoneyByMultiplier('125.00', '80.25')).toBe('10031.25');
    expect(() => multiplyMoneyByMultiplier('125.50', '80.25'))
      .toThrow('exactamente con dos decimales');
  });

  test.each([12, '01.00', '1.234', '-1.00', '99999999999999.00'])(
    'rechaza el monto no canónico %s',
    (value) => expect(() => parseMoney(value)).toThrow(DecimalValidationError),
  );

  test('exige valores positivos cuando la operación lo requiere', () => {
    expect(() => multiplyMoneyByMultiplier('0.00', '10.00')).toThrow('mayor que cero');
    expect(() => formatMoney('100')).toThrow(DecimalValidationError);
  });
});

describe('tiempo oficial de Costa Rica', () => {
  test('obtiene la fecha de negocio sin usar la zona del dispositivo', () => {
    expect(getCostaRicaBusinessDate(new Date('2026-09-08T05:59:59Z'))).toBe('2026-09-07');
    expect(getCostaRicaBusinessDate(new Date('2026-09-08T06:00:00Z'))).toBe('2026-09-08');
  });

  test('calcula sorteo y cierre default de 10 minutos', () => {
    const times = createCostaRicaDrawTimes('2026-09-08', '13:00');
    expect(times.scheduledAtUtc.toISOString()).toBe('2026-09-08T19:00:00.000Z');
    expect(times.closesAtUtc.toISOString()).toBe('2026-09-08T18:50:00.000Z');
    expect(times.closeMinutes).toBe(10);
  });

  test('acepta el extremo de 20 minutos e identifica weekdays ISO', () => {
    const times = createCostaRicaDrawTimes('2026-09-08', '10:00:00', 20);
    expect(times.closesAtUtc.toISOString()).toBe('2026-09-08T15:40:00.000Z');
    expect(getIsoWeekday('2026-09-08')).toBe(2);
    expect(getIsoWeekday('2026-09-13')).toBe(7);
  });

  test.each([
    ['2026-02-30', '10:00', 10],
    ['2026-09-08', '25:00', 10],
    ['2026-09-08', '10:00', 9],
    ['2026-09-08', '10:00', 21],
    ['2026-09-08', '10:00', 10.5],
  ])('rechaza fecha, hora o cierre inválido', (date, time, closeMinutes) => {
    expect(() => createCostaRicaDrawTimes(date, time, closeMinutes)).toThrow(RangeError);
  });
});

describe('código público de ticket', () => {
  test('genera 80 bits como 16 caracteres Crockford Base32', () => {
    expect(generateTicketCode(() => Buffer.alloc(10))).toBe('0000000000000000');
    expect(generateTicketCode(() => Buffer.alloc(10, 255))).toBe('ZZZZZZZZZZZZZZZZ');
  });

  test('formatea y normaliza una entrada humana', () => {
    const canonical = '7K9M2Q4R8X6NP3CW';
    expect(formatTicketCode(canonical)).toBe('T-7K9M-2Q4R-8X6N-P3CW');
    expect(normalizeTicketCode(' t-7k9m-2q4r-8x6n-p3cw ')).toBe(canonical);
    expect(normalizeTicketCode('OOOOIIII11111111')).toBe('0000111111111111');
  });

  test('rechaza códigos y fuentes aleatorias inválidas', () => {
    expect(() => normalizeTicketCode('T-CORTO')).toThrow(/no es válido/);
    expect(() => generateTicketCode(() => Buffer.alloc(9))).toThrow(TypeError);
  });
});

describe('cursores firmados', () => {
  const codec = createCursorCodec('cursor-secret-with-at-least-thirty-two-bytes');

  test('codifica y recupera el cursor', () => {
    const cursor = codec.encode({ createdAt: '2026-09-08T10:00:00.000Z', id: '10' });
    expect(codec.decode(cursor)).toEqual({
      createdAt: '2026-09-08T10:00:00.000Z',
      id: '10',
    });
  });

  test('rechaza alteraciones, formatos y secretos inseguros', () => {
    const cursor = codec.encode({ id: '10' });
    expect(() => codec.decode(`${cursor}x`)).toThrow(CursorError);
    expect(() => codec.decode('invalid')).toThrow(CursorError);
    expect(() => codec.encode(null)).toThrow(CursorError);
    expect(() => createCursorCodec('short')).toThrow(TypeError);
  });

  test('interpreta timestamps MySQL como UTC sin depender de la zona del proceso', () => {
    expect(parseUtcCursorDate('2026-09-08 10:00:00.123456').toISOString())
      .toBe('2026-09-08T10:00:00.123Z');
    const date = new Date('2026-09-08T10:00:00.000Z');
    expect(parseUtcCursorDate(date)).toBe(date);
    expect(() => parseUtcCursorDate('invalid')).toThrow(CursorError);
    expect(() => parseUtcCursorDate(123)).toThrow(CursorError);
    expect(() => parseUtcCursorDate(new Date('invalid'))).toThrow(CursorError);
  });
});

describe('validación y respuesta HTTP compartida', () => {
  function createValidationApp() {
    const app = express();
    app.use(express.json());
    app.use(correlationId);
    app.get(
      '/items',
      validateRequest({ query: paginationQuerySchema }),
      (req, res) => paginated(res, [], {
        limit: req.validated.query.limit,
        nextCursor: null,
      }),
    );
    app.get('/async-error', asyncHandler(async () => {
      throw new Error('private-detail');
    }));
    app.use(globalErrorHandler);
    return app;
  }

  test('convierte limit y devuelve metadata consistente', async () => {
    const response = await request(createValidationApp()).get('/items?limit=10');
    expect(response.status).toBe(200);
    expect(response.body.meta.pagination).toEqual({
      limit: 10,
      nextCursor: null,
      hasMore: false,
    });
  });

  test('rechaza campos desconocidos sin exponer mensajes internos de Joi', async () => {
    const response = await request(createValidationApp()).get('/items?unknown=true&limit=500');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'unknown' }),
      expect.objectContaining({ field: 'limit' }),
    ]));
  });

  test('normaliza rechazos de handlers async', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(createValidationApp()).get('/async-error');
    consoleSpy.mockRestore();

    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error inesperado.',
    });
    expect(JSON.stringify(response.body)).not.toContain('private-detail');
  });
});

describe('schemas Joi comunes', () => {
  test('acepta identificadores y valores canónicos', () => {
    expect(requestIdSchema.validate('d9428888-122b-4b2f-bb05-4b41e093d7b3').error).toBeUndefined();
    expect(positiveMoneyAmountSchema.validate('1500.50').error).toBeUndefined();
    expect(lotteryNumberSchema.validate('00').error).toBeUndefined();
    expect(lotteryNumberSchema.validate('99').error).toBeUndefined();
    expect(businessDateSchema.validate('2026-09-08').error).toBeUndefined();
    expect(businessDateQuerySchema.validate({ businessDate: '2026-09-08' }).value)
      .toEqual({ businessDate: '2026-09-08' });
    expect(closeMinutesSchema.validate(undefined).value).toBe(10);
  });

  test('rechaza formas ambiguas o fuera del dominio', () => {
    expect(requestIdSchema.validate('not-an-id').error).toBeDefined();
    expect(positiveMoneyAmountSchema.validate('0.00').error).toBeDefined();
    expect(positiveMoneyAmountSchema.validate(100).error).toBeDefined();
    expect(lotteryNumberSchema.validate('5').error).toBeDefined();
    expect(lotteryNumberSchema.validate('100').error).toBeDefined();
    expect(businessDateSchema.validate('08/09/2026').error).toBeDefined();
    expect(businessDateSchema.validate('2026-02-30').error).toBeDefined();
    expect(closeMinutesSchema.validate(9).error).toBeDefined();
    expect(closeMinutesSchema.validate(21).error).toBeDefined();
  });
});
