import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Landmark, Plus } from 'lucide-react';
import { useState } from 'react';

import { apiRequest } from '../../shared/api/api-client.js';
import { ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { cashStateSchema } from '../../shared/schemas/api.js';
import { prepareFinancialIntent, resolveFinancialIntent } from '../../shared/utils/financial-intent.js';
import { costaRicaBusinessDate, formatCostaRicaDateTime, formatCrc } from '../../shared/utils/formatters.js';

const movementLabels = { INITIAL: 'Caja inicial', ENTRY: 'Entrada', WITHDRAWAL: 'Retiro', EXPENSE: 'Gasto', ADJUSTMENT: 'Ajuste', SALE: 'Venta', CANCELLATION: 'Cancelación', PRIZE_PAYMENT: 'Premio pagado' };

export function CashPage() {
  const client = useQueryClient();
  const [form, setForm] = useState({ movementType: 'ENTRY', direction: 'CREDIT', amount: '', reason: '' });
  const cash = useQuery({ queryKey: ['cash'], queryFn: () => apiRequest('/cash').then((body) => cashStateSchema.parse(body.data)) });
  const movements = useQuery({ queryKey: ['cash-movements'], queryFn: () => apiRequest('/cash/movements?limit=30').then((body) => body.data) });

  const mutation = useMutation({
    mutationFn: async ({ operation, payload }) => {
      const requestId = await prepareFinancialIntent(operation, payload);
      const path = operation === 'initialize-cash' ? '/cash/initialize' : '/cash/movements';
      return apiRequest(path, { method: 'POST', body: { requestId, ...payload } }).then((body) => body.data);
    },
    onSuccess: (_data, variables) => {
      resolveFinancialIntent(variables.operation);
      setForm({ movementType: 'ENTRY', direction: 'CREDIT', amount: '', reason: '' });
      client.invalidateQueries({ queryKey: ['cash'] });
      client.invalidateQueries({ queryKey: ['cash-movements'] });
      client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (cash.isPending || movements.isPending) return <LoadingState label="Consultando la caja…" />;
  if (cash.isError) return <ErrorState error={cash.error} onRetry={cash.refetch} />;
  if (movements.isError) return <ErrorState error={movements.error} onRetry={movements.refetch} />;

  function submit(event) {
    event.preventDefault();
    const amount = Number(form.amount).toFixed(2);
    if (!cash.data.initialized) {
      mutation.mutate({ operation: 'initialize-cash', payload: { amount } });
      return;
    }
    const payload = { movementType: form.movementType, amount, reason: form.reason.trim() };
    if (form.movementType === 'ADJUSTMENT') payload.direction = form.direction;
    mutation.mutate({ operation: 'cash-movement', payload });
  }

  return (
    <main className="page">
      <header className="page-header"><div><p className="eyebrow">Caja continua</p><h1>Control de caja</h1><p>El saldo continúa entre días y cada cambio conserva su movimiento.</p></div></header>
      <section className="metric-grid metric-grid--cash">
        <article className="metric-card metric-card--accent"><span><Landmark /></span><p>Saldo actual</p><strong>{formatCrc(cash.data.balance)}</strong><small>{cash.data.reconciliation.isBalanced ? 'Conciliado con el ledger' : 'Existe una diferencia'}</small></article>
        <article className="metric-card"><span>{cash.data.initialized ? <ArrowUpRight /> : <Plus />}</span><p>Estado</p><strong>{cash.data.initialized ? 'Activa' : 'Sin inicializar'}</strong><small>{cash.data.initializedAt ? formatCostaRicaDateTime(cash.data.initializedAt) : 'Declara el monto inicial'}</small></article>
      </section>
      <div className="two-column-form">
        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">{cash.data.initialized ? 'Nuevo movimiento' : 'Primer paso'}</p><h2>{cash.data.initialized ? 'Registrar movimiento' : 'Inicializar caja'}</h2></div></div>
          <form className="stack-form" onSubmit={submit}>
            {cash.data.initialized && <label>Tipo<select value={form.movementType} onChange={(event) => setForm({ ...form, movementType: event.target.value })}><option value="ENTRY">Entrada</option><option value="WITHDRAWAL">Retiro</option><option value="EXPENSE">Gasto</option><option value="ADJUSTMENT">Ajuste</option></select></label>}
            {form.movementType === 'ADJUSTMENT' && cash.data.initialized && <label>Dirección<select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}><option value="CREDIT">Aumentar caja</option><option value="DEBIT">Disminuir caja</option></select></label>}
            <label>Monto<input required min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" /></label>
            {cash.data.initialized && <label>Motivo<textarea required minLength="3" maxLength="500" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Explica por qué se registra este movimiento" /></label>}
            {mutation.isError && <div className="alert alert--error">{mutation.error.message}</div>}
            <button className="button button--primary button--wide" disabled={mutation.isPending}>{mutation.isPending ? 'Confirmando…' : cash.data.initialized ? 'Registrar movimiento' : 'Confirmar caja inicial'}</button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Movimientos</p><h2>Actividad reciente</h2></div><span>{costaRicaBusinessDate()}</span></div>
          <div className="activity-list">{movements.data.length === 0 ? <p className="empty-copy">No hay movimientos registrados.</p> : movements.data.map((movement) => <article key={movement.id}><span className={movement.direction === 'CREDIT' ? 'movement-icon movement-icon--credit' : 'movement-icon movement-icon--debit'}>{movement.direction === 'CREDIT' ? <ArrowUpRight /> : <ArrowDownLeft />}</span><div><strong>{movementLabels[movement.movementType] || movement.movementType}</strong><small>{movement.reason || formatCostaRicaDateTime(movement.createdAt)}</small></div><div className="movement-amount"><strong>{movement.direction === 'CREDIT' ? '+' : '−'} {formatCrc(movement.amount)}</strong><small>Saldo {formatCrc(movement.balanceAfter)}</small></div></article>)}</div>
        </section>
      </div>
    </main>
  );
}
