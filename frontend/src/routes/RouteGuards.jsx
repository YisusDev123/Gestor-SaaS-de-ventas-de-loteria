import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useSession } from '../features/auth/session-context.js';

function LoadingSession() {
  return <main className="center-state"><div className="spinner" /><p>Verificando sesión…</p></main>;
}

export function SellerGuard() {
  const { seller, ready } = useSession();
  const location = useLocation();
  if (!ready.seller) return <LoadingSession />;
  if (!seller) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (seller.subscription.renewalRequired && location.pathname !== '/renovacion') {
    return <Navigate to="/renovacion" replace />;
  }
  return <Outlet />;
}

export function AdminGuard() {
  const { admin, ready } = useSession();
  const location = useLocation();
  if (!ready.admin) return <LoadingSession />;
  if (!admin) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
