import { z } from 'zod';

const nullableDate = z.string().nullable();

export const adminTenantSummarySchema = z.object({
  id: z.string(), displayName: z.string(), status: z.string(), createdAt: z.string(),
  subscriptionStatus: z.string(), accessEndsAt: z.string(), suspensionReason: z.string().nullable(),
  planCode: z.string(), planName: z.string(), ownerEmail: z.email().nullable(), ownerStatus: z.string().nullable(),
});

export const adminTenantDetailSchema = z.object({
  id: z.string(), displayName: z.string(), status: z.string(), timezone: z.string(), currencyCode: z.string(), createdAt: z.string(),
  owner: z.object({ id: z.string(), email: z.email(), status: z.string(), membershipStatus: z.string() }).nullable(),
  subscription: z.object({
    status: z.string(), trialStartedAt: nullableDate, trialEndsAt: nullableDate,
    accessEndsAt: z.string(), suspensionReason: z.string().nullable(),
    plan: z.object({ code: z.string(), name: z.string(), currentPrice: z.string(), currencyCode: z.string() }),
    periods: z.array(z.object({ type: z.string(), startsAt: z.string(), endsAt: z.string(), agreedPrice: z.string(), currencyCode: z.string(), status: z.string(), paidAmount: z.string().nullable(), paidAt: nullableDate, note: z.string().nullable() })),
  }),
});

export const adminPlanSchema = z.object({
  code: z.string(), name: z.string(), currentPrice: z.string(), currencyCode: z.string(),
  trialDays: z.number(), isActive: z.boolean(), updatedAt: z.string(),
});

export const auditEventSchema = z.object({
  eventType: z.string(), actorScope: z.string(), entityType: z.string(),
  correlationId: z.string().nullable(), reason: z.string().nullable(), metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(), tenantId: z.string().nullable(), tenantName: z.string().nullable(),
});
