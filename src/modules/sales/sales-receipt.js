import { parseUtcCursorDate } from '../../shared/utils/cursor.js';

export function createReceipt(ticket) {
  return Object.freeze({
    sellerName: ticket.sellerName,
    ticketCode: ticket.ticketCode,
    status: ticket.status,
    issuedAt: parseUtcCursorDate(ticket.createdAt).toISOString(),
    timezone: 'America/Costa_Rica',
    currencyCode: 'CRC',
    draw: {
      publicId: ticket.drawPublicId,
      businessDate: ticket.businessDate,
      scheduledAt: parseUtcCursorDate(ticket.scheduledAt).toISOString(),
      lotteryName: ticket.lotteryName,
      modalityName: ticket.modalityName,
    },
    items: ticket.items,
    totalAmount: ticket.totalAmount,
    prize: {
      status: ticket.prizeStatus,
      winningNumber: ticket.winningNumber,
      isWinner: ticket.isWinner,
      amount: ticket.prizeAmount,
      paidAt: ticket.prizePaidAt,
    },
    informationalFields: ticket.receiptFields,
    printLayouts: ['58mm', '80mm', 'letter'],
  });
}
