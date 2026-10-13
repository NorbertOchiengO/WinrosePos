import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, Power } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getPosBridge } from '../bridge';

export default function UserMenu() {
  const { user, logout, apiInfo } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Move focus into the menu so it can be used from the keyboard straight away.
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = (user?.fullname || '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="user-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="user-avatar" aria-hidden>
          {initials}
        </span>
        <span className="user-menu-name">
          <strong>{user?.fullname}</strong>
          <small>{user?.role || 'cashier'}</small>
        </span>
        <ChevronDown size={15} aria-hidden />
      </button>
      {open && (
        <div className="user-menu-pop" role="menu" aria-label="Account">
          <div className="user-menu-head">
            <strong>{user?.fullname}</strong>
            <span>
              {user?.username} · {user?.role || 'cashier'} · Till #{apiInfo?.till || 1}
            </span>
          </div>
          <button type="button" role="menuitem" className="user-menu-item" onClick={() => logout()}>
            <LogOut size={16} aria-hidden /> Sign out
          </button>
          <button type="button" role="menuitem" className="user-menu-item" onClick={() => getPosBridge().quit()}>
            <Power size={16} aria-hidden /> Quit application
          </button>
        </div>
      )}
    </div>
  );
}
