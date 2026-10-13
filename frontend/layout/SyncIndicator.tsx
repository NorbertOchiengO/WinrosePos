import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, HardDrive, Loader2, UploadCloud } from 'lucide-react';

// Shape returned by the Electron main process (`get-sync-status` IPC → sync-engine getStatus()).
export type SyncStatus = {
  enabled: boolean;
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  lastResult: { at?: string } | null;
  lastError: string | null;
};

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type SyncView = { tone: Tone; label: string; detail: string };

// Pure mapping from the real sync status to what the cashier sees. Priority matters: being
// offline outranks a stale error, and "Synced" is only ever shown when the engine is enabled,
// online, idle, error-free and has nothing waiting — never as a default.
export function describeSync(status: SyncStatus | null | undefined): SyncView {
  if (status === undefined) {
    return { tone: 'neutral', label: 'Local mode', detail: 'Sync status is not available in this window. Sales are saved on this device.' };
  }
  if (status === null) {
    return { tone: 'neutral', label: 'Checking…', detail: 'Reading sync status.' };
  }
  if (!status.enabled) {
    return { tone: 'neutral', label: 'Local only', detail: 'Cloud sync is not configured on this till. Everything is saved on this device.' };
  }
  const waiting = status.pendingCount;
  const waitingText = waiting === 1 ? '1 change' : `${waiting} changes`;
  if (!status.online) {
    return {
      tone: 'warning',
      label: waiting ? `Offline · ${waiting} queued` : 'Offline',
      detail: waiting ? `${waitingText} saved on this device, waiting to sync when the connection returns.` : 'No connection. Everything is saved on this device.',
    };
  }
  if (status.syncing) return { tone: 'info', label: 'Syncing…', detail: 'Sending changes to the cloud.' };
  if (status.lastError) {
    return { tone: 'danger', label: 'Sync error', detail: `${status.lastError}${waiting ? ` — ${waitingText} not yet synced.` : ''}` };
  }
  if (waiting) return { tone: 'warning', label: `${waiting} to sync`, detail: `${waitingText} saved on this device, waiting for the next sync.` };
  const at = status.lastResult?.at ? new Date(status.lastResult.at) : null;
  return {
    tone: 'success',
    label: 'Synced',
    detail: at && !Number.isNaN(at.getTime()) ? `All changes synced. Last sync ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'All changes synced.',
  };
}

const ICON = { success: CheckCircle2, warning: CloudOff, danger: AlertTriangle, info: Loader2, neutral: HardDrive };

export function useSyncStatus(intervalMs = 8000): SyncStatus | null | undefined {
  // undefined = this window has no sync bridge (plain browser); null = bridge present, not read yet.
  const bridge = typeof window !== 'undefined' ? (window.pos as { getSyncStatus?: () => Promise<SyncStatus> } | undefined) : undefined;
  const supported = Boolean(bridge?.getSyncStatus);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    if (!supported) return undefined;
    let alive = true;
    const read = async () => {
      try {
        const s = await bridge!.getSyncStatus!();
        if (alive) setStatus(s);
      } catch {
        // Could not read status — report it as unknown rather than pretending all is well.
        if (alive) setStatus({ enabled: true, online: false, syncing: false, pendingCount: 0, lastResult: null, lastError: 'Could not read sync status' });
      }
    };
    read();
    const t = window.setInterval(read, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, intervalMs]);

  return supported ? status : undefined;
}

export default function SyncIndicator() {
  const status = useSyncStatus();
  const view = describeSync(status);
  const Icon = view.label === 'Syncing…' ? Loader2 : view.tone === 'warning' && status && status.online ? UploadCloud : ICON[view.tone];
  return (
    <div className={`sync-pill tone-${view.tone}`} role="status" aria-live="polite" title={view.detail}>
      <Icon size={15} className={view.label === 'Syncing…' ? 'spin' : undefined} aria-hidden />
      <span>{view.label}</span>
      <span className="sr-only">. {view.detail}</span>
    </div>
  );
}
