import { jest } from '@jest/globals';

import * as service from '../modules/saas-admin/saas-admin-services.js';
import { listAuditEventsQuerySchema, listTenantsQuerySchema } from '../schemas/saas-admin-schema.js';
import { iniciarBaseDeDatosSaasAdmin } from '../shared/database/saas-admin-sql.js';

const secret = 'cursor-administrativo-de-prueba-con-longitud-suficiente';

describe('lecturas administrativas SaaS', () => {
  test('pagina tenants con cursor opaco y no publica el ID interno', async () => {
    const database = { listarTenants: jest.fn().mockResolvedValue([
      { cursorId: '3', id: '01J00000000000000000000003', displayName: 'Tres' },
      { cursorId: '2', id: '01J00000000000000000000002', displayName: 'Dos' },
      { cursorId: '1', id: '01J00000000000000000000001', displayName: 'Uno' },
    ]) };
    const result = await service.listarTenants(database, secret, { limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).not.toHaveProperty('cursorId');
    expect(result.nextCursor).toEqual(expect.any(String));

    await service.listarTenants(database, secret, { limit: 2, cursor: result.nextCursor });
    expect(database.listarTenants.mock.calls[1][1]).toEqual({ id: '2' });
  });

  test('rechaza un cursor administrativo manipulado', async () => {
    await expect(service.listarAuditoria(
      { listarAuditoria: jest.fn() }, secret, { limit: 25, cursor: 'alterado' },
    )).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
  });

  test('devuelve 404 seguro cuando el tenant no existe', async () => {
    await expect(service.obtenerTenant(
      { obtenerTenant: jest.fn().mockResolvedValue(null) }, '01J00000000000000000000000',
    )).rejects.toMatchObject({ statusCode: 404, code: 'TENANT_NOT_FOUND' });
  });

  test('valida filtros de tenants y auditoría sin campos desconocidos', () => {
    expect(listTenantsQuerySchema.validate({ status: 'ACTIVE', search: 'Puesto', limit: 20 }).error).toBeUndefined();
    expect(listAuditEventsQuerySchema.validate({ actorScope: 'ADMIN', eventType: 'TENANT_CREATED' }).error).toBeUndefined();
    expect(listTenantsQuerySchema.validate({ passwordHash: 'secreto' }).error).toBeDefined();
  });

  test('SQL parametriza búsqueda y limita el resultado administrativo', async () => {
    const pool = { execute: jest.fn().mockResolvedValue([[{
      cursorId: '1', id: '01J00000000000000000000000', displayName: 'Puesto',
    }]]) };
    const database = iniciarBaseDeDatosSaasAdmin(pool);
    const rows = await database.listarTenants({ search: 'Puesto' }, null, 26);
    expect(rows[0].id).toBe('01J00000000000000000000000');
    expect(pool.execute.mock.calls[0][0]).toContain('t.display_name LIKE ?');
    expect(pool.execute.mock.calls[0][1]).toEqual(['PUESTO', 'puesto', 'Puesto%', 26]);
  });

  test('detalle administrativo separa el ID interno de la respuesta pública', async () => {
    const pool = { execute: jest.fn()
      .mockResolvedValueOnce([[{
        internalTenantId: '7', id: '01J00000000000000000000000', displayName: 'Puesto',
        status: 'ACTIVE', timezone: 'America/Costa_Rica', currencyCode: 'CRC',
        ownerId: '01J00000000000000000000001', ownerEmail: 'owner@example.com',
        ownerStatus: 'ACTIVE', membershipStatus: 'ACTIVE', subscriptionStatus: 'TRIAL',
        planCode: 'MONTHLY_BASE', planName: 'Mensual', currentPlanPrice: '5000.00',
        planCurrencyCode: 'CRC',
      }]])
      .mockResolvedValueOnce([[]]) };
    const result = await iniciarBaseDeDatosSaasAdmin(pool).obtenerTenant('01J00000000000000000000000');
    expect(result).not.toHaveProperty('internalTenantId');
    expect(result.owner.email).toBe('owner@example.com');
    expect(pool.execute.mock.calls[1][1]).toEqual(['7']);
  });
});
