import { FormEvent, useState } from 'react';
import { LogIn } from 'lucide-react';
import { BRAND } from '../brand';
import { useAuth } from '../context/AuthContext';
import { getPosBridge } from '../bridge';
import Button from '../components/ui/Button';
import FormField from '../components/ui/FormField';
import PasswordInput from '../components/ui/PasswordInput';

const MODES = [
  'Standalone Point of Sale',
  'Network Point of Sale Server',
  'Network Point of Sale Terminal',
] as const;

export default function LoginPage() {
  const { login, serverError, apiInfo, refreshApiInfo } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showConn, setShowConn] = useState(false);
  const [mode, setMode] = useState(apiInfo?.mode || MODES[0]);
  const [serverIp, setServerIp] = useState(apiInfo?.serverIp || '');
  const [connMsg, setConnMsg] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const errs: typeof fieldErrors = {};
    if (!username.trim()) errs.username = 'Enter your username';
    if (!password) errs.password = 'Enter your password';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      await refreshApiInfo();
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const saveConnection = async () => {
    setConnMsg(null);
    await getPosBridge().setLocalConfig({
      mode,
      serverIp,
      till: apiInfo?.till || 1,
    });
    setConnMsg('Saved. Restart if you switched Server / Terminal mode.');
    await refreshApiInfo();
  };

  const needsConn = Boolean(serverError) || apiInfo?.mode === 'Network Point of Sale Terminal';

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={onSubmit} noValidate aria-labelledby="login-title">
        <img className="login-logo" src={BRAND.logo} alt={`${BRAND.name} logo`} />
        <h1 id="login-title">
          {BRAND.name} {BRAND.product}
        </h1>
        <p>Sign in to open the till</p>

        {(serverError || error) && (
          <div className="error" role="alert">
            {serverError || error}
          </div>
        )}

        <FormField id="username" label="Username" error={fieldErrors.username} required>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
          />
        </FormField>
        <FormField id="password" label="Password" error={fieldErrors.password} required>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </FormField>

        <Button type="submit" variant="primary" size="lg" loading={busy} icon={<LogIn size={17} aria-hidden />} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        {(needsConn || showConn) && (
          <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
            <Button variant="ghost" style={{ width: '100%', marginBottom: '0.75rem' }} onClick={() => setShowConn((v) => !v)} aria-expanded={showConn}>
              {showConn ? 'Hide' : 'Network'} connection
            </Button>
            {showConn && (
              <>
                <FormField label="Mode">
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(' Point of Sale', '')}
                      </option>
                    ))}
                  </select>
                </FormField>
                {mode === 'Network Point of Sale Terminal' && (
                  <FormField label="Server IP">
                    <input value={serverIp} onChange={(e) => setServerIp(e.target.value)} placeholder="192.168.1.10" inputMode="decimal" />
                  </FormField>
                )}
                {connMsg && (
                  <p className="muted" role="status">
                    {connMsg}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button variant="primary" onClick={saveConnection}>
                    Save
                  </Button>
                  <Button onClick={() => refreshApiInfo()}>Retry</Button>
                </div>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
