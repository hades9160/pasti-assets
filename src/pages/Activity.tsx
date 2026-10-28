import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { logEvent } from '../lib/data';
import { friendlyError, supabase } from '../lib/supabase';
import { formatDateTime, todayISO } from '../lib/dates';
import { exportRows } from '../lib/export';
import type { ActivityEntry } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';
import { Button, Card, Input, Notice, PageHeader, Pill, SearchInput, Select, Spinner, Toolbar } from '../components/ui';

const TABLES: Record<string, string> = {
  assets: 'Asset', byod_devices: 'Personal device', badges: 'Gate pass', gate_movements: 'Gate movement', employees: 'Employee',
  assignments: 'Assignment', accessories: 'Accessory', departments: 'Department', device_types: 'Device type', list_items: 'List item',
  profiles: 'User',
};
export const tableLabel = (t: string | null) => (t ? TABLES[t] ?? t : '');
const ACTIONS: Record<string, string> = { CREATE: 'Added', UPDATE: 'Changed', DELETE: 'Deleted', IMPORT: 'Imported', EXPORT: 'Exported', PRINT: 'Printed' };
export const actionLabel = (a: string) => ACTIONS[a] ?? a;

const HIDDEN = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'row_no']);
function describeChanges(e: ActivityEntry): string {
  if (!e.changes) return '';
  if (e.action !== 'UPDATE') return Object.entries(e.changes).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
  return Object.entries(e.changes as Record<string, { from: unknown; to: unknown }>)
    .filter(([k]) => !HIDDEN.has(k))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v.from ?? '—'} → ${v.to ?? '—'}`).join('; ');
}

export function Activity() {
  const [rows, setRows] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [table, setTable] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    let query = supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(2000);
    if (action) query = query.eq('action', action);
    if (table) query = query.eq('table_name', table);
    if (from) query = query.gte('created_at', `${from}T00:00:00+08:00`);
    if (to) query = query.lte('created_at', `${to}T23:59:59.999+08:00`);
    const { data, error: err } = await query;
    if (err) setError(friendlyError(err)); else { setRows(data as ActivityEntry[]); setError(null); }
  }, [action, table, from, to]);
  useEffect(() => { void load(); }, [load]);

  const needle = q.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) => !needle || [r.user_email, r.record_label, describeChanges(r)].some((x) => x?.toLowerCase().includes(needle)));

  const columns: Column<ActivityEntry>[] = [
    { key: 'when', header: 'When', sort: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.created_at)}</span> },
    { key: 'who', header: 'Who', sort: (r) => r.user_email, cell: (r) => r.user_email ?? '—' },
    { key: 'action', header: 'Action', sort: (r) => r.action, cell: (r) => <Pill tone={r.action === 'DELETE' ? 'danger' : r.action === 'CREATE' ? 'ok' : r.action === 'UPDATE' ? 'neutral' : 'info'}>{actionLabel(r.action)}</Pill> },
    { key: 'what', header: 'Record', sort: (r) => r.record_label, cell: (r) => <span>{tableLabel(r.table_name)} <span className="code text-ink">{r.record_label}</span></span> },
    { key: 'details', header: 'Details', cell: (r) => <span className="text-ink-2 text-[13px] line-clamp-2 max-w-xl block" title={describeChanges(r)}>{describeChanges(r)}</span> },
  ];

  async function doExport() {
    await exportRows(`activity-log-${todayISO()}.xlsx`, 'Activity Log', [
      { header: 'When', value: (r: ActivityEntry) => formatDateTime(r.created_at), width: 22 },
      { header: 'Who', value: (r) => r.user_email, width: 26 },
      { header: 'Action', value: (r) => actionLabel(r.action) },
      { header: 'Record type', value: (r) => tableLabel(r.table_name), width: 16 },
      { header: 'Record', value: (r) => r.record_label, width: 28 },
      { header: 'Details', value: describeChanges, width: 80 },
    ], visible);
    await logEvent('EXPORT', 'Activity Log', { rows: visible.length });
  }

  return (
    <>
      <PageHeader title="Activity Log" description="Every change, import, export and printed form, recorded by the database with who did it and when. Entries cannot be edited or deleted."
        actions={<Button icon={Download} onClick={() => void doExport()} disabled={!visible.length}>Export to Excel</Button>} />
      {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
      <Card padded={false}>
        <div className="p-3 pb-0"><Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Search person, record, details…" />
          <Select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} className="w-auto">
            <option value="">All actions</option>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Record type" value={table} onChange={(e) => setTable(e.target.value)} className="w-auto">
            <option value="">All record types</option>
            {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-[13px] text-muted">From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="From date" /></label>
          <label className="flex items-center gap-2 text-[13px] text-muted">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="To date" /></label>
        </Toolbar></div>
        {rows === null ? <Spinner /> : (
          <DataTable rows={visible} columns={columns} rowKey={(r) => String(r.id)} initialSort={{ key: 'when', dir: 'desc' }} pageSize={50}
            empty={{ title: 'Nothing recorded for these filters' }} />
        )}
      </Card>
      {rows && rows.length === 2000 && <p className="text-[12px] text-muted mt-2">Showing the latest 2,000 entries. Narrow the dates to see older ones.</p>}
    </>
  );
}
