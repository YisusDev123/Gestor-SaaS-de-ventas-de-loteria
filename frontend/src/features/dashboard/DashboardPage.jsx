import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, CircleDollarSign, Clock3, TicketCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

import { apiRequest } from '../../shared/api/api-client.js';
import { ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { dashboardSchema } from '../../shared/schemas/api.js';
import { costaRicaBusinessDate, formatCostaRicaDateTime, formatCrc } from '../../shared/utils/formatters.js';
import { useSession } from '../auth/session-context.js';

export function DashboardPage() {
  const { seller } = useSession();
  const businessDate = costaRicaBusinessDate();
  const query = useQuery({
    queryKey: ['dashboard', businessDate],
    queryFn: () => apiRequest(`/reports/dashboard?businessDate=${businessDate}`).then((body) => dashboardSchema.parse(body.data)),
  });

  if (query.isPending) return <LoadingState label="Preparando tu resumen del día…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  const data = query.data;
  const alertDetails = {
    CASH_RECONCILIATION_DIFFERENCE: { label: 'La caja no coincide con el ledger.', action: 'Revisar caja', href: '/caja' },
    PENDING_PRIZES: { label: 'Hay premios pendientes de pago.', action: 'Ver premios', href: '/premios' },
  };

  return (
    <main className="page">
      <header className="page-header">
        <div><p className="eyebrow">Hoy · Costa Rica</p><h1>Hola, {seller.tenant.name}</h1><p>Este es el estado de tu operación al momento.</p></div>
        <a className="button button--primary" href="/ventas"><Banknote size={18} /> Nueva venta</a>
      </header>

      {data.alerts.length > 0 && (
        <div className="alert alert--warning dashboard-alert"><AlertTriangle size={19} /><div><strong>Hay {data.alerts.length} aviso(s) que requieren revisión.</strong><ul>{data.alerts.map((alert) => { const detail = alertDetails[alert.code] || { label: `Revisar aviso: ${alert.code}`, action: 'Abrir reportes', href: '/reportes' }; return <li key={alert.code}><span>{detail.label}</span><Link to={detail.href}>{detail.action}</Link></li>; })}</ul></div></div>
      )}

      <section className="metric-grid dashboard-metrics" aria-label="Resumen financiero">
        <article className="metric-card metric-card--accent"><span><Banknote /></span><p>Ventas netas</p><strong>{formatCrc(data.sales.netAmount)}</strong><small>{data.sales.ticketCount} comprobantes válidos</small></article>
        <article className="metric-card"><span><CircleDollarSign /></span><p>Caja actual</p><strong>{formatCrc(data.cash.currentBalance)}</strong><small>{data.cash.isBalanced ? 'Caja conciliada' : 'Requiere conciliación'}</small></article>
        <article className="metric-card"><span><TicketCheck /></span><p>Premios pendientes</p><strong>{formatCrc(data.prizes.pendingAmount)}</strong><small>{data.prizes.pendingCount} pendientes de pago</small></article>
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Próximamente</p><h2>Sorteos por cerrar</h2></div><Clock3 /></div>
          {data.upcomingDraws.length === 0 ? <p className="empty-copy">No hay sorteos abiertos para mostrar.</p> : (
            <div className="draw-list">
              {data.upcomingDraws.map((draw) => (
                <div className="draw-row" key={draw.drawPublicId || `${draw.lotteryCode}-${draw.scheduledAt}`}>
                  <span className="lottery-dot">{draw.lotteryName?.slice(0, 1)}</span>
                  <span><strong>{draw.lotteryName}</strong><small>{draw.modalityName}</small></span>
                  <time>{formatCostaRicaDateTime(draw.closesAt)}</time>
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Detalle</p><h2>Movimiento del día</h2></div></div>
          <dl className="money-breakdown">
            <div><dt>Ventas brutas</dt><dd>{formatCrc(data.sales.grossAmount)}</dd></div>
            <div><dt>Cancelaciones</dt><dd>− {formatCrc(data.sales.cancelledAmount)}</dd></div>
            <div><dt>Premios pagados</dt><dd>− {formatCrc(data.prizes.paidAmount)}</dd></div>
            <div><dt>Gastos</dt><dd>− {formatCrc(data.operation.expensesAmount)}</dd></div>
            <div className="money-breakdown__total"><dt>Saldo del ledger</dt><dd>{formatCrc(data.cash.ledgerBalance)}</dd></div>
          </dl>
        </article>
      </section>
    </main>
  );
}
