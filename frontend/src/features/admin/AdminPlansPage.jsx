import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import { adminRequest } from '../../shared/api/api-client.js';
import { ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { adminPlanSchema } from '../../shared/schemas/admin-api.js';
import { formatCostaRicaDateTime, formatCrc } from '../../shared/utils/formatters.js';

export function AdminPlansPage() {
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: () => adminRequest('/plans').then((body) => z.array(adminPlanSchema).parse(body.data)) });
  return <div className="page"><header className="page-header"><div><p className="eyebrow">Catálogo comercial</p><h1>Planes</h1><p>El precio actualizado se aplica a períodos futuros; no altera acuerdos históricos.</p></div></header>{plans.isPending ? <LoadingState /> : plans.isError ? <ErrorState error={plans.error} onRetry={plans.refetch} /> : <section className="plan-grid">{plans.data.map((plan) => <PlanCard key={plan.code} plan={plan} />)}</section>}</div>;
}

function PlanCard({ plan }) {
  const client = useQueryClient();
  const [price, setPrice] = useState(plan.currentPrice);
  const mutation = useMutation({ mutationFn: () => adminRequest(`/plans/${plan.code}/price`, { method: 'PATCH', body: { currentPrice: price } }), onSuccess: () => client.invalidateQueries({ queryKey: ['admin-plans'] }) });
  return <article className="panel plan-card"><span><BadgeDollarSign /></span><p className="eyebrow">{plan.code}</p><h2>{plan.name}</h2><strong>{formatCrc(plan.currentPrice)}</strong><small>{plan.trialDays} días de prueba · {plan.isActive ? 'Disponible' : 'Inactivo'}<br />Actualizado {formatCostaRicaDateTime(plan.updatedAt)}</small><form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><label>Nuevo precio<input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} /></label>{mutation.isError && <p className="alert alert--error">{mutation.error.message}</p>}<button className="button button--secondary" disabled={mutation.isPending || !price}>{mutation.isPending ? 'Guardando…' : 'Actualizar precio'}</button></form></article>;
}
