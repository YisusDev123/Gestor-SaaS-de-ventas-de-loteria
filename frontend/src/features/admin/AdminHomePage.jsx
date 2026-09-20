import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, KeyRound, Plus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { adminRequest } from '../../shared/api/api-client.js';
import { ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { adminPlanSchema, adminTenantDetailSchema, adminTenantSummarySchema } from '../../shared/schemas/admin-api.js';
import { prepareFinancialIntent, resolveFinancialIntent } from '../../shared/utils/financial-intent.js';
import { costaRicaBusinessDate, formatCostaRicaDateTime, formatCrc } from '../../shared/utils/formatters.js';

const toUtc = (date) => new Date(`${date}T00:00:00-06:00`).toISOString();

export function AdminHomePage() {
  const client = useQueryClient();
  const [filters, setFilters] = useState({ search: '', status: '', subscriptionStatus: '' });
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [oneTimeAccess, setOneTimeAccess] = useState(null);
  const params = useMemo(() => {
    const value = new URLSearchParams({ limit: '50' });
    Object.entries(filters).forEach(([key, item]) => { if (item) value.set(key, item); });
    return value;
  }, [filters]);
  const tenants = useQuery({
    queryKey: ['admin-tenants', filters],
    queryFn: () => adminRequest(`/tenants?${params}`).then((body) => z.array(adminTenantSummarySchema).parse(body.data)),
  });
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: () => adminRequest('/plans').then((body) => z.array(adminPlanSchema).parse(body.data)) });
  const detail = useQuery({
    queryKey: ['admin-tenant', selectedId], enabled: Boolean(selectedId),
    queryFn: () => adminRequest(`/tenants/${selectedId}`).then((body) => adminTenantDetailSchema.parse(body.data)),
  });
  const invalidate = () => { client.invalidateQueries({ queryKey: ['admin-tenants'] }); if (selectedId) client.invalidateQueries({ queryKey: ['admin-tenant', selectedId] }); };

  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">Administración SaaS</p><h1>Clientes</h1><p>Gestiona accesos y suscripciones sin intervenir en ventas, premios ni caja.</p></div><button className="button button--primary" onClick={() => setShowCreate(true)}><Plus size={18} /> Crear cliente</button></header>
      <section className="panel admin-filters">
        <label>Buscar<input value={filters.search} placeholder="Negocio, correo o ID" onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
        <label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option><option value="ACTIVE">Activo</option><option value="SUSPENDED">Suspendido</option><option value="CLOSED">Cerrado</option></select></label>
        <label>Suscripción<select value={filters.subscriptionStatus} onChange={(event) => setFilters({ ...filters, subscriptionStatus: event.target.value })}><option value="">Todas</option><option value="TRIAL">Prueba</option><option value="ACTIVE">Activa</option><option value="EXPIRED">Vencida</option><option value="SUSPENDED">Suspendida</option><option value="CLOSED">Cerrada</option></select></label>
      </section>
      {tenants.isPending ? <LoadingState /> : tenants.isError ? <ErrorState error={tenants.error} onRetry={tenants.refetch} /> : (
        <section className="admin-tenant-grid">
          <div className="tenant-list">
            {tenants.data.length === 0 ? <div className="panel empty-copy">No hay clientes que coincidan con los filtros.</div> : tenants.data.map((tenant) => (
              <button key={tenant.id} className={`tenant-card ${selectedId === tenant.id ? 'tenant-card--active' : ''}`} onClick={() => setSelectedId(tenant.id)}>
                <span className="business-chip__avatar">{tenant.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{tenant.displayName}</strong><small>{tenant.ownerEmail || 'Sin propietario'} · {tenant.id}</small></span><span><Status value={tenant.status} /><small>{tenant.planName} · vence {formatCostaRicaDateTime(tenant.accessEndsAt)}</small></span>
              </button>
            ))}
          </div>
          <aside className="panel tenant-detail">
            {!selectedId ? <div className="empty-copy"><Building2 /><p>Selecciona un cliente para ver sus datos y acciones.</p></div> : detail.isPending ? <LoadingState /> : detail.isError ? <ErrorState error={detail.error} onRetry={detail.refetch} /> : <TenantDetail key={`${detail.data.id}-${detail.data.status}-${detail.data.subscription.status}-${detail.data.subscription.accessEndsAt}`} tenant={detail.data} onChanged={invalidate} onAccess={setOneTimeAccess} />}
          </aside>
        </section>
      )}
      {showCreate && <CreateTenant plans={plans.data || []} onClose={() => setShowCreate(false)} onCreated={(access) => { setShowCreate(false); setOneTimeAccess(access); invalidate(); }} />}
      {oneTimeAccess && <AccessDialog value={oneTimeAccess} onClose={() => setOneTimeAccess(null)} />}
    </div>
  );
}

