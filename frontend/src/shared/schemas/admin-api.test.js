import { describe, expect, it } from 'vitest';

import { adminTenantSummarySchema, auditEventSchema } from './admin-api.js';

describe('contratos API administrativos', () => {
  it('acepta un tenant público sin identificadores internos', () => {
    const tenant = adminTenantSummarySchema.parse({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', displayName: 'Negocio Uno', status: 'ACTIVE',
      createdAt: '2026-09-09T12:00:00.000Z', subscriptionStatus: 'TRIAL',
      accessEndsAt: '2026-09-23T12:00:00.000Z', suspensionReason: null,
      planCode: 'MONTHLY_BASE', planName: 'Mensual', ownerEmail: 'owner@example.com', ownerStatus: 'ACTIVE',
    });
    expect(tenant.id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(tenant.tenantId).toBeUndefined();
  });

  it('acepta metadata estructurada en auditoría', () => {
    const event = auditEventSchema.parse({ eventType: 'TENANT_CREATED', actorScope: 'ADMIN', entityType: 'TENANT', correlationId: null, reason: null, metadata: { source: 'panel' }, createdAt: '2026-09-09T12:00:00.000Z', tenantId: null, tenantName: null });
    expect(event.metadata.source).toBe('panel');
  });
});
