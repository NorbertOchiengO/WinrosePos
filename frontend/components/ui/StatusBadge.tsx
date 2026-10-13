import { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Info, MinusCircle, XCircle } from 'lucide-react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'pending';

const ICONS = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
  neutral: MinusCircle,
  pending: Clock,
};

// Status is never conveyed by colour alone: every badge carries an icon AND the text label the
// caller supplies (children are required for that reason).
export default function StatusBadge({ tone, children, icon = true }: { tone: StatusTone; children: ReactNode; icon?: boolean }) {
  const Icon = ICONS[tone];
  return (
    <span className={`status-badge tone-${tone}`}>
      {icon && <Icon size={13} aria-hidden />}
      {children}
    </span>
  );
}
