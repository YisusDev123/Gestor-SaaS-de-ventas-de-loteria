import { z } from 'zod';

const money = z.string().regex(/^-?\d+(?:\.\d{1,2})?$/);
const drawIdentity = z.object({ code: z.string(), name: z.string() });

export const cashStateSchema = z.object({
  initialized: z.boolean(),
  balance: money,
  initializedAt: z.string().nullable(),
  reconciliation: z.object({ ledgerBalance: money, isBalanced: z.boolean() }),
});

export const dashboardSchema = z.object({
  businessDate: z.string(),
  sales: z.object({ grossAmount: money, cancelledAmount: money, netAmount: money, ticketCount: z.number() }),
  cash: z.object({ openingBalance: money, currentBalance: money, ledgerBalance: money, isBalanced: z.boolean() }),
  exposure: z.object({ openAmount: money }),
  prizes: z.object({ generatedAmount: money, paidAmount: money, pendingAmount: money, pendingCount: z.number() }),
  operation: z.object({ expensesAmount: money, cashEntriesAmount: money, cashWithdrawalsAmount: money, adjustmentCreditsAmount: money, adjustmentDebitsAmount: money, adjustmentsNetAmount: money }),
  result: z.object({ provisionalAmount: money, realizedAmount: money }),
  upcomingDraws: z.array(z.object({ drawPublicId: z.string(), lotteryName: z.string(), modalityName: z.string(), closesAt: z.string() }).passthrough()),
  alerts: z.array(z.object({ code: z.string() }).passthrough()),
});

const saleDraw = z.object({
  drawPublicId: z.string(), businessDate: z.string(), scheduledAt: z.string(), closesAt: z.string(),
  status: z.string(), lottery: drawIdentity, modality: drawIdentity, multiplier: money,
  totalSoldAmount: money, validTicketCount: z.number(),
});

export const saleDrawsSchema = z.object({
  businessDate: z.string(), draws: z.array(saleDraw), warnings: z.array(z.object({ code: z.string() }).passthrough()),
});

export const saleMatrixSchema = z.object({
  draw: saleDraw,
  numbers: z.array(z.object({ number: z.string(), effectiveLimit: money, soldAmount: money, remainingAmount: money, validTicketCount: z.number() })),
});

export const saleCreationSchema = z.object({
  ticket: z.object({ ticketCode: z.string(), totalAmount: money }).passthrough(),
  replay: z.boolean(),
}).passthrough();

export const receiptSchema = z.object({
  sellerName: z.string(), ticketCode: z.string(), status: z.string(), issuedAt: z.string(),
  timezone: z.string(), currencyCode: z.string(),
  draw: z.object({ publicId: z.string(), businessDate: z.string(), scheduledAt: z.string(), lotteryName: z.string(), modalityName: z.string() }),
  items: z.array(z.object({ number: z.string(), amount: money, multiplier: money, potentialPrizeAmount: money }).passthrough()),
  totalAmount: money,
  prize: z.object({ status: z.string(), winningNumber: z.string().nullable(), isWinner: z.boolean().nullable(), amount: money.nullable(), paidAt: z.string().nullable() }),
  informationalFields: z.record(z.string(), z.string()),
  printLayouts: z.array(z.enum(['58mm', '80mm', 'letter'])),
});

export const prizeSchema = z.object({
  ticketCode: z.string(), ticketStatus: z.string(), ticketTotal: money,
  drawPublicId: z.string(), drawStatus: z.string(), lotteryName: z.string(), modalityName: z.string(),
  winningNumber: z.string().nullable(), isWinner: z.boolean().nullable(), prizeAmount: money,
  paymentId: z.string().nullable(), paidAt: z.string().nullable(), prizeStatus: z.string(),
});
