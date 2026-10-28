import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { DataProvider } from './lib/data';
import { ToastProvider } from './components/toast';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { Login, NoAccess, SetPassword } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Assets } from './pages/Assets';
import { AssetDetail } from './pages/AssetDetail';
import { Employees } from './pages/Employees';
import { EmployeeDetail } from './pages/EmployeeDetail';
import { Badges } from './pages/Badges';
import { GateLog } from './pages/GateLog';
import { Byod } from './pages/Byod';
import { Accessories } from './pages/Accessories';
import { History } from './pages/History';
import { Activity } from './pages/Activity';
import { Settings } from './pages/Settings';

// The Excel reader is large; load it only when an admin opens Import.
const Import = lazy(() => import('./pages/Import').then((m) => ({ default: m.Import })));

function Gate() {
  const { session, profile, role, loading, isAdmin, signOut } = useAuth();
  if (loading || (session && !profile && loading)) return <Spinner label="Signing in…" />;
  if (!session) return <Login />;
  if (!role) return <NoAccess email={session.user.email ?? ''} onSignOut={() => void signOut()} />;
  return (
    <DataProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="assets" element={<Assets />} />
          <Route path="assets/:id" element={<AssetDetail />} />
          <Route path="employees" element={<Employees />} />
          <Route path="employees/:id" element={<EmployeeDetail />} />
          <Route path="badges" element={<Badges />} />
          <Route path="gate" element={<GateLog />} />
          <Route path="byod" element={<Byod />} />
          <Route path="accessories" element={<Accessories />} />
          <Route path="history" element={<History />} />
          <Route path="activity" element={<Activity />} />
          {isAdmin && <Route path="import" element={<Suspense fallback={<Spinner />}><Import /></Suspense>} />}
          {isAdmin && <Route path="settings" element={<Settings />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DataProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="*" element={<Gate />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
