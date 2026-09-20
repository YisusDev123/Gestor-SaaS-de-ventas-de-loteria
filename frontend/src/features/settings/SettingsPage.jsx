import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Settings2 } from 'lucide-react';

import { apiRequest } from '../../shared/api/api-client.js';
import { ErrorState, LoadingState } from '../../shared/components/PageState.jsx';
import { costaRicaBusinessDate, formatCrc } from '../../shared/utils/formatters.js';

export function SettingsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['tenant-settings'], queryFn: () => apiRequest('/tenant-settings').then((body) => body.data) });
  const availability = useQuery({ queryKey: ['daily-availability'], queryFn: () => apiRequest(`/tenant-settings/daily-availability?businessDate=${costaRicaBusinessDate()}`).then((body) => body.data) });

  const mutation = useMutation({
    mutationFn: ({ path, method = 'PUT', body }) => apiRequest(path, { method, body }).then((response) => response.data),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['tenant-settings'] }); client.invalidateQueries({ queryKey: ['daily-availability'] }); },
  });
  if (query.isPending || availability.isPending) return <LoadingState label="Cargando configuración…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  if (availability.isError) return <ErrorState error={availability.error} onRetry={availability.refetch} />;

  const saveBusiness = (event) => { event.preventDefault(); const values = new FormData(event.currentTarget); mutation.mutate({ path: '/tenant-settings/business', method: 'PATCH', body: { displayName: values.get('displayName'), receiptFields: { ...query.data.business.receiptFields, informationalText: values.get('informationalText') }, expectedVersion: query.data.business.configVersion } }); };
  const saveLimit = (event) => { event.preventDefault(); const values = new FormData(event.currentTarget); mutation.mutate({ path: '/tenant-settings/limits/general', body: { generalNumberLimit: Number(values.get('generalNumberLimit')).toFixed(2), applyToOpenDraws: values.has('applyToOpenDraws'), expectedVersion: query.data.generalLimit.configVersion } }); };

  return (
    <main className="page">
      <header className="page-header"><div><p className="eyebrow">Reglas del puesto</p><h1>Configuración</h1><p>Los cambios nuevos no reescriben tickets ni comprobantes históricos.</p></div></header>
      {mutation.isError && <div className="alert alert--error">{mutation.error.message}</div>}
      <div className="settings-grid">
        <form key={`business-${query.data.business.configVersion}`} className="panel stack-form" onSubmit={saveBusiness}><div className="panel-heading"><div><p className="eyebrow">Negocio</p><h2>Datos del comprobante</h2></div><Settings2 /></div><label>Nombre del puesto<input name="displayName" defaultValue={query.data.business.displayName} maxLength="120" /></label><label>Texto informativo<textarea name="informationalText" maxLength="500" defaultValue={query.data.business.receiptFields.informationalText || ''} /></label><button className="button button--primary"><Save size={17} /> Guardar negocio</button></form>
        <form key={`limit-${query.data.generalLimit.configVersion}`} className="panel stack-form" onSubmit={saveLimit}><div className="panel-heading"><div><p className="eyebrow">Disponibilidad</p><h2>Límite general</h2></div></div><p className="muted">Se usa como base para cada número de los sorteos futuros.</p><label>Monto por número<input name="generalNumberLimit" defaultValue={query.data.generalLimit.amount || '0.00'} inputMode="decimal" /></label><label className="check-label"><input type="checkbox" name="applyToOpenDraws" /> Aplicar también a sorteos abiertos sin reducir lo vendido</label><p className="setting-current">Actual: <strong>{formatCrc(query.data.generalLimit.amount)}</strong></p><button className="button button--primary"><Save size={17} /> Guardar límite</button></form>
      </div>
      <section className="panel settings-section"><div className="panel-heading"><div><p className="eyebrow">Hoy</p><h2>Disponibilidad diaria</h2></div><span>{availability.data.businessDate}</span></div><div className="toggle-list">{availability.data.lotteries.map((lottery) => <article key={lottery.code}><div><strong>{lottery.name}</strong><small>{lottery.permanentlyEnabled ? 'Habilitada permanentemente' : 'Deshabilitada en configuración'}</small></div><button className={`toggle ${lottery.enabledForSales ? 'toggle--on' : ''}`} role="switch" aria-checked={lottery.enabledForSales} disabled={!lottery.permanentlyEnabled || mutation.isPending} onClick={() => mutation.mutate({ path: `/tenant-settings/daily-availability/${lottery.code}`, body: { businessDate: availability.data.businessDate, isEnabledForSales: !lottery.enabledForSales, reason: lottery.enabledForSales ? 'Pausa operativa del día' : 'Reactivación operativa del día', expectedVersion: lottery.configVersion } })}><span /></button></article>)}</div></section>
      <section className="panel settings-section"><div className="panel-heading"><div><p className="eyebrow">Catálogo</p><h2>Loterías, modalidades y horarios</h2></div></div><div className="catalog-list">{query.data.lotteries.map((lottery) => <details key={lottery.code}><summary><span><strong>{lottery.name}</strong><small>{lottery.enabled ? 'Habilitada' : 'Deshabilitada'}</small></span><button className={`toggle ${lottery.enabled ? 'toggle--on' : ''}`} role="switch" aria-label={`${lottery.enabled ? 'Deshabilitar' : 'Habilitar'} ${lottery.name}`} aria-checked={lottery.enabled} onClick={(event) => { event.preventDefault(); mutation.mutate({ path: `/tenant-settings/lotteries/${lottery.code}`, body: { isEnabled: !lottery.enabled, expectedVersion: lottery.configVersion } }); }}><span /></button></summary>{lottery.modalities.map((modality) => <ModalityEditor key={modality.code} lottery={lottery} modality={modality} mutation={mutation} />)}</details>)}</div></section>
    </main>
  );
}

