import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Plus, Search, Ticket, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { apiRequest } from '../../shared/api/api-client.js';
import { EmptyState, ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { saleDrawsSchema } from '../../shared/schemas/api.js';
import { prepareFinancialIntent, resolveFinancialIntent } from '../../shared/utils/financial-intent.js';
import { costaRicaBusinessDate, formatCostaRicaDateTime, formatCrc } from '../../shared/utils/formatters.js';

const statusLabel = { VALID: 'Válido', REPLACED: 'Reemplazado' };
const prizeLabel = { PENDING_RESULT: 'Resultado pendiente', NOT_WINNER: 'No ganador', PENDING_PAYMENT: 'Premio pendiente', PAID: 'Pagado', INELIGIBLE: 'No elegible' };

export function HistoryPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [date, setDate] = useState(costaRicaBusinessDate());
  const [status, setStatus] = useState('');
  const [prizeStatus, setPrizeStatus] = useState('');
  const [code, setCode] = useState('');
  const [activeCode, setActiveCode] = useState('');
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [items, setItems] = useState([]);
  const [selectedDrawId, setSelectedDrawId] = useState('');
  const params = new URLSearchParams({ limit: '50' });
  if (date) params.set('businessDate', date);
  if (status) params.set('status', status);
  if (prizeStatus) params.set('prizeStatus', prizeStatus);
  const query = useQuery({ queryKey: ['ticket-history', date, status, prizeStatus], queryFn: () => apiRequest(`/sales/tickets?${params}`).then((body) => body.data) });
  const detail = useQuery({ queryKey: ['ticket-detail', activeCode], queryFn: () => apiRequest(`/sales/tickets/${encodeURIComponent(activeCode)}`).then((body) => body.data), enabled: Boolean(activeCode) });
  const replacementDraws = useQuery({
    queryKey: ['replacement-draws', detail.data?.businessDate],
    queryFn: () => apiRequest(`/sales/draws?businessDate=${detail.data.businessDate}`).then((body) => saleDrawsSchema.parse(body.data)),
    enabled: action === 'correct' && Boolean(detail.data?.businessDate),
  });

  useEffect(() => {
    // Carga el snapshot consultado en el formulario de reemplazo.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (detail.data?.items && action === 'correct') {
      setItems(detail.data.items.map((item) => ({ number: item.number, amount: item.amount })));
      setSelectedDrawId(detail.data.drawPublicId || '');
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [detail.data, action]);

  const mutation = useMutation({
    mutationFn: async () => {
      const cleanReason = reason.trim();
      if (cleanReason.length < 3) throw new Error('Indica el motivo de la operación.');
      if (!selectedDrawId) throw new Error('Selecciona el sorteo y modalidad del reemplazo.');
      const cleanItems = items.map((item) => ({ number: String(item.number).padStart(2, '0'), amount: String(item.amount).trim() }));
      if (!cleanItems.length || cleanItems.some((item) => !/^\d{2}$/.test(item.number) || !/^\d+(?:\.\d{1,2})?$/.test(item.amount) || Number(item.amount) <= 0)) throw new Error('Revisa los números y montos de la nueva jugada.');
      if (new Set(cleanItems.map((item) => item.number)).size !== cleanItems.length) throw new Error('No repitas números en el reemplazo.');
      const replacementTotal = cleanItems.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2);
      if (replacementTotal !== Number(detail.data.totalAmount).toFixed(2)) throw new Error(`El reemplazo debe sumar exactamente ${formatCrc(detail.data.totalAmount)}.`);
      const requestId = await prepareFinancialIntent('correct-ticket', { ticketCode: activeCode, drawPublicId: selectedDrawId, items: cleanItems, reason: cleanReason });
      return apiRequest(`/sales/tickets/${encodeURIComponent(activeCode)}/correct`, { method: 'POST', body: { requestId, drawPublicId: selectedDrawId, reason: cleanReason, items: cleanItems } });
    },
    onSuccess: () => {
      resolveFinancialIntent('correct-ticket');
      client.invalidateQueries({ queryKey: ['ticket-history'] });
      client.invalidateQueries({ queryKey: ['dashboard'] });
      client.invalidateQueries({ queryKey: ['sale-draws'] });
      closeDialog();
    },
  });

  function closeDialog() { setAction(null); setActiveCode(''); setReason(''); setItems([]); setSelectedDrawId(''); mutation.reset(); }
  function openAction(ticketCode, nextAction) { setActiveCode(ticketCode); setAction(nextAction); setReason(''); setSelectedDrawId(''); mutation.reset(); }
  function updateItem(index, field, value) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)); }
  const search = (event) => { event.preventDefault(); if (code.trim()) navigate(`/comprobantes/${encodeURIComponent(code.trim())}`); };

  return (
    <main className="page">
      <header className="page-header"><div><p className="eyebrow">Comprobantes</p><h1>Historial de ventas</h1><p>Busca, consulta o reemplaza un ticket antes del cierre del sorteo.</p></div></header>
      <form className="history-search" onSubmit={search}><Search /><input aria-label="Código del ticket" value={code} onChange={(event) => setCode(event.target.value)} placeholder="T-XXXX-XXXX-XXXX-XXXX" /><button className="button button--primary">Buscar ticket</button></form>
      <div className="filter-row"><label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="VALID">Válidos</option><option value="REPLACED">Reemplazados</option></select></label><label>Estado del premio<select value={prizeStatus} onChange={(event) => setPrizeStatus(event.target.value)}><option value="">Todos</option><option value="PENDING_PAYMENT">Premio pendiente</option><option value="PENDING_RESULT">Resultado pendiente</option><option value="NOT_WINNER">No ganador</option><option value="PAID">Pagado</option></select></label></div>
      {query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : query.data.length === 0 ? <EmptyState title="No hay tickets" description="No se encontraron ventas con estos filtros." /> : (
        <div className="ticket-table"><div className="ticket-table__head"><span>Ticket</span><span>Sorteo y hora</span><span>Estado</span><span>Total</span><span>Acciones</span></div>
          {query.data.map((ticket) => <article key={ticket.id}><span className="ticket-code"><Ticket size={17} /><span><strong>{ticket.ticketCode}</strong><small>{formatCostaRicaDateTime(ticket.createdAt)}</small></span></span><span><strong>{ticket.lotteryName}</strong><small>{ticket.modalityName} · {ticket.scheduledAt ? formatCostaRicaDateTime(ticket.scheduledAt) : 'Horario no disponible'} · {ticket.itemCount} jugada(s)</small></span><span><b className={`status status--${ticket.status.toLowerCase()}`}>{statusLabel[ticket.status] || ticket.status}</b><small>{prizeLabel[ticket.prizeStatus]}</small></span><strong>{formatCrc(ticket.totalAmount)}</strong><span className="ticket-actions"><Link className="icon-button" to={`/comprobantes/${encodeURIComponent(ticket.ticketCode)}`} aria-label="Ver comprobante"><Eye /></Link>{ticket.status === 'VALID' && <button className="button button--small button--secondary" type="button" onClick={() => openAction(ticket.ticketCode, 'correct')}>Reemplazar</button>}</span></article>)}
        </div>
      )}
      {action && <div className="dialog-backdrop"><section className="dialog-card ticket-action-card" role="dialog" aria-modal="true" aria-labelledby="ticket-action-title"><button className="icon-button dialog-close" type="button" onClick={closeDialog} aria-label="Cerrar"><X /></button><h2 id="ticket-action-title">{action === 'cancel' ? 'Cancelar ticket' : 'Reemplazar ticket'}</h2><p>Ticket <strong>{activeCode}</strong>. {action === 'cancel' ? 'Para cancelar, el sorteo debe seguir disponible.' : 'Puedes elegir otra lotería y modalidad que todavía estén disponibles.'}</p>{detail.isPending ? <LoadingState label="Cargando jugadas…" /> : detail.isError ? <ErrorState error={detail.error} onRetry={detail.refetch} /> : action === 'correct' ? <><label>Sorteo y modalidad<select value={selectedDrawId} onChange={(event) => setSelectedDrawId(event.target.value)} disabled={replacementDraws.isPending}><option value="">Selecciona un sorteo</option>{replacementDraws.data?.draws.map((draw) => <option value={draw.drawPublicId} key={draw.drawPublicId}>{draw.lottery.name} · {draw.modality.name} · {formatCostaRicaDateTime(draw.scheduledAt)}</option>)}</select></label>{replacementDraws.isError && <ErrorState error={replacementDraws.error} onRetry={replacementDraws.refetch} />}<p className="form-hint">El monto total debe mantenerse exactamente igual al ticket original: {formatCrc(detail.data?.totalAmount)}.</p><div className="ticket-editor-items">{items.map((item, index) => <div className="ticket-editor-row" key={`${index}-${item.number}`}><label>Número<input inputMode="numeric" maxLength="2" value={item.number} onChange={(event) => updateItem(index, 'number', event.target.value.replace(/\D/g, '').slice(0, 2))} /></label><label>Monto<input inputMode="decimal" value={item.amount} onChange={(event) => updateItem(index, 'amount', event.target.value)} /></label><button className="icon-button" type="button" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Quitar jugada"><Trash2 size={17} /></button></div>)}</div><button className="button button--secondary" type="button" onClick={() => setItems((current) => [...current, { number: '', amount: '' }])}><Plus size={16} /> Agregar jugada</button></> : <div className="alert alert--warning">La cancelación registra una devolución pendiente y descuenta el monto de la caja. El vendedor entrega el dinero manualmente.</div>}{(detail.data || action === 'cancel') && <label>Motivo<textarea required minLength="3" maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. número digitado incorrectamente" /></label>}{mutation.isError && <div className="alert alert--error">{mutation.error.message}</div>}<div className="dialog-actions"><button className="button button--secondary" type="button" onClick={closeDialog}>Cerrar</button><button className="button button--primary" type="button" disabled={mutation.isPending || detail.isPending || (action === 'correct' && (!items.length || !selectedDrawId))} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Procesando…' : action === 'cancel' ? 'Confirmar cancelación' : 'Confirmar reemplazo'}</button></div></section></div>}
    </main>
  );
}
