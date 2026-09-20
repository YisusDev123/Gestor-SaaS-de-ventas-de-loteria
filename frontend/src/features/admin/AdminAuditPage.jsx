import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { adminRequest } from '../../shared/api/api-client.js';
import { ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { auditEventSchema } from '../../shared/schemas/admin-api.js';
import { formatCostaRicaDateTime } from '../../shared/utils/formatters.js';

export function AdminAuditPage() {
  const [filters, setFilters] = useState({ actorScope: '', eventType: '', tenantId: '' });
  const params = useMemo(() => { const value = new URLSearchParams({ limit: '50' }); Object.entries(filters).forEach(([key, item]) => { if (item) value.set(key, item); }); return value; }, [filters]);
  const audit = useQuery({ queryKey: ['admin-audit', filters], queryFn: () => adminRequest(`/audit-events?${params}`).then((body) => z.array(auditEventSchema).parse(body.data)) });
  return <div className="page"><header className="page-header"><div><p className="eyebrow">Trazabilidad</p><h1>Auditoría</h1><p>Eventos administrativos y operativos sin exponer identificadores internos.</p></div></header><section className="panel admin-filters"><label>Actor<select value={filters.actorScope} onChange={(event) => setFilters({ ...filters, actorScope: event.target.value })}><option value="">Todos</option><option value="ADMIN">Administrador</option><option value="USER">Usuario</option><option value="JOB">Job</option><option value="SYSTEM">Sistema</option></select></label><label>Tipo de evento<input placeholder="TENANT_CREATED" value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} /></label><label>ID público del tenant<input value={filters.tenantId} onChange={(event) => setFilters({ ...filters, tenantId: event.target.value.toUpperCase() })} /></label></section>{audit.isPending ? <LoadingState /> : audit.isError ? <ErrorState error={audit.error} onRetry={audit.refetch} /> : <section className="audit-list">{audit.data.length === 0 ? <div className="panel empty-copy">No hay eventos para estos filtros.</div> : audit.data.map((event, index) => <article className="panel" key={`${event.createdAt}-${event.correlationId}-${index}`}><span className="audit-icon"><ClipboardList /></span><span><strong>{event.eventType}</strong><small>{event.actorScope} · {event.entityType}{event.tenantName ? ` · ${event.tenantName}` : ''}</small>{event.reason && <p>{event.reason}</p>}</span><span><time>{formatCostaRicaDateTime(event.createdAt)}</time><small>{event.correlationId || 'Sin correlación'}</small></span></article>)}</section>}</div>;
}
