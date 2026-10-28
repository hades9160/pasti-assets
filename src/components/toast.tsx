import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';

interface Toast { id: number; tone: 'ok' | 'error'; text: string }
const ToastContext = createContext<(tone: Toast['tone'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 items-end pointer-events-none no-print" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex items-start gap-2.5 max-w-sm w-full sm:w-auto rounded-[var(--radius-ctl)] border border-line
                       bg-surface-2 px-3.5 py-2.5 shadow-[0_12px_32px_#0009] text-[13.5px] animate-[toast-in_0.25s_ease-out]">
            {t.tone === 'ok' ? <CircleCheck className="size-[18px] text-ok shrink-0 mt-px" aria-hidden />
              : <TriangleAlert className="size-[18px] text-danger shrink-0 mt-px" aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <style>{'@keyframes toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'}</style>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