function ModalityEditor({ lottery, modality, mutation }) {
  function save(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    mutation.mutate({ path: `/tenant-settings/lotteries/${lottery.code}/modalities/${modality.code}`, body: { isEnabled: values.has('isEnabled'), multiplier: values.get('multiplier'), confirmed: true, expectedVersion: modality.configVersion } });
  }
  return <div className="modality-row"><form key={modality.configVersion} className="modality-form" onSubmit={save}><div><strong>{modality.name}</strong><small>{modality.multiplier ? 'Configura ventas futuras' : 'Define el multiplicador para abrir sorteos'}</small></div><label className="check-label"><input name="isEnabled" type="checkbox" defaultChecked={modality.enabled} /> Habilitada</label><label>Multiplicador<input name="multiplier" inputMode="decimal" required placeholder="Ej. 80.00" defaultValue={modality.multiplier || ''} /></label><button className="button button--secondary" disabled={mutation.isPending}>Guardar</button></form><div className="schedule-editors">{modality.schedules.map((schedule) => <ScheduleEditor key={schedule.code} lottery={lottery} modality={modality} schedule={schedule} mutation={mutation} />)}</div></div>;
}

function ScheduleEditor({ lottery, modality, schedule, mutation }) {
  function save(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    mutation.mutate({ path: `/tenant-settings/lotteries/${lottery.code}/modalities/${modality.code}/schedules/${schedule.code}`, body: { isEnabled: values.has('isEnabled'), closeMinutesBefore: Number(values.get('closeMinutesBefore')), expectedVersion: schedule.configVersion } });
  }
  return <form key={schedule.configVersion} className="schedule-editor" onSubmit={save}><strong>{schedule.localTime}</strong><label className="check-label"><input name="isEnabled" type="checkbox" defaultChecked={schedule.enabled} /> Activo</label><label>Cierre<select name="closeMinutesBefore" defaultValue={schedule.closeMinutesBefore}>{Array.from({ length: 11 }, (_value, index) => index + 10).map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}</select></label><button className="button button--secondary" disabled={mutation.isPending}>Guardar horario</button></form>;
}
