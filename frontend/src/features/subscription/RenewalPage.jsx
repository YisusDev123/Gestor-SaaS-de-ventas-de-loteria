import { CalendarClock, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { formatCostaRicaDateTime } from '../../shared/utils/formatters.js';
import { useSession } from '../auth/session-context.js';

export function RenewalPage() {
  const { seller, signOut } = useSession();
  const navigate = useNavigate();
  async function exit() { await signOut('seller'); navigate('/login', { replace: true }); }
  return (
    <main className="renewal-shell">
      <section className="renewal-card">
        <span className="renewal-icon"><CalendarClock /></span><p className="eyebrow">Gestión de ventas</p><h1>Tu suscripción requiere renovación</h1>
        <p>El acceso operativo de <strong>{seller.tenant.name}</strong> está temporalmente limitado. Tus ventas y tu historial permanecen conservados.</p>
        <dl><div><dt>Estado</dt><dd>{seller.subscription.status}</dd></div><div><dt>Acceso hasta</dt><dd>{formatCostaRicaDateTime(seller.subscription.accessEndsAt)}</dd></div></dl>
        <p className="muted">Contacta al administrador del servicio para confirmar la renovación.</p>
        <button className="button button--secondary button--wide" onClick={exit}><LogOut size={18} /> Cerrar sesión</button>
      </section>
    </main>
  );
}
