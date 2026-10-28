import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, Notice } from './ui';

// Native <dialog>: focus is trapped, Esc closes and the page behind is inert.
export function Modal({ open, onClose, title, description, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-labelledby="modal-title"
      className={`m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-3xl' : 'max-w-lg'} bg-surface text-ink border border-line
                  rounded-[var(--radius-card)] p-0 shadow-[0_24px_64px_#000a] backdrop:bg-black/60 backdrop:backdrop-blur-[2px]`}>
      {open && (
        <div className="flex flex-col max-h-[88dvh]">
          <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-line">
            <div className="flex-1 min-w-0">
              <h2 id="modal-title" className="font-semibold text-[15px]">{title}</h2>
              {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink p-1 -m-1 rounded"><X className="size-5" /></button>
          </header>
          <div className="px-5 py-4 overflow-y-auto">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-line bg-surface-2/40">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/**
 * A form inside a modal. onSubmit returns an error message to show, or null
 * on success (the modal then closes). Required-field checks happen before.
 */
export function FormModal({ open, onClose, title, description, submitLabel, onSubmit, children, wide, danger }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; submitLabel: string;
  onSubmit: () => Promise<string | null>; children: ReactNode; wide?: boolean; danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) setError(null); }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await onSubmit().catch((x: unknown) => String(x));
    setBusy(false);
    if (err) setError(err); else onClose();
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title} description={description} wide={wide}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <Notice tone="danger">{error}</Notice>}
        {children}
        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-line -mx-5 px-5 -mb-4 pb-3 mt-1 bg-surface-2/40">
          <Button onClick={onClose} disabled={busy} variant="ghost">Cancel</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
