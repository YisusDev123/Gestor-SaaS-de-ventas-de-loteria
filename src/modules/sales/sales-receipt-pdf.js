import PDFDocument from 'pdfkit';

const WIDTHS = { '58mm': 164.4, '80mm': 226.8, letter: 612 };
const STATUS_LABELS = { VALID: 'Válido', CANCELLED: 'Cancelado', REPLACED: 'Reemplazado' };

function money(value) {
  return `CRC ${String(value)}`;
}

export function renderReceiptPdf(receipt, paper = '80mm') {
  return new Promise((resolve, reject) => {
    const thermal = paper !== 'letter';
    const width = WIDTHS[paper];
    const height = thermal ? Math.max(360, 260 + (receipt.items.length * 30)) : 792;
    const document = new PDFDocument({
      size: thermal ? [width, height] : 'LETTER',
      margin: thermal ? 12 : 42,
      info: { Title: `Comprobante ${receipt.ticketCode}`, Author: receipt.sellerName },
    });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    const contentWidth = document.page.width - document.page.margins.left - document.page.margins.right;
    document.font('Helvetica-Bold').fontSize(thermal ? 13 : 18)
      .text(receipt.sellerName, { align: 'center' });
    document.moveDown(0.4).font('Helvetica-Bold').fontSize(10)
      .text(receipt.ticketCode, { align: 'center' });
    document.moveDown().font('Helvetica').fontSize(8)
      .text(`${receipt.draw.lotteryName} · ${receipt.draw.modalityName}`, { align: 'center' })
      .text(`Sorteo: ${receipt.draw.businessDate}`, { align: 'center' })
      .text(`Estado: ${STATUS_LABELS[receipt.status] || receipt.status}`, { align: 'center' });
    document.moveDown().moveTo(document.x, document.y).lineTo(document.x + contentWidth, document.y).stroke();
    document.moveDown(0.5);
    for (const item of receipt.items) {
      document.font('Helvetica-Bold').fontSize(9).text(
        `${item.number}   ${money(item.amount)}   x${item.multiplier}`,
      );
      document.font('Helvetica').fontSize(7).text(`Premio potencial: ${money(item.potentialPrizeAmount)}`);
    }
    document.moveDown().font('Helvetica-Bold').fontSize(11)
      .text(`TOTAL: ${money(receipt.totalAmount)}`, { align: 'right' });
    const informationalText = receipt.informationalFields?.informationalText;
    if (informationalText) document.moveDown().font('Helvetica').fontSize(7).text(informationalText);
    document.moveDown().font('Helvetica').fontSize(6.5)
      .text('Comprobante reconstruido desde snapshots históricos. Horario de Costa Rica.', { align: 'center' });
    document.end();
  });
}
