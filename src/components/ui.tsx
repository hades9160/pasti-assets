import { Link } from 'react-router-dom';
import { CircleCheck, Info, LoaderCircle, Search, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-strong shadow-[0_2px_10px_#4c7bf040]',
  secondary: 'bg-surface-2 text-ink border border-line hover:border-line-strong hover:bg-surface-3',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-ctl)] font-medium whitespace-nowrap',
        'transition-[background-color,border-color,filter,transform] duration-150 active:translate-y-px',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        VARIANTS[variant], className,
      )}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ to, icon: Icon, children, variant = 'secondary', size = 'md' }:
  { to: string; icon?: LucideIcon; children: ReactNode; variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <Link to={to} className={cx(
      'inline-flex items-center justify-center gap-2 rounded-[var(--radius-ctl)] font-medium whitespace-nowrap transition-colors',
      size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm', VARIANTS[variant],
    )}>
      {Icon && <Icon className="size-4" aria-hidden />}{children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function Field({ label, htmlFor, required, hint, error, children, className }: {
  label: string; htmlFor: string; required?: boolean; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}{required && <span className="text-danger ml-0.5" aria-hidden>*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {error ? <p id={`${htmlFor}-error`} className="text-[12.5px] text-danger" role="alert">{error}</p>
        : hint ? <p id={`${htmlFor}-hint`} className="text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ invalid, ...p }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...p} aria-invalid={invalid || undefined} className={cx('ctl', p.className)} />;
}
export function Select({ invalid, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select {...p} aria-invalid={invalid || undefined} className={cx('ctl', p.className)}>{children}</select>;
}
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx('ctl', p.className)} />;
}

export function SearchInput({ value, onChange, placeholder, label = 'Search' }:
  { value: string; onChange: (v: string) => void; placeholder: string; label?: string }) {
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" aria-hidden />
      <input type="search" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} className="ctl pl-9" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------
export function PageHeader({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="text-ink-2 mt-1 max-w-3xl">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className, padded = true }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean;
}) {
  return (
    <section className={cx('card min-w-0', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
          <div className="min-w-0">
            {title && <h2 className="font-semibold text-ink">{title}</h2>}
            {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 mb-3">{children}</div>;
}

export function EmptyState({ icon: Icon = Info, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6">
      <div className="size-11 rounded-full bg-surface-2 border border-line grid place-items-center mb-3">
        <Icon className="size-5 text-muted" aria-hidden />
      </div>
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="text-muted mt-1 max-w-md text-[13px]">{children}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted py-10 justify-center" role="status">
      <LoaderCircle className="size-5 animate-spin" aria-hidden />{label}
    </div>
  );
}

export function Notice({ tone = 'info', children, onClose }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode; onClose?: () => void }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'info' ? Info : TriangleAlert;
  const tones = {
    info: 'bg-info-soft border-info/30 text-ink', warn: 'bg-warn-soft border-warn/30 text-ink',
    danger: 'bg-danger-soft border-danger/40 text-ink', ok: 'bg-ok-soft border-ok/30 text-ink',
  };
  const iconTone = { info: 'text-info', warn: 'text-warn', danger: 'text-danger', ok: 'text-ok' };
  return (
    <div className={cx('flex gap-3 items-start rounded-[var(--radius-ctl)] border px-3.5 py-3 text-[13.5px]', tones[tone])}
      role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className={cx('size-[18px] mt-px shrink-0', iconTone[tone])} aria-hidden />
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && <button onClick={onClose} aria-label="Dismiss" className="text-muted hover:text-ink"><X className="size-4" /></button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pills and status
// ---------------------------------------------------------------------------
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'primary';
const TONES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok border-ok/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  danger: 'bg-danger-soft text-danger border-danger/30',
  info: 'bg-info-soft text-info border-info/25',
  primary: 'bg-primary-soft text-primary border-primary/30',
  neutral: 'bg-surface-2 text-ink-2 border-line',
};

export function Pill({ tone = 'neutral', children, title, strike }: { tone?: Tone; children: ReactNode; title?: string; strike?: boolean }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium whitespace-nowrap',
      TONES[tone], strike && 'line-through opacity-70')}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  Active: 'ok', 'Under Repair': 'warn', 'Returned to IT': 'info', 'Lost/Stolen': 'danger', Decommissioned: 'neutral',
  Void: 'neutral', Revoked: 'neutral', Superseded: 'neutral', 'Lost/Damaged': 'danger', Inactive: 'neutral',
  'Employee Separated': 'neutral', 'On Leave': 'warn', 'Resigned/Separated': 'neutral', Issued: 'primary',
  Returned: 'neutral', 'Current Holder': 'primary',
};

export function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted">—</span>;
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'} strike={status === 'Void'}>{status}</Pill>;
}

/** Renders workbook-style check messages: 'OK', '⚠ ...' lists, or em-dash states. */
export function CheckList({ items, okText = 'OK' }: { items: string[]; okText?: string | null }) {
  if (!items.length) return okText ? <Pill tone="ok">{okText}</Pill> : <span className="text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((m) => <Pill key={m} tone={/DO NOT ALLOW|EXPIRED|Lost|Duplicate|Not cleared/i.test(m) ? 'danger' : 'warn'}>{m}</Pill>)}
    </div>
  );
}

export function CheckText({ text }: { text: string }) {
  if (!text || text === '—') return <span className="text-muted">—</span>;
  if (text.startsWith('⚠')) return <CheckList items={[text]} />;
  if (text.startsWith('— (')) return <span className="text-muted">{text}</span>;
  if (/✓$|^OK|^Valid$/.test(text)) return <Pill tone="ok">{text}</Pill>;
  return <span className="text-ink-2">{text}</span>;
}

// ---------------------------------------------------------------------------
// Dashboard stat card
// ---------------------------------------------------------------------------
export function StatCard({ icon: Icon, label, value, hint, tone = 'primary', to }: {
  icon: LucideIcon; label: string; value: number | string; hint?: string; tone?: Tone; to?: string;
}) {
  const body = (
    <div className="card p-4 flex items-start gap-3.5 h-full transition-[border-color,transform] duration-200 hover:border-line-strong hover:-translate-y-0.5">
      <div className={cx('size-10 rounded-[10px] grid place-items-center border shrink-0', TONES[tone])}>
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-tight text-ink tabular-nums">{value}</div>
        <div className="text-[13px] font-medium text-ink-2">{label}</div>
        {hint && <div className="text-[12px] text-muted mt-0.5">{hint}</div>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-[var(--radius-card)]">{body}</Link> : body;
}

/** Key/value grid for detail pages. */
export function Details({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12px] uppercase tracking-wide text-muted">{k}</dt>
          <dd className="text-ink mt-0.5 break-words">{v === '' || v == null ? <span className="text-muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}
