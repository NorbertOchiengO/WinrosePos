import { useEffect, useMemo, useState } from 'react';
import { Plus, Printer } from 'lucide-react';
import { toDataURL as qrToDataURL } from 'qrcode';
import { BRAND } from '../brand';
import { api, Customer, Invoice, InvoiceItem, InvoicePayment, Settings } from '../api/client';
import CustomerSelect from '../components/CustomerSelect';
import Modal from '../components/Modal';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import FormField from '../components/ui/FormField';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge, { StatusTone } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/states';
import { useToast } from '../components/ui/Toast';

type Props = {
  customers: Customer[];
  settings: Settings | null;
  symbol: string;
  onCustomersChanged: () => Promise<void> | void;
};

const STATUS_LABEL: Record<Invoice['status'], string> = {
  unpaid: 'Unpaid',
  partial: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
};

// Red is reserved for genuinely urgent states (overdue). An unpaid invoice that is not yet due
// is informational, a part-paid one needs attention, a settled one is fine.
const STATUS_TONE: Record<Invoice['status'], StatusTone> = {
  unpaid: 'info',
  partial: 'warning',
  paid: 'success',
  void: 'neutral',
};

// 11,540.00 rather than 11540.00 — invoice totals get large enough to need the grouping.
const fmt = (n: number) => n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const emptyLine: InvoiceItem = { name: '', quantity: 1, price: 0 };

