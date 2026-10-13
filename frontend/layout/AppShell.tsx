import { BRAND } from '../brand';
import { ReactNode, useEffect, useState } from 'react';
import {
  ShoppingCart,
  Package,
  Receipt,
  Wallet,
  FileText,
  Boxes,
  BarChart3,
  Users,
  UserCog,
  Settings as SettingsIcon,
  Sun,
  Moon,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getUploadsBase } from '../api/client';
import { useAutoLabelAssociation } from '../a11y';
import SyncIndicator from './SyncIndicator';
import UserMenu from './UserMenu';

export type NavView =
  | 'till'
  | 'catalog'
  | 'sales'
  | 'cashup'
  | 'prescriptions'
  | 'inventory'
  | 'analytics'
  | 'customers'
  | 'invoices'
  | 'team'
  | 'settings';

type Props = {
  view: NavView;
  onNavigate: (view: NavView) => void;
  title: string;
  subtitle?: string;
  stats?: ReactNode;
  children: ReactNode;
  todaySales?: string;
  logo?: string;
  navBadges?: Partial<Record<NavView, number>>;
};

const NAV_ICONS: Record<NavView, LucideIcon> = {
  till: ShoppingCart,
  catalog: Package,
  sales: Receipt,
  cashup: Wallet,
  prescriptions: FileText,
  inventory: Boxes,
  analytics: BarChart3,
  customers: Users,
  invoices: ClipboardList,
  team: UserCog,
  settings: SettingsIcon,
};

const NAV_LABELS: Record<NavView, string> = {
  till: 'Point of Sale',
  sales: 'Transactions',
  cashup: 'Cash-up',
  invoices: 'Invoices',
  inventory: 'Inventory',
  catalog: 'Product catalogue',
  prescriptions: 'Prescriptions',
  customers: 'Customers',
  analytics: 'Analytics',
  team: 'Team',
  settings: 'Settings',
};

// Only views that exist in this application are listed. There is deliberately no "Dashboard":
// the app has no dashboard view, and a dead link would be worse than none.
const NAV_GROUPS: { label: string; ids: NavView[] }[] = [
  { label: 'Sales', ids: ['till', 'sales', 'cashup', 'invoices'] },
  { label: 'Pharmacy', ids: ['inventory', 'catalog', 'prescriptions', 'customers'] },
  { label: 'Reports', ids: ['analytics'] },
  { label: 'Administration', ids: ['team', 'settings'] },
];

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('pos-theme') as 'light' | 'dark') || 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('pos-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

// Sidebar collapses to an icon rail. An explicit choice is remembered; with no saved choice it
// starts collapsed on narrower screens (tablets / small laptops) so the work area keeps its room.
function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('pos-nav-collapsed');
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch {
      /* ignore */
    }
    return typeof window !== 'undefined' && window.innerWidth < 1200;
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('pos-nav-collapsed', c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  return { collapsed, toggle };
}

export default function AppShell({
  view,
  onNavigate,
  title,
  subtitle,
  stats,
  children,
  todaySales,
  logo,
  navBadges,
}: Props) {
  const { user, hasPerm, apiInfo } = useAuth();
  const { theme, toggle } = useTheme();
  const { collapsed, toggle: toggleNav } = useNavCollapsed();
  const logoSrc = logo ? `${getUploadsBase()}/${logo}` : BRAND.logo;

  useAutoLabelAssociation();
  useEffect(() => {
    document.title = `${title} · ${BRAND.name}`;
  }, [title]);

  const visibility: Record<NavView, boolean> = {
    till: true,
    catalog: hasPerm('perm_products') || hasPerm('perm_categories'),
    sales: hasPerm('perm_transactions'),
    cashup: hasPerm('perm_transactions'),
    prescriptions: hasPerm('perm_transactions'),
    inventory: hasPerm('perm_products'),
    analytics: hasPerm('perm_transactions'),
    customers: true,
    invoices: hasPerm('perm_invoices'),
    team: hasPerm('perm_users'),
    settings: hasPerm('perm_settings'),
  };

  // Hard role separation (unchanged business rule): a till operator (cashier) sees only the Till,
  // an admin sees everything except the Till, and tech (support) sees every view including the
  // Till. Other roles (pharmacist/manager) keep the permission-driven visibility above.
  const canSee = (id: NavView): boolean => {
    if (user?.role === 'cashier') return id === 'till';
    if (user?.role === 'admin') return id !== 'till';
    if (user?.role === 'tech') return true;
    return visibility[id];
  };

  const groups = NAV_GROUPS.map((g) => ({ ...g, ids: g.ids.filter(canSee) })).filter((g) => g.ids.length > 0);

  return (
    <div className={`app ${collapsed ? 'nav-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="nav">
        <div className="nav-brand">
          <div className="nav-brand-row">
            <img className="nav-logo" src={logoSrc} alt={`${BRAND.name} logo`} />
            <div className="nav-brand-text">
              <strong>{BRAND.name}</strong>
              <span>{BRAND.product}</span>
            </div>
          </div>
        </div>

        <nav className="nav-groups" aria-label="Primary">
          {groups.map((group) => (
            <div className="nav-group" role="group" aria-label={group.label} key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.ids.map((id) => {
                const Icon = NAV_ICONS[id];
                const badge = navBadges?.[id];
                const active = view === id;
                const label = NAV_LABELS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    data-view={id}
                    className={`nav-btn ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? label : undefined}
                    aria-label={collapsed ? `${label}${badge ? `, ${badge} pending` : ''}` : undefined}
                    onClick={() => onNavigate(id)}
                  >
                    <Icon size={18} aria-hidden />
                    <span className="nav-btn-label">{label}</span>
                    {!!badge && (
                      <span className="nav-badge" aria-label={collapsed ? undefined : `${badge} pending`}>
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="nav-spacer" />
        <button
          type="button"
          className="nav-btn nav-collapse-btn"
          onClick={toggleNav}
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
          <span className="nav-btn-label">Collapse</span>
        </button>
        <div className="nav-meta">
          Till #{apiInfo?.till || 1}
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{title}</h1>
            {subtitle && <p className="topbar-subtitle">{subtitle}</p>}
          </div>
          {stats}
          <div className="spacer" />
          <SyncIndicator />
          {todaySales != null && (
            <div className="stat-pill">
              Today <span className="currency">{todaySales}</span>
            </div>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
          </button>
          <UserMenu />
        </header>
        <main className="main" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
