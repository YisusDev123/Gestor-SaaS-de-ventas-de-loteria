import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ListOrdered } from 'lucide-react';
import { useState } from 'react';

import { apiRequest } from '../../shared/api/api-client.js';
import { EmptyState, ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { costaRicaBusinessDate, formatCostaRicaDateTime, formatCrc } from '../../shared/utils/formatters.js';
import { NumberGrid } from './NumberGrid.jsx';

export function ListPage() {
  const [date, setDate] = useState(costaRicaBusinessDate());
  const query = useQuery({ queryKey: ['sales-list', date], queryFn: () => apiRequest(`/sales/list?businessDate=${date}&limit=50`).then((body) => body.data) });
  return <main className="page"><header className="page-header"><div><p className="eyebrow">Acumulados 00–99</p><h1>Lista</h1><p>Cada total se actualiza junto con el ticket y la caja.</p></div><label className="date-filter">Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></header>{query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : query.data.length === 0 ? <EmptyState title="Sin sorteos para esta fecha" description="Cambia la fecha o revisa la configuración de sorteos." /> : <div className="list-draws">{query.data.map((draw, index) => <details className="panel list-draw" key={draw.drawPublicId} open={index === 0}><summary><span className="lottery-dot"><ListOrdered size={18} /></span><span><strong>{draw.lotteryName} · {draw.modalityName}</strong><small>{formatCostaRicaDateTime(draw.createdAt)} · {draw.status}</small></span><span className="list-draw__total"><small>Total vendido</small><strong>{formatCrc(draw.totalSoldAmount)}</strong></span><ChevronDown /></summary><NumberGrid>{draw.numbers.map((number) => <div key={number.number} className={Number(number.soldAmount) > 0 ? 'list-number list-number--sold' : 'list-number'}><strong>{number.number}</strong><span>{formatCrc(number.soldAmount)}</span><small>{number.validTicketCount} ticket(s)</small></div>)}</NumberGrid></details>)}</div>}</main>;
}