function TenantDetail({ tenant, onChanged, onAccess }) {
  const [status, setStatus] = useState({ value: tenant.status, reason: '' });
  const date = costaRicaBusinessDate();
  const [payment, setPayment] = useState({ amount: tenant.subscription.plan.currentPrice, startsAt: date, accessEndsAt: '', paidAt: new Date().toISOString(), note: '' });
  const statusMutation = useMutation({ mutationFn: () => adminRequest(`/tenants/${tenant.id}/status`, { method: 'PATCH', body: { status: status.value, ...(status.value === 'ACTIVE' ? {} : { reason: status.reason }) } }), onSuccess: onChanged });
  const resetMutation = useMutation({ mutationFn: () => adminRequest(`/tenants/${tenant.id}/access-reset`, { method: 'POST', body: {} }).then((body) => body.data), onSuccess: (data) => onAccess({ email: data.owner.email, ...data.accessSetup }) });
  const paymentMutation = useMutation({
    mutationFn: async () => {
      const payload = { tenantId: tenant.id, amount: payment.amount, startsAt: toUtc(payment.startsAt), accessEndsAt: toUtc(payment.accessEndsAt), paidAt: payment.paidAt, note: payment.note || undefined };
      const requestId = await prepareFinancialIntent(`admin-subscription-${tenant.id}`, payload);
      return adminRequest(`/tenants/${tenant.id}/subscription/payments`, { method: 'POST', body: { requestId, amount: payload.amount, startsAt: payload.startsAt, accessEndsAt: payload.accessEndsAt, paidAt: payload.paidAt, ...(payload.note ? { note: payload.note } : {}) } });
    },
    onSuccess: () => { resolveFinancialIntent(`admin-subscription-${tenant.id}`); onChanged(); },
  });
  return <>
    <div className="panel-heading"><div><p className="eyebrow">{tenant.id}</p><h2>{tenant.displayName}</h2></div><Status value={tenant.status} /></div>
    <dl className="admin-details"><div><dt>Propietario</dt><dd>{tenant.owner?.email || 'Sin propietario'}</dd></div><div><dt>Plan</dt><dd>{tenant.subscription.plan.name} · {formatCrc(tenant.subscription.plan.currentPrice)}</dd></div><div><dt>Suscripción</dt><dd>{subscriptionLabel(tenant.subscription.status)}</dd></div><div><dt>Acceso hasta</dt><dd>{formatCostaRicaDateTime(tenant.subscription.accessEndsAt)}</dd></div></dl>
    <details className="admin-action"><summary>Cambiar estado</summary><div className="stack-form"><label>Nuevo estado<select value={status.value} onChange={(event) => setStatus({ ...status, value: event.target.value })}><option value="ACTIVE">Activo</option><option value="SUSPENDED">Suspendido</option><option value="CLOSED">Cerrado</option></select></label>{status.value !== 'ACTIVE' && <label>Motivo<textarea minLength="3" required value={status.reason} onChange={(event) => setStatus({ ...status, reason: event.target.value })} /></label>}<MutationError mutation={statusMutation} /><button className="button button--secondary" disabled={statusMutation.isPending || (status.value !== 'ACTIVE' && status.reason.trim().length < 3)} onClick={() => statusMutation.mutate()}><ShieldAlert size={17} /> Confirmar estado</button></div></details>
    <details className="admin-action"><summary>Registrar renovación</summary><div className="stack-form"><label>Monto (CRC)<input inputMode="decimal" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></label><div className="admin-form-pair"><label>Inicio<input type="date" value={payment.startsAt} onChange={(event) => setPayment({ ...payment, startsAt: event.target.value })} /></label><label>Acceso hasta<input type="date" value={payment.accessEndsAt} onChange={(event) => setPayment({ ...payment, accessEndsAt: event.target.value })} /></label></div><label>Nota opcional<textarea value={payment.note} onChange={(event) => setPayment({ ...payment, note: event.target.value })} /></label><MutationError mutation={paymentMutation} /><button className="button button--primary" disabled={paymentMutation.isPending || !payment.amount || !payment.startsAt || !payment.accessEndsAt || payment.accessEndsAt <= payment.startsAt} onClick={() => paymentMutation.mutate()}><RefreshCw size={17} /> {paymentMutation.isPending ? 'Registrando…' : 'Registrar pago y renovar'}</button></div></details>
    <div className="admin-reset"><button className="button button--secondary" disabled={resetMutation.isPending} onClick={() => resetMutation.mutate()}><KeyRound size={17} /> Restablecer acceso</button><small>Invalida sesiones activas y genera una configuración de acceso nueva.</small><MutationError mutation={resetMutation} /></div>
    {tenant.subscription.periods.length > 0 && <div className="period-list"><h3>Períodos recientes</h3>{tenant.subscription.periods.map((period) => <div key={`${period.startsAt}-${period.endsAt}`}><span><strong>{periodLabel(period.type)}</strong><small>{formatCostaRicaDateTime(period.startsAt)} — {formatCostaRicaDateTime(period.endsAt)}</small></span><span><strong>{formatCrc(period.agreedPrice)}</strong><small>{periodStatusLabel(period.status)}</small></span></div>)}</div>}
  </>;
}

