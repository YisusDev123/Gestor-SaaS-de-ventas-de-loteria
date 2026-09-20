import { AlertTriangle, Inbox } from 'lucide-react';

export function LoadingState({ label = 'Cargando información…' }) {
  return <div className="panel-state"><div className="spinner" /><p>{label}</p></div>;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="panel-state panel-state--error" role="alert">
      <AlertTriangle />
      <strong>No pudimos cargar esta información</strong>
      <p>{error?.message || 'Intenta nuevamente.'}</p>
      {error?.correlationId && <small>Referencia: {error.correlationId}</small>}
      {onRetry && <button className="button button--secondary" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export function EmptyState({ title, description, action = null }) {
  return <div className="panel-state"><Inbox /><strong>{title}</strong><p>{description}</p>{action}</div>;
}
