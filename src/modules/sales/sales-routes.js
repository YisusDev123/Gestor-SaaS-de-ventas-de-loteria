import { Router } from 'express';

import { salesContainer } from '../../container/sales-container.js';
import {
  cancelTicketSchema, correctTicketSchema, createTicketSchema, drawParamsSchema,
  numberParamsSchema, receiptPdfQuerySchema, salesDrawsQuerySchema, salesListQuerySchema,
  ticketCodeParamsSchema, ticketHistoryQuerySchema, updateNumberLimitSchema,
} from '../../schemas/sales-schema.js';
import { validar } from '../../shared/middleware/joi-schema.js';

const {
  controladorSales, authMiddleware, membershipActivaMiddleware,
  subscriptionAccessMiddleware, salesRoleMiddleware, limitRoleMiddleware, readRoleMiddleware,
} = salesContainer;
const router = Router();

router.use(authMiddleware, membershipActivaMiddleware, subscriptionAccessMiddleware);
router.get('/draws', readRoleMiddleware, validar(salesDrawsQuerySchema, 'query'), controladorSales.listSaleDraws);
router.get('/draws/:drawPublicId/numbers', readRoleMiddleware, validar(drawParamsSchema, 'params'), controladorSales.getMatrix);
router.patch('/draws/:drawPublicId/numbers/:number', limitRoleMiddleware, validar(numberParamsSchema, 'params'), validar(updateNumberLimitSchema), controladorSales.updateLimit);
router.post('/tickets', salesRoleMiddleware, validar(createTicketSchema), controladorSales.createTicket);
router.get('/list', readRoleMiddleware, validar(salesListQuerySchema, 'query'), controladorSales.getList);
router.get('/tickets', readRoleMiddleware, validar(ticketHistoryQuerySchema, 'query'), controladorSales.listTickets);
router.get('/tickets/:ticketCode/receipt', readRoleMiddleware, validar(ticketCodeParamsSchema, 'params'), controladorSales.getReceipt);
router.get('/tickets/:ticketCode/receipt.pdf', readRoleMiddleware, validar(ticketCodeParamsSchema, 'params'), validar(receiptPdfQuerySchema, 'query'), controladorSales.getReceiptPdf);
router.post('/tickets/:ticketCode/cancel', salesRoleMiddleware, validar(ticketCodeParamsSchema, 'params'), validar(cancelTicketSchema), controladorSales.cancelTicket);
router.post('/tickets/:ticketCode/correct', salesRoleMiddleware, validar(ticketCodeParamsSchema, 'params'), validar(correctTicketSchema), controladorSales.correctTicket);
router.get('/tickets/:ticketCode', readRoleMiddleware, validar(ticketCodeParamsSchema, 'params'), controladorSales.getTicket);

export default router;