function CreateTenant({ plans, onClose, onCreated }) {
  const [form, setForm] = useState({ displayName: '', ownerEmail: '', planCode: plans[0]?.code || 'MONTHLY_BASE' });
  const mutation = useMutation({ mutationFn: () => adminRequest('/tenants', { method: 'POST', body: form }).then((body) => body.data), onSuccess: (data) => onCreated({ email: data.owner.email, ...data.accessSetup }) });
  return <div className="dialog-backdrop"><section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="create-title"><button className="icon-button dialog-close" onClick={onClose} aria-label="Cerrar"><X /></button><p className="eyebrow">Nuevo tenant</p><h2 id="create-title">Crear cliente</h2><form className="stack-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><label>Nombre del negocio<input required maxLength="120" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label>Correo del propietario<input type="email" required value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} /></label><label>Plan<select value={form.planCode} onChange={(event) => setForm({ ...form, planCode: event.target.value })}>{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {formatCrc(plan.currentPrice)}</option>)}</select></label><MutationError mutation={mutation} /><button className="button button--primary" disabled={mutation.isPending}>{mutation.isPending ? 'Creando…' : 'Crear cliente'}</button></form></section></div>;
}

function AccessDialog({ value, onClose }) {
  const setupUrl = value.token
    ? `${window.location.origin}/configurar-acceso?token=${encodeURIComponent(value.token)}`
    : null;
  return <div className="dialog-backdrop"><section className="dialog-card access-card" role="alertdialog" aria-modal="true" aria-labelledby="access-title"><button className="icon-button dialog-close" onClick={onClose} aria-label="Cerrar"><X /></button><KeyRound /><h2 id="access-title">Configuración de acceso</h2><p>Entrega: <strong>{value.delivery === 'EMAIL' ? 'correo enviado' : 'manual'}</strong> a {value.email}.</p>{setupUrl && <><p>Entrega este enlace al usuario para que cree su contraseña:</p><div className="one-time-token">{setupUrl}</div><a className="button button--secondary button--wide" href={setupUrl}>Abrir configuración de contraseña</a><p className="alert alert--warning"><strong>No es una contraseña.</strong> El enlace se muestra una sola vez, expira y debe enviarse por un canal seguro.</p></>}{value.expiresAt && <small>Vence {formatCostaRicaDateTime(value.expiresAt)}</small>}<button className="button button--primary button--wide" onClick={onClose}>Entendido</button></section></div>;
}
function MutationError({ mutation }) { return mutation.isError ? <p className="alert alert--error">{mutation.error.message}</p> : null; }
function Status({ value }) { const labels = { ACTIVE: 'Activo', SUSPENDED: 'Suspendido', CLOSED: 'Cerrado' }; return <span className={`status status--${value === 'ACTIVE' ? 'valid' : 'cancelled'}`}>{labels[value] || value}</span>; }
function subscriptionLabel(value) { return { TRIAL: 'Prueba', ACTIVE: 'Activa', EXPIRED: 'Vencida', SUSPENDED: 'Suspendida', CLOSED: 'Cerrada' }[value] || value; }
function periodLabel(value) { return { TRIAL: 'Prueba', PAID: 'Pagado' }[value] || value; }
function periodStatusLabel(value) { return { CONFIRMED: 'Confirmado', CANCELLED: 'Cancelado' }[value] || value; }
