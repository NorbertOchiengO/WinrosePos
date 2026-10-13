import { BRAND } from './brand';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import PosPage from './pages/PosPage';
import ForcedPasswordChange from './pages/ForcedPasswordChange';
import { ToastProvider } from './components/ui/Toast';

function AppContent() {
  const { ready, user } = useAuth();

  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="panel login-card">
          <h1>{BRAND.name} {BRAND.product}</h1>
          <p>Starting…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (user.must_change_password) {
    return <ForcedPasswordChange />;
  }

  return <PosPage />;
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
