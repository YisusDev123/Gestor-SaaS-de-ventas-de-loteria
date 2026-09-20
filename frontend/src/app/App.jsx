import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { AdminLayout } from '../layouts/AdminLayout.jsx';
import { SellerLayout } from '../layouts/SellerLayout.jsx';
import { LoadingState } from '../shared/components/PageState.jsx';
import { PwaStatus } from '../shared/components/PwaStatus.jsx';
import { AdminGuard, SellerGuard } from '../routes/RouteGuards.jsx';

const AdminHomePage = lazy(() => import('../features/admin/AdminHomePage.jsx').then((module) => ({ default: module.AdminHomePage })));
const AdminPlansPage = lazy(() => import('../features/admin/AdminPlansPage.jsx').then((module) => ({ default: module.AdminPlansPage })));
const AdminAuditPage = lazy(() => import('../features/admin/AdminAuditPage.jsx').then((module) => ({ default: module.AdminAuditPage })));
const CashPage = lazy(() => import('../features/cash/CashPage.jsx').then((module) => ({ default: module.CashPage })));
const LoginPage = lazy(() => import('../features/auth/LoginPage.jsx').then((module) => ({ default: module.LoginPage })));
const ResetPasswordPage = lazy(() => import('../features/auth/ResetPasswordPage.jsx').then((module) => ({ default: module.ResetPasswordPage })));
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage.jsx').then((module) => ({ default: module.DashboardPage })));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage.jsx').then((module) => ({ default: module.ReportsPage })));
const PrizesPage = lazy(() => import('../features/results/PrizesPage.jsx').then((module) => ({ default: module.PrizesPage })));
const ResultsPage = lazy(() => import('../features/results/ResultsPage.jsx').then((module) => ({ default: module.ResultsPage })));
const ListPage = lazy(() => import('../features/sales/ListPage.jsx').then((module) => ({ default: module.ListPage })));
const SalesPage = lazy(() => import('../features/sales/SalesPage.jsx').then((module) => ({ default: module.SalesPage })));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage.jsx').then((module) => ({ default: module.SettingsPage })));
const RenewalPage = lazy(() => import('../features/subscription/RenewalPage.jsx').then((module) => ({ default: module.RenewalPage })));
const HistoryPage = lazy(() => import('../features/tickets/HistoryPage.jsx').then((module) => ({ default: module.HistoryPage })));
const ReceiptPage = lazy(() => import('../features/tickets/ReceiptPage.jsx').then((module) => ({ default: module.ReceiptPage })));

export function App() {
  return (
    <>
    <a className="skip-link" href="#main-content">Saltar al contenido principal</a>
    <PwaStatus />
    <div id="main-content" tabIndex="-1">
    <Suspense fallback={<LoadingState />}>
      <Routes>
      <Route path="/login" element={<LoginPage scope="seller" />} />
      <Route path="/admin/login" element={<LoginPage scope="admin" />} />
      <Route path="/configurar-acceso" element={<ResetPasswordPage />} />
      <Route element={<SellerGuard />}>
        <Route path="/renovacion" element={<RenewalPage />} />
        <Route element={<SellerLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="ventas" element={<SalesPage />} />
          <Route path="comprobantes/:ticketCode" element={<ReceiptPage />} />
          <Route path="caja" element={<CashPage />} />
          <Route path="lista" element={<ListPage />} />
          <Route path="historial" element={<HistoryPage />} />
          <Route path="resultados" element={<ResultsPage />} />
          <Route path="premios" element={<PrizesPage />} />
          <Route path="reportes" element={<ReportsPage />} />
          <Route path="configuracion" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route element={<AdminGuard />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminHomePage />} />
          <Route path="planes" element={<AdminPlansPage />} />
          <Route path="auditoria" element={<AdminAuditPage />} />
        </Route>
      </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </div>
    </>
  );
}
