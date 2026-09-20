import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { apiRequest } from '../../shared/api/api-client.js';
import { ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { receiptSchema } from '../../shared/schemas/api.js';
import { saveBlob } from '../../shared/utils/download.js';
import { formatCostaRicaDateTime, formatCrc } from '../../shared/utils/formatters.js';

export function ReceiptPage() {
  const { ticketCode } = useParams();
  const [paper, setPaper] = useState('80mm');
  const [downloading, setDownloading] = useState(false);
  const query = useQuery({
    queryKey: ['receipt', ticketCode],
    queryFn: () => apiRequest(`/sales/tickets/${encodeURIComponent(ticketCode)}/receipt`).then((body) => receiptSchema.parse(body.data)),
  });

  async function downloadPdf() {
    setDownloading(true);
    try {
      const blob = await apiRequest(`/sales/tickets/${encodeURIComponent(ticketCode)}/receipt.pdf?paper=${paper}`, { responseType: 'blob' });
      saveBlob(blob, `${ticketCode}.pdf`);
    } finally { setDownloading(false); }
  }

  if (query.isPending) return <LoadingState label="Preparando comprobante…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  const receipt = query.data;

  return (
    <main className="page receipt-page">
      <header className="page-header receipt-actions">
        <div><Link className="back-link" to="/ventas"><ArrowLeft size={17} /> Volver a vender</Link><h1>Venta confirmada</h1><p>El comprobante ya está respaldado por el ticket.</p></div>
        <div className="receipt-toolbar">
          <label>Formato<select value={paper} onChange={(event) => setPaper(event.target.value)}><option value="58mm">Térmico 58 mm</option><option value="80mm">Térmico 80 mm</option><option value="letter">Carta / factura</option></select></label>
          <button className="button button--secondary" onClick={() => window.print()}><Printer size={18} /> Imprimir</button>
          <button className="button button--primary" onClick={downloadPdf} disabled={downloading}><Download size={18} /> {downloading ? 'Generando…' : 'Descargar PDF'}</button>
        </div>
      </header>

      <section className={`receipt-paper receipt-paper--${paper}`} aria-label="Comprobante de venta">
        <header><span className="receipt-logo">GV</span><p className="receipt-brand">{receipt.sellerName}</p><h2>COMPROBANTE DE VENTA</h2></header>
        <div className="receipt-meta"><div><span>Ticket</span><strong>{receipt.ticketCode}</strong></div><div><span>Fecha de emisión</span><strong>{formatCostaRicaDateTime(receipt.issuedAt)}</strong></div><div><span>Estado</span><strong>{receipt.status === 'VALID' ? 'VÁLIDO' : receipt.status}</strong></div></div>
        <div className="receipt-draw"><div><span>Lotería</span><strong>{receipt.draw.lotteryName}</strong></div><div><span>Modalidad</span><strong>{receipt.draw.modalityName}</strong></div><div><span>Sorteo</span><strong>{formatCostaRicaDateTime(receipt.draw.scheduledAt)}</strong></div></div>
        <table><thead><tr><th>Número</th><th>Apuesta</th><th>Multiplicador</th><th>Premio potencial</th></tr></thead><tbody>{receipt.items.map((item) => <tr key={item.number}><td><b>{item.number}</b></td><td>{formatCrc(item.amount || item.betAmount)}</td><td>{item.multiplierSnapshot || item.multiplier || '—'}</td><td>{formatCrc(item.potentialPrizeAmount)}</td></tr>)}</tbody></table>
        <div className="receipt-total"><span>Total pagado</span><strong>{formatCrc(receipt.totalAmount)}</strong></div>
        {receipt.informationalFields?.informationalText && <p className="receipt-note">{receipt.informationalFields.informationalText}</p>}
        <footer><p>Conserve este comprobante para cualquier consulta.</p><small>ID único: {receipt.ticketCode}</small></footer>
      </section>
    </main>
  );
}
