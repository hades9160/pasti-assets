import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { friendlyError, supabase } from './supabase';
import { buildIndex, type Index } from './rules';
import { todayISO } from './dates';
import type { Dataset } from './types';

// The whole register is a few thousand rows at most, so it is loaded once and
// every page filters/sorts in memory. Calculated columns come from rules.ts.

const TABLES: [keyof Dataset, string, string][] = [
  ['employees', 'employees', 'full_name'],
  ['departments', 'departments', 'sort_order'],
  ['deviceTypes', 'device_types', 'sort_order'],
  ['listItems', 'list_items', 'sort_order'],
  ['assets', 'assets', 'asset_code'],
  ['byod', 'byod_devices', 'byod_code'],
  ['assignments', 'assignments', 'date_issued'],
  ['badges', 'badges', 'row_no'],
  ['accessories', 'accessories', 'date_issued'],
  ['gateMovements', 'gate_movements', 'created_at'],
];

const PAGE = 1000;  // Supabase returns at most 1000 rows per request

async function fetchAll(table: string, order: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').order(order).order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

const EMPTY: Dataset = {
  employees: [], departments: [], deviceTypes: [], listItems: [], assets: [], byod: [], assignments: [],
  badges: [], accessories: [], gateMovements: [],
};

interface DataState {
  ds: Dataset;
  ix: Index;
  today: string;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [ds, setDs] = useState<Dataset>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(todayISO());

  const reload = useCallback(async () => {
    try {
      const parts = await Promise.all(TABLES.map(([, table, order]) => fetchAll(table, order)));
      const next = { ...EMPTY };
      TABLES.forEach(([key], i) => { (next as Record<string, unknown>)[key] = parts[i]; });
      setDs(next);
      setToday(todayISO());
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Keep "today" right if the app stays open past midnight.
  useEffect(() => {
    const t = setInterval(() => setToday(todayISO()), 60_000);
    return () => clearInterval(t);
  }, []);

  const ix = useMemo(() => buildIndex(ds), [ds]);
  const value = useMemo(() => ({ ds, ix, today, loading, error, reload }), [ds, ix, today, loading, error, reload]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}

/** Record an export or a printed form in the activity log (best effort). */
export async function logEvent(action: 'EXPORT' | 'PRINT', label: string, details?: Record<string, unknown>) {
  await supabase.rpc('log_event', { p_action: action, p_label: label, p_details: details ?? null });
}
