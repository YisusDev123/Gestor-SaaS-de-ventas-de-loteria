import { Award, BarChart3, Banknote, History, ListOrdered, LogOut, Menu, ReceiptText, Settings, Trophy, WalletCards, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useSession } from '../features/auth/session-context.js';

const navigation = [
  { to: '/', label: 'Resumen', icon: BarChart3, end: true },
  { to: '/ventas', label: 'Vender', icon: Banknote },
  { to: '/caja', label: 'Caja', icon: WalletCards },
  { to: '/lista', label: 'Lista', icon: ListOrdered },
  { to: '/historial', label: 'Historial', icon: History },
  { to: '/resultados', label: 'Resultados', icon: Trophy },
  { to: '/premios', label: 'Premios', icon: Award },
  { to: '/reportes', label: 'Reportes', icon: ReceiptText },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

export function SellerLayout() {
  const { seller, signOut } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function exit() {
    await signOut('seller');
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="icon-button" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></button>
        <strong>Gestión de ventas</strong>
        <span className="avatar">{seller?.tenant.name.slice(0, 1).toUpperCase()}</span>
      </header>
      {open && <button className="scrim" aria-label="Cerrar menú" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand"><span className="brand-mark brand-mark--small">GV</span><span>Gestión de ventas</span></div>
        <button className="icon-button sidebar__close" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X /></button>
        <div className="business-chip">
          <span className="business-chip__avatar">{seller?.tenant.name.slice(0, 1).toUpperCase()}</span>
          <span><small>Puesto activo</small><strong>{seller?.tenant.name}</strong></span>
        </div>
        <nav aria-label="Navegación principal">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}>
              <Icon size={19} /> {label}
            </NavLink>
          ))}
        </nav>
        <button className="sidebar__logout" onClick={exit}><LogOut size={18} /> Cerrar sesión</button>
      </aside>
      <div className="app-content"><Outlet /></div>
      <nav className="bottom-nav" aria-label="Navegación móvil">
        {navigation.slice(0, 4).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}><Icon size={20} /><span>{label}</span></NavLink>
        ))}
      </nav>
    </div>
  );
}
