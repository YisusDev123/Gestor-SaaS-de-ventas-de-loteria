import { Building2, ClipboardList, CreditCard, LogOut, Shield } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useSession } from '../features/auth/session-context.js';

const navigation = [
  { to: '/admin', end: true, label: 'Clientes', icon: Building2 },
  { to: '/admin/planes', label: 'Planes', icon: CreditCard },
  { to: '/admin/auditoria', label: 'Auditoría', icon: ClipboardList },
];

export function AdminLayout() {
  const { admin, signOut } = useSession();
  const navigate = useNavigate();
  async function exit() {
    await signOut('admin');
    navigate('/admin/login', { replace: true });
  }
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div><span className="brand-mark brand-mark--small">GV</span><strong>Gestión de ventas</strong><span className="scope-badge"><Shield size={14} /> Administración</span></div>
        <div><span className="admin-email">{admin?.admin.email}</span><button className="button button--ghost" onClick={exit}><LogOut size={17} /> Salir</button></div>
      </header>
      <nav className="admin-nav" aria-label="Administración">
        {navigation.map(({ to, end, label, icon: Icon }) => <NavLink key={to} to={to} end={end}><Icon size={17} /> {label}</NavLink>)}
      </nav>
      <main className="admin-content"><Outlet /></main>
    </div>
  );
}