export default function InvoicesView({ customers, settings, symbol, onCustomersChanged }: Props) {
  const toast = useToast();
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | Invoice['status'] | 'overdue'>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState('0');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<InvoiceItem[]>([{ ...emptyLine }]);

  const [selected, setSelected] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'mpesa' | 'bank_transfer' | 'other'>('cash');
  const [payReference, setPayReference] = useState('');
  const [confirmVoid, setConfirmVoid] = useState(false);

  const [printable, setPrintable] = useState<{ invoice: Invoice; customer?: Customer } | null>(null);
  const [printQr, setPrintQr] = useState('');

  const customerName = (id: number) => customers.find((c) => c.id === id)?.name || `Customer #${id}`;

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setAllInvoices(await api.getInvoices());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const todayIso = new Date().toISOString().slice(0, 10);
  const isOverdue = (inv: Invoice) =>
    (inv.status === 'unpaid' || inv.status === 'partial') && !!inv.due_date && inv.due_date < todayIso;

  const invoices = useMemo(() => {
    if (!statusFilter) return allInvoices;
    if (statusFilter === 'overdue') return allInvoices.filter(isOverdue);
    return allInvoices.filter((i) => i.status === statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allInvoices, statusFilter, todayIso]);

  const summary = useMemo(() => {
    const open = allInvoices.filter((i) => i.status === 'unpaid' || i.status === 'partial');
    const overdue = open.filter(isOverdue);
    return {
      outstanding: open.reduce((sum, i) => sum + i.balance, 0),
      openCount: open.length,
      overdueTotal: overdue.reduce((sum, i) => sum + i.balance, 0),
      overdueCount: overdue.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allInvoices, todayIso]);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.price) || 0), 0),
    [lines]
  );

  const openCreate = () => {
    setCreateError(null);
    setShowCreate(true);
  };

  const closeCreate = () => {
    setShowCreate(false);
    setCreateError(null);
  };

  const resetCreateForm = () => {
    setCustomerId('0');
    setDueDate('');
    setNotes('');
    setLines([{ ...emptyLine }]);
  };

  const updateLine = (idx: number, patch: Partial<InvoiceItem>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const submitInvoice = async () => {
    setCreateError(null);
    const custId = parseInt(customerId, 10);
    if (!custId) {
      setCreateError('Select a customer to bill — invoices cannot be raised against a walk-in sale.');
      return;
    }
    const items = lines.filter((l) => l.name.trim() && Number(l.quantity) > 0);
    if (!items.length) {
      setCreateError('Add at least one line item with a name and quantity.');
      return;
    }
    setBusy(true);
    try {
      const created = await api.createInvoice({
        customerId: custId,
        items,
        subtotal,
        total: subtotal,
        notes,
        dueDate: dueDate || undefined,
      });
      closeCreate();
      resetCreateForm();
      await load();
      toast.success(`Invoice ${created.invoice_number} created for ${customerName(custId)}.`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create invoice');
    } finally {
      setBusy(false);
    }
  };

  const openInvoice = async (inv: Invoice) => {
    setSelected(inv);
    setPaymentError(null);
    setPayAmount('');
    setPayReference('');
    try {
      setPayments(await api.getInvoicePayments(inv.id));
    } catch {
      setPayments([]);
    }
  };

  const refreshSelected = async (id: number) => {
    const fresh = await api.getInvoice(id);
    setSelected(fresh);
    setAllInvoices((prev) => prev.map((i) => (i.id === id ? fresh : i)));
    setPayments(await api.getInvoicePayments(id).catch(() => []));
    return fresh;
  };

  const submitPayment = async () => {
    if (!selected) return;
    setPaymentError(null);
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      setPaymentError('Enter a payment amount greater than zero.');
      return;
    }
    if (amount > selected.balance + 0.01) {
      setPaymentError(`That is more than the outstanding balance of ${symbol}${fmt(selected.balance)}.`);
      return;
    }
    setBusy(true);
    try {
      // The server is the source of truth: the invoice is only shown as paid once the API confirms.
      await api.recordInvoicePayment(selected.id, { amount, method: payMethod, reference: payReference });
      setPayAmount('');
      setPayReference('');
      const fresh = await refreshSelected(selected.id);
      toast.success(
        fresh.status === 'paid'
          ? `Payment recorded — invoice ${fresh.invoice_number} is now fully paid.`
          : `Payment of ${symbol}${fmt(amount)} recorded. ${symbol}${fmt(fresh.balance)} still outstanding.`
      );
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setBusy(false);
    }
  };

  const doVoid = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.voidInvoice(selected.id);
      const number = selected.invoice_number;
      await refreshSelected(selected.id);
      await load();
      setConfirmVoid(false);
      toast.success(`Invoice ${number} voided.`);
    } catch (err) {
      setConfirmVoid(false);
      toast.error(err instanceof Error ? err.message : 'Failed to void invoice');
    } finally {
      setBusy(false);
    }
  };

  const openPrint = async (inv: Invoice) => {
    const customer = customers.find((c) => c.id === inv.customer_id);
    setPrintable({ invoice: inv, customer });
    try {
      const qr = await qrToDataURL(`${inv.invoice_number}|${symbol}${inv.total.toFixed(2)}|${inv.issued_date}`, {
        width: 192,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setPrintQr(qr);
    } catch {
      setPrintQr('');
    }
    setTimeout(() => window.print(), 80);
  };

  return (
    <div>
      <div className="panel" style={{ padding: '1rem' }}>
        <PageHeader
          title="Credit invoices"
          description="Bill a client now, collect later, and track what is still owed."
          actions={
            <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={openCreate}>
              New invoice
            </Button>
          }
        />

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div className="invoice-summary">
            <span>Outstanding</span>
            <strong>
              {symbol}
              {fmt(summary.outstanding)}
            </strong>
            <small>
              {summary.openCount} open invoice{summary.openCount === 1 ? '' : 's'}
            </small>
          </div>
          <div className={`invoice-summary ${summary.overdueCount ? 'is-overdue' : ''}`}>
            <span>Overdue</span>
            <strong>
              {symbol}
              {fmt(summary.overdueTotal)}
            </strong>
            <small>{summary.overdueCount} past due date</small>
          </div>
        </div>

        <FormField label="Filter by status">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} style={{ maxWidth: 220 }}>
            <option value="">All</option>
            <option value="overdue">Overdue</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
        </FormField>

        {loading && <LoadingState label="Loading invoices…" />}
        {!loading && loadError && <ErrorState title="Could not load invoices" message={loadError} onRetry={() => load()} />}
        {!loading && !loadError && !invoices.length && (
          <EmptyState
            title={allInvoices.length ? 'No invoices match this filter' : 'No invoices yet'}
            description={
              allInvoices.length
                ? 'Try a different status filter.'
                : 'Create a credit invoice to bill a client now and record their payments as they come in.'
            }
            action={
              !allInvoices.length ? (
                <Button variant="primary" onClick={openCreate}>
                  Create the first invoice
                </Button>
              ) : undefined
            }
          />
        )}
        {!loading && !loadError && invoices.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <caption className="sr-only">Credit invoices</caption>
              <thead>
                <tr>
                  <th scope="col">Invoice #</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Issued</th>
                  <th scope="col">Due</th>
                  <th scope="col">Total</th>
                  <th scope="col">Balance</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.invoice_number}</td>
                    <td>{customerName(inv.customer_id)}</td>
                    <td>{inv.issued_date}</td>
                    <td style={isOverdue(inv) ? { color: 'var(--danger-ink)', fontWeight: 700 } : undefined}>{inv.due_date || '—'}</td>
                    <td>
                      {symbol}
                      {fmt(inv.total)}
                    </td>
                    <td>
                      {symbol}
                      {fmt(inv.balance)}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <StatusBadge tone={STATUS_TONE[inv.status]}>{STATUS_LABEL[inv.status]}</StatusBadge>
                        {isOverdue(inv) && <StatusBadge tone="danger">Overdue</StatusBadge>}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Button size="sm" onClick={() => openInvoice(inv)} aria-label={`Open invoice ${inv.invoice_number}`}>
                        Open
                      </Button>{' '}
                      <Button size="sm" icon={<Printer size={14} aria-hidden />} onClick={() => openPrint(inv)} aria-label={`Print invoice ${inv.invoice_number}`}>
                        Print
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create invoice */}
      <Modal
        title="New invoice"
        open={showCreate}
        onClose={closeCreate}
        footer={
          <>
            <Button onClick={closeCreate} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitInvoice} loading={busy}>
              {busy ? 'Creating…' : 'Create invoice'}
            </Button>
          </>
        }
      >
        {createError && (
          <div className="error" role="alert">
            {createError}
          </div>
        )}

        <div className="field">
          <label id="bill-to-label">Bill to</label>
          <CustomerSelect customers={customers} value={customerId} onChange={setCustomerId} onCustomersChanged={onCustomersChanged} />
          <p className="field-hint">Walk-in cannot be billed — select or add a named customer.</p>
        </div>

        <FormField label="Due date (optional)">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormField>

        <fieldset className="line-items">
          <legend>Line items</legend>
          {lines.map((line, idx) => (
            <div key={idx} className="line-item">
              <input
                placeholder="Item"
                aria-label={`Item name, line ${idx + 1}`}
                value={line.name}
                onChange={(e) => updateLine(idx, { name: e.target.value })}
                style={{ flex: 2 }}
              />
              <input
                type="number"
                min={1}
                placeholder="Qty"
                aria-label={`Quantity, line ${idx + 1}`}
                value={line.quantity}
                onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Price"
                aria-label={`Unit price, line ${idx + 1}`}
                value={line.price}
                onChange={(e) => updateLine(idx, { price: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <Button
                variant="ghost"
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                disabled={lines.length === 1}
                aria-label={`Remove line ${idx + 1}`}
              >
                ×
              </Button>
            </div>
          ))}
          <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}>
            Add line
          </Button>
        </fieldset>

        <FormField label="Notes">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        <div className="kv-row">
          <strong>Total</strong>
          <strong>
            {symbol}
            {fmt(subtotal)}
          </strong>
        </div>
      </Modal>

      {/* Invoice detail / record payment */}
      <Modal title={selected ? `Invoice ${selected.invoice_number}` : 'Invoice'} open={!!selected} onClose={() => setSelected(null)}>
        {selected && (
          <>
            <div className="kv-row">
              <span>Customer</span>
              <strong>{customerName(selected.customer_id)}</strong>
            </div>
            <div className="kv-row">
              <span>Total</span>
              <strong>
                {symbol}
                {fmt(selected.total)}
              </strong>
            </div>
            <div className="kv-row">
              <span>Paid so far</span>
              <strong>
                {symbol}
                {fmt(selected.amount_paid)}
              </strong>
            </div>
            <div className="kv-row">
              <strong>Balance due</strong>
              <strong>
                {symbol}
                {fmt(selected.balance)}
              </strong>
            </div>
            <div className="kv-row">
              <span>Status</span>
              <span style={{ display: 'inline-flex', gap: '0.35rem' }}>
                <StatusBadge tone={STATUS_TONE[selected.status]}>{STATUS_LABEL[selected.status]}</StatusBadge>
                {isOverdue(selected) && <StatusBadge tone="danger">Overdue</StatusBadge>}
              </span>
            </div>

            <h4 style={{ marginBottom: '0.4rem' }}>Payment history</h4>
            {payments.length ? (
              <table className="table">
                <caption className="sr-only">Payments recorded against this invoice</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Method</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{new Date(p.paid_at).toLocaleString()}</td>
                      <td>{p.method}</td>
                      <td>{p.reference || '—'}</td>
                      <td>
                        {symbol}
                        {fmt(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No payments recorded yet" />
            )}

            {selected.status !== 'paid' && selected.status !== 'void' && (
              <>
                <h4 style={{ marginBottom: '0.4rem', marginTop: '1rem' }}>Record a payment</h4>
                {paymentError && (
                  <div className="error" role="alert">
                    {paymentError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <FormField label="Amount">
                      <input
                        type="number"
                        step="0.01"
                        placeholder={`Up to ${symbol}${fmt(selected.balance)}`}
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                      />
                    </FormField>
                  </div>
                  <FormField label="Method">
                    <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="mpesa">M-Pesa</option>
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="other">Other</option>
                    </select>
                  </FormField>
                </div>
                <FormField label="Reference" hint="For example the M-Pesa confirmation code.">
                  <input value={payReference} onChange={(e) => setPayReference(e.target.value)} />
                </FormField>
                <Button variant="primary" onClick={submitPayment} loading={busy}>
                  {busy ? 'Recording…' : 'Record payment'}
                </Button>
              </>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <Button icon={<Printer size={15} aria-hidden />} onClick={() => openPrint(selected)}>
                Print invoice
              </Button>
              {selected.amount_paid === 0 && selected.status !== 'void' && (
                <Button variant="ghost" onClick={() => setConfirmVoid(true)} disabled={busy}>
                  Void invoice
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmVoid}
        tone="danger"
        title="Void this invoice?"
        message={
          <>
            Invoice <strong>{selected?.invoice_number}</strong> will be marked void and can no longer accept payments. This cannot be
            undone.
          </>
        }
        confirmLabel="Void invoice"
        busy={busy}
        onConfirm={doVoid}
        onCancel={() => setConfirmVoid(false)}
      />

      {/* Print layout — reuses the same #receipt-print print stylesheet as the Till receipt */}
      <div id="receipt-print" style={{ display: printable ? 'block' : 'none' }}>
        {printable && (
          <>
            <pre className="receipt">
              {[
                settings?.store || BRAND.storeName,
                settings?.address_one || '',
                settings?.contact || '',
                '--------------------------------',
                `Invoice ${printable.invoice.invoice_number}`,
                `Date ${printable.invoice.issued_date}`,
                printable.invoice.due_date ? `Due ${printable.invoice.due_date}` : '',
                `Bill to ${printable.customer?.name || `Customer #${printable.invoice.customer_id}`}`,
                '--------------------------------',
                ...printable.invoice.items.map(
                  (i) => `${i.quantity} x ${i.name}`.padEnd(22) + `${symbol}${fmt(i.price * i.quantity)}`
                ),
                '--------------------------------',
                `TOTAL ${symbol}${fmt(printable.invoice.total)}`,
                `Paid ${symbol}${fmt(printable.invoice.amount_paid)}`,
                `Balance ${symbol}${fmt(printable.invoice.balance)}`,
                `Status ${STATUS_LABEL[printable.invoice.status]}`,
                settings?.footer || 'Thank you',
                new Date().toLocaleString(),
              ]
                .filter(Boolean)
                .join('\n')}
            </pre>
            {printQr && <img className="receipt-qr" src={printQr} alt="Invoice QR code" />}
          </>
        )}
      </div>
    </div>
  );
}
