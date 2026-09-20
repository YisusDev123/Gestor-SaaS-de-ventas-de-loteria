import PDFDocument from 'pdfkit';

export function renderDailyReportPdf(report) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'LETTER', margin: 40, info: { Title: 'Reporte diario' } });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.font('Helvetica-Bold').fontSize(17).text('Reporte diario', { align: 'center' });
    document.font('Helvetica').fontSize(9).text(`${report.dateFrom} — ${report.dateTo}`, { align: 'center' });
    document.moveDown();
    for (const day of report.days) {
      if (document.y > 690) document.addPage();
      document.font('Helvetica-Bold').fontSize(11).text(day.businessDate);
      document.font('Helvetica').fontSize(8)
        .text(`Ventas brutas: ${day.grossSalesAmount}   Cancelaciones: ${day.cancelledSalesAmount}   Ventas netas: ${day.netSalesAmount}`)
        .text(`Premios generados: ${day.generatedPrizesAmount}   Pagados: ${day.paidPrizesAmount}`)
        .text(`Gastos: ${day.expensesAmount}   Ajustes netos: ${day.adjustmentsNetAmount}`)
        .text(`Caja: ${day.openingBalance} → ${day.closingBalance}`);
      document.moveDown(0.7);
    }
    document.moveDown().font('Helvetica-Bold').fontSize(10)
      .text(`Total neto vendido: ${report.totals.netSalesAmount}`)
      .text(`Total de premios generados: ${report.totals.generatedPrizesAmount}`)
      .text(`Resultado realizado: ${report.totals.realizedResultAmount}`);
    document.end();
  });
}
