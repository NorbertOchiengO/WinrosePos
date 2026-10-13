import { ReactNode } from 'react';
import Modal from '../Modal';
import Button from './Button';

type Props = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for destructive / irreversible actions (void, delete, wipe). */
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// In-app replacement for window.confirm: matches the theme, is keyboard/screen-reader accessible,
// and makes the consequence explicit. Cancel is the first/default action for destructive prompts.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal
      title={title}
      open={open}
      onClose={onCancel}
      compact
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
    </Modal>
  );
}
