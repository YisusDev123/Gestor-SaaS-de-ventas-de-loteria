import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiRequest } from '../../shared/api/api-client.js';
import { EmptyState, ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { saleCreationSchema, saleDrawsSchema, saleMatrixSchema } from '../../shared/schemas/api.js';
import { prepareFinancialIntent, resolveFinancialIntent } from '../../shared/utils/financial-intent.js';
import { costaRicaBusinessDate, formatCostaRicaDateTime, formatCrc } from '../../shared/utils/formatters.js';
import { NumberGrid } from './NumberGrid.jsx';

const SALES_VIEWPORT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

function canonicalAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number.toFixed(2);
}

export function SalesPage() {
  const businessDate = costaRicaBusinessDate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drawId, setDrawId] = useState('');
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [amount, setAmount] = useState('');
  const [cart, setCart] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) return undefined;

    const originalContent = viewport.getAttribute('content');
    const preventPinch = (event) => {
      if (!event.touches || event.touches.length > 1) event.preventDefault();
    };
    viewport.setAttribute('content', SALES_VIEWPORT);
    document.addEventListener('touchstart', preventPinch, { passive: false });
    document.addEventListener('touchmove', preventPinch, { passive: false });
    document.addEventListener('gesturestart', preventPinch, { passive: false });

    return () => {
      document.removeEventListener('touchstart', preventPinch);
      document.removeEventListener('touchmove', preventPinch);
      document.removeEventListener('gesturestart', preventPinch);
      if (originalContent === null) viewport.removeAttribute('content');
      else viewport.setAttribute('content', originalContent);
    };
  }, []);

  const drawsQuery = useQuery({
    queryKey: ['sale-draws', businessDate],
    queryFn: () => apiRequest(`/sales/draws?businessDate=${businessDate}`).then((body) => saleDrawsSchema.parse(body.data)),
  });
  const activeDrawId = drawId || drawsQuery.data?.draws?.[0]?.drawPublicId || '';
  const matrixQuery = useQuery({
    queryKey: ['sale-matrix', activeDrawId],
    queryFn: () => apiRequest(`/sales/draws/${activeDrawId}/numbers`).then((body) => saleMatrixSchema.parse(body.data)),
    enabled: Boolean(activeDrawId),
  });
  const total = useMemo(() => cart.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2), [cart]);
  const orderedNumbers = useMemo(
    () => [...(matrixQuery.data?.numbers || [])].sort((left, right) => Number(left.number) - Number(right.number)),
    [matrixQuery.data?.numbers],
  );

  const saleMutation = useMutation({
    mutationFn: async () => {
      const items = cart.map(({ number, amount: itemAmount }) => ({ number, amount: itemAmount }));
      const requestId = await prepareFinancialIntent('create-ticket', { drawPublicId: activeDrawId, items });
      return apiRequest('/sales/tickets', { method: 'POST', body: { requestId, drawPublicId: activeDrawId, items } }).then((response) => saleCreationSchema.parse(response.data));
    },
    onSuccess: (data) => {
      resolveFinancialIntent('create-ticket');
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['sale-matrix', activeDrawId] });
      navigate(`/comprobantes/${encodeURIComponent(data.ticket.ticketCode)}`);
    },
  });

  function toggleNumber(number) {
    setSelectedNumbers((current) => (
      current.includes(number)
        ? current.filter((item) => item !== number)
        : [...current, number].sort((a, b) => a.localeCompare(b))
    ));
    setMessage('');
  }

  function selectDraw(nextDrawId) {
    setDrawId(nextDrawId);
    setSelectedNumbers([]);
    setCart([]);
  }

  function addNumbers() {
    const formatted = canonicalAmount(amount);
    if (!selectedNumbers.length || !formatted) {
      setMessage('Selecciona uno o varios números y escribe un monto mayor que cero.');
      return;
    }
    const unavailableNumber = selectedNumbers.find((number) => {
      const position = matrixQuery.data?.numbers.find((item) => item.number === number);
      return Number(formatted) > Number(position?.remainingAmount || 0);
    });
    if (unavailableNumber) {
      setMessage(`El número ${unavailableNumber} no tiene disponibilidad suficiente.`);
      return;
    }
    setCart((current) => [
      ...current.filter((item) => !selectedNumbers.includes(item.number)),
      ...selectedNumbers.map((number) => ({ number, amount: formatted })),
    ].sort((a, b) => a.number.localeCompare(b.number)));
    setSelectedNumbers([]);
    setAmount('');
    setMessage('');
  }

  if (drawsQuery.isPending) return <LoadingState label="Buscando sorteos disponibles…" />;
  if (drawsQuery.isError) return <ErrorState error={drawsQuery.error} onRetry={drawsQuery.refetch} />;
  if (drawsQuery.data.draws.length === 0) {
    const requiresMultipliers = drawsQuery.data.warnings.some(
      (warning) => warning.code === 'LOTTERY_RULES_INCOMPLETE',
    );
    return <main className="page"><header className="page-header"><div><p className="eyebrow">Venta rápida</p><h1>Nueva venta</h1></div></header><EmptyState title="No hay sorteos disponibles" description={requiresMultipliers ? 'Define los multiplicadores pendientes para abrir los sorteos futuros de hoy.' : 'Revisa los horarios o la disponibilidad diaria.'} action={requiresMultipliers ? <button className="button button--primary" onClick={() => navigate('/configuracion')}>Configurar multiplicadores</button> : null} /></main>;
  }

  return (
    <main className="page sales-page">
      <header className="page-header"><div><p className="eyebrow">Venta rápida</p><h1>Nueva venta</h1><p>Selecciona un sorteo, marca los números y confirma el total.</p></div></header>
      <div className="sales-workspace">
        <section className="sale-builder">
          <div className="draw-tabs" role="tablist" aria-label="Sorteos disponibles">
            {drawsQuery.data.draws.map((draw) => (
              <button key={draw.drawPublicId} className={activeDrawId === draw.drawPublicId ? 'draw-tab draw-tab--active' : 'draw-tab'} onClick={() => selectDraw(draw.drawPublicId)} role="tab" aria-selected={activeDrawId === draw.drawPublicId}>
                <span>{draw.lottery.name}</span><strong>{formatCostaRicaDateTime(draw.scheduledAt)}</strong><small>{draw.modality.name}</small>
              </button>
            ))}
          </div>
          <label className="draw-select">
            Sorteo y modalidad
            <select value={activeDrawId} onChange={(event) => selectDraw(event.target.value)}>
              {drawsQuery.data.draws.map((draw) => (
                <option key={draw.drawPublicId} value={draw.drawPublicId}>
                  {draw.lottery.name} · {draw.modality.name} · {formatCostaRicaDateTime(draw.scheduledAt)}
                </option>
              ))}
            </select>
          </label>

          {matrixQuery.isPending ? <LoadingState label="Cargando números…" /> : matrixQuery.isError ? <ErrorState error={matrixQuery.error} onRetry={matrixQuery.refetch} /> : (
            <>
              <div className="matrix-heading"><div><h2>Matriz 00–99</h2><p>Toca varios números para seleccionarlos o quitarlos.</p></div><span className="availability-key"><i /> Disponible</span></div>
              <NumberGrid className="sales-number-grid">
                {orderedNumbers.map((position) => {
                  const unavailable = Number(position.remainingAmount) <= 0;
                  const selected = selectedNumbers.includes(position.number);
                  const inCart = cart.some((item) => item.number === position.number);
                  return <button key={position.number} type="button" disabled={unavailable} aria-pressed={selected} aria-label={`Número ${position.number}, ${unavailable ? 'lleno' : `${formatCrc(position.remainingAmount)} disponible`}`} className={`list-number sales-number ${selected ? 'sales-number--selected' : ''} ${inCart ? 'sales-number--cart' : ''}`} onClick={() => toggleNumber(position.number)}><strong>{position.number}</strong><span>{unavailable ? 'Lleno' : formatCrc(position.remainingAmount)}</span><small>{inCart ? 'En venta' : selected ? 'Seleccionado' : 'Disponible'}</small>{(selected || inCart) && <Check size={13} />}</button>;
                })}
              </NumberGrid>
              <div className="quick-entry">
                <div><small>Seleccionados</small><strong>{selectedNumbers.length || '—'}</strong></div>
                <label>Monto<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" /></label>
                <div className="quick-values"><button type="button" onClick={() => setAmount('100.00')}>₡100</button><button type="button" onClick={() => setAmount('500.00')}>₡500</button><button type="button" onClick={() => setAmount('1000.00')}>₡1.000</button></div>
                <button type="button" className="button button--primary" onClick={addNumbers}><Plus size={18} /> Agregar {selectedNumbers.length ? `(${selectedNumbers.length})` : ''}</button>
              </div>
              {message && <div className="alert alert--warning">{message}</div>}
            </>
          )}
        </section>

        <aside className="sale-cart">
          <div className="panel-heading"><div><p className="eyebrow">Comprobante</p><h2>Venta actual</h2></div><ShoppingCart /></div>
          {cart.length === 0 ? <div className="cart-empty"><ShoppingCart /><p>Aún no agregaste números.</p></div> : (
            <div className="cart-items">{cart.map((item) => <div key={item.number}><span className="cart-number">{item.number}</span><strong>{formatCrc(item.amount)}</strong><button onClick={() => setCart((current) => current.filter((entry) => entry.number !== item.number))} aria-label={`Quitar número ${item.number}`}><Trash2 size={17} /></button></div>)}</div>
          )}
          <div className="cart-total"><span>Total a cobrar</span><strong>{formatCrc(total)}</strong></div>
          {saleMutation.isError && <div className="alert alert--error" role="alert">{saleMutation.error.message}</div>}
          <button className="button button--primary button--wide button--large" disabled={!cart.length || saleMutation.isPending} onClick={() => saleMutation.mutate()}>{saleMutation.isPending ? 'Confirmando…' : 'Confirmar venta'} <ChevronRight /></button>
          <p className="safe-action"><Minus size={14} /> No se reintentará automáticamente una venta.</p>
        </aside>
      </div>
    </main>
  );
}
