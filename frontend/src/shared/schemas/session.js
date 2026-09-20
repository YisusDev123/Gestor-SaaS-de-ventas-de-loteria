import { z } from 'zod';

const tokenFields = {
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().positive(),
};

export const sellerSessionSchema = z.object({
  ...tokenFields,
  user: z.object({ id: z.string(), email: z.email() }),
  tenant: z.object({
    id: z.string(),
    name: z.string().min(1),
    timezone: z.string(),
    currencyCode: z.string(),
  }),
  role: z.enum(['OWNER', 'MANAGER', 'SELLER']),
  subscription: z.object({
    status: z.string(),
    accessEndsAt: z.union([z.string(), z.date(), z.null()]),
    renewalRequired: z.boolean(),
  }),
});

export const adminSessionSchema = z.object({
  ...tokenFields,
  admin: z.object({ email: z.email(), scope: z.literal('SAAS_ADMIN') }),
});
