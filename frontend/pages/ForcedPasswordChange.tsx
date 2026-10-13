import { FormEvent, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { BRAND } from '../brand';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import FormField from '../components/ui/FormField';
import PasswordInput from '../components/ui/PasswordInput';

// Shown in place of the rest of the app whenever the logged-in user has must_change_password
// set — the seeded default admin, and any account an admin created or reset. There is no way
// past this screen except setting a new password (or signing out). See backend/db.js
// seedDefaults and backend/routes/users.js POST /change-password.
export default function ForcedPasswordChange() {
  const { user, setUser, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ newPassword?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (newPassword.length < 8) next.newPassword = 'Use at least 8 characters';
    if (confirm !== newPassword) next.confirm = 'Passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const updated = await api.changePassword({ newPassword });
      setUser(updated);
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Failed to change password' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={submit} noValidate aria-labelledby="pw-title">
        <img className="login-logo" src={BRAND.logo} alt={`${BRAND.name} logo`} />
        <h1 id="pw-title">Set a new password</h1>
        <div className="forced-banner" role="note">
          <ShieldAlert size={20} aria-hidden />
          <div>
            <strong>Password change required</strong>
            <span>
              You're signed in as <b>{user?.username}</b> with a temporary password. You must choose a new one before you can use the
              system.
            </span>
          </div>
        </div>
        {errors.form && (
          <div className="error" role="alert">
            {errors.form}
          </div>
        )}
        <FormField label="New password" hint="At least 8 characters." error={errors.newPassword} required>
          <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" autoFocus />
        </FormField>
        <FormField label="Confirm new password" error={errors.confirm} required>
          <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </FormField>
        <Button type="submit" variant="primary" size="lg" loading={busy} style={{ width: '100%' }}>
          {busy ? 'Saving…' : 'Set password and continue'}
        </Button>
        <Button variant="ghost" onClick={() => logout()} style={{ width: '100%', marginTop: '0.5rem' }}>
          Sign out
        </Button>
      </form>
    </div>
  );
}
