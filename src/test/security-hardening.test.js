import express from 'express';
import request from 'supertest';

import { correlationId } from '../shared/middleware/correlation-id.js';
import { claveIdentidad, crearLimiter } from '../shared/middleware/rate-limit.js';

describe('endurecimiento de rate limits', () => {
  test('rechaza el exceso con un contrato público estable', async () => {
    const app = express();
    app.set('trust proxy', false);
    app.use(correlationId);
    app.use(crearLimiter(2, { environment: 'production', windowMs: 60_000 }));
    app.get('/recurso', (_req, res) => res.json({ ok: true }));

    await request(app).get('/recurso').expect(200);
    await request(app).get('/recurso').expect(200);
    const blocked = await request(app).get('/recurso');

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      success: false,
      error: { code: 'RATE_LIMITED' },
    });
    expect(blocked.body.correlationId).toEqual(expect.any(String));
  });

  test('la clave por identidad no conserva el correo legible', () => {
    const req = {
      ip: '127.0.0.1',
      validated: { body: { email: ' Persona@Example.COM ' } },
    };
    const key = claveIdentidad(req);

    expect(key).toMatch(/^identity:[a-f0-9]{64}$/);
    expect(key).not.toContain('persona@example.com');
  });
});
