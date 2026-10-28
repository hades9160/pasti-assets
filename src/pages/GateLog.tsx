import { useMemo, useState, type FormEvent } from 'react';
import { Download, LogIn, LogOut, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react';
import { logEvent, useData } from '../lib/data';
import { useAuth } from '../lib/auth';
import { friendlyError, supabase } from '../lib/supabase';
import { badgeDevice, employeeName, gateAlert, latestBadgeRow } from '../lib/rules';
import { formatDate, formatTime, isValidISODate, nowTimeHHMM, todayISO } from '../lib/dates';
import { exportRows } from '../lib/export';
import type { GateMovement } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';
import { Button, Card, CheckText, cx, Field, Input, Notice, PageHeader, SearchInput, Select, Toolbar } from '../components/ui';
import { useToast } from '../components/toast';

const GUARD_KEY = 'pasti.gate.guard';
const readGuard = () => { try { return localStorage.getItem(GUARD_KEY) ?? ''; } catch { return ''; } };

export function GateLog() {
  const { ds, ix, today, reload } = useData();
  const { canEdit } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [guard, setGuard] = useState(readGuard);
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState<'IN' | 'OUT' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [onlyAlerts, setOnlyAlerts] = useState('');

  const trimmed = code.trim().toUpperCase();
  const badge = trimmed ? latestBadgeRow(ix, trimmed) : undefined;
  const verdict = trimmed ? gateAlert(ix, trimmed, isValidISODate(date) ? date : today) : '';
  const device = badge ? badgeDevice(ix, badge) : null;

  async function log(direction: 'IN' | 'OUT', e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!trimmed) { setError('Type or pick the Badge ID shown on the pass.'); return; }
    if (!guard.trim()) { setError('Enter the guard on duty.'); return; }
    if (!isValidISODate(date)) { setError('Enter a valid date.'); return; }
    setBusy(direction);
    const { data, error: err } = await supabase.rpc('log_gate_movement', {
      p_badge_code: trimmed, p_direction: direction, p_date: date, p_time: time || nowTimeHHMM(), p_guard: guard.trim(), p_remarks: remarks || null,
    });
    setBusy(null);
    if (err) { setError(friendlyError(err)); return; }
    try { localStorage.setItem(GUARD_KEY, guard.trim()); } catch { /* private mode */ }
    const alert = (data as GateMovement).alert;
    toast(alert === 'OK' ? 'ok' : 'error', `${direction} logged for ${trimmed}: ${alert === 'OK' ? 'allowed' : alert}`);
    setCode(''); setRemarks(''); setTime('');
    await reload();
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ds.gateMovements.filter((g) => {
      if (from && g.moved_on < from) return false;
      if (to && g.moved_on > to) return false;
      if (onlyAlerts && g.alert === 'OK') return false;
      if (!needle) return true;
      const b = latestBadgeRow(ix, g.badge_code);
      return [g.badge_code, g.guard_name, b && employeeName(ix, b.holder_id), b && badgeDevice(ix, b).code].some((x) => x?.toLowerCase().includes(needle));
    });
  }, [ds.gateMovements, ix, from, to, q, onlyAlerts]);

  const holderOf = (g: GateMovement) => { const b = latestBadgeRow(ix, g.badge_code); return b ? employeeName(ix, b.holder_id) : ''; };
  const deviceOf = (g: GateMovement) => { const b = latestBadgeRow(ix, g.badge_code); return b ? badgeDevice(ix, b) : null; };

  const columns: Column<GateMovement>[] = [
    { key: 'when', header: 'Date & time', sort: (g) => g.moved_on + g.moved_time, cell: (g) => <span className="whitespace-nowrap">{formatDate(g.moved_on)} · {formatTime(g.moved_time)}</span> },
    { key: 'dir', header: 'IN / OUT', sort: (g) => g.direction, cell: (g) => <span className={cx('font-semibold', g.direction === 'IN' ? 'text-info' : 'text-accent')}>{g.direction}</span> },
    { key: 'badge', header: 'Badge ID', sort: (g) => g.badge_code, cell: (g) => <span className="code">{g.badge_code}</span> },
    { key: 'holder', header: 'Holder', sort: holderOf, cell: (g) => holderOf(g) || <span className="text-muted">Unknown</span> },
    { key: 'device', header: 'Device', minWidth: 'md', cell: (g) => { const d = deviceOf(g); return d ? <span><span className="code">{d.code}</span> <span className="text-muted">· {d.brand || d.type}</span></span> : '—'; } },
    { key: 'alert', header: 'Verdict at the gate', sort: (g) => g.alert, cell: (g) => <CheckText text={g.alert} /> },
    { key: 'guard', header: 'Guard', minWidth: 'lg', sort: (g) => g.guard_name, cell: (g) => g.guard_name },
  ];

  async function doExport() {
    await exportRows(`gate-movement-log-${todayISO()}.xlsx`, 'Gate Movement Log', [
      { header: 'Date', value: (g: GateMovement) => g.moved_on },
      { header: 'Time', value: (g) => g.moved_time.slice(0, 5) },
      { header: 'Badge ID', value: (g) => g.badge_code, width: 24 },
      { header: 'IN / OUT', value: (g) => g.direction },
      { header: 'Guard on Duty', value: (g) => g.guard_name, width: 18 },
      { header: 'Holder', value: holderOf, width: 24 },
      { header: 'Asset Code', value: (g) => deviceOf(g)?.code, width: 22 },
      { header: 'Serial Number', value: (g) => deviceOf(g)?.serial, width: 18 },
      { header: 'Alert', value: (g) => g.alert, width: 40 },
      { header: 'Remarks', value: (g) => g.remarks, width: 30 },
    ], rows);
    await logEvent('EXPORT', 'Gate Movement Log', { rows: rows.length, from, to });
  }

  const allow = verdict === 'OK';
  const deny = verdict.includes('DO NOT ALLOW');

  return (
    <>
      <PageHeader title="Gate Log" description="Security records every device going in or out. The pass is checked the moment you type its Badge ID." />
      {canEdit && (
        <Card className="mb-4" title="Check a device at the gate">
          <form onSubmit={(e) => void log('OUT', e)} className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 flex flex-col gap-4">
              {error && <Notice tone="danger">{error}</Notice>}
              <Field label="Badge ID" htmlFor="g-code" required hint="Type it as printed on the pass, or pick from the list.">
                <Input id="g-code" list="badge-codes" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
                  placeholder="PASTI-EDP-LAP-26-0001" className="code !text-base uppercase" autoFocus />
                <datalist id="badge-codes">
                  {[...new Set(ds.badges.filter((b) => b.status === 'Active').map((b) => b.badge_code))].map((c) => <option key={c} value={c} />)}
                </datalist>
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Guard on duty" htmlFor="g-guard" required hint="Remembered on this computer.">
                  <Input id="g-guard" value={guard} onChange={(e) => setGuard(e.target.value)} />
                </Field>
                <Field label="Date" htmlFor="g-date" required>
                  <Input id="g-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Time" htmlFor="g-time" hint="Blank = now.">
                  <Input id="g-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </Field>
              </div>
              <Field label="Remarks" htmlFor="g-remarks">
                <Input id="g-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" icon={LogOut} loading={busy === 'OUT'} disabled={!!busy}>Log OUT</Button>
                <Button variant="secondary" icon={LogIn} loading={busy === 'IN'} disabled={!!busy} onClick={() => void log('IN')}>Log IN</Button>
              </div>
            </div>
            <div className="lg:col-span-2" aria-live="polite">
              {!trimmed ? (
                <div className="h-full min-h-40 rounded-[var(--radius-card)] border border-dashed border-line grid place-items-center text-muted text-center p-6">
                  The pass check appears here as soon as a Badge ID is entered.
                </div>
              ) : (
                <div className={cx('h-full rounded-[var(--radius-card)] border p-5',
                  allow ? 'bg-ok-soft border-ok/40' : deny ? 'bg-danger-soft border-danger/50' : 'bg-warn-soft border-warn/40')}>
                  <div className={cx('flex items-center gap-2 text-lg font-extrabold', allow ? 'text-ok' : deny ? 'text-danger' : 'text-warn')}>
                    {allow ? <ShieldCheck className="size-6" /> : deny ? <ShieldX className="size-6" /> : <TriangleAlert className="size-6" />}
                    {allow ? 'ALLOW' : deny ? 'DO NOT ALLOW' : 'CHECK WITH IT'}
                  </div>
                  {!allow && <p className="mt-1 text-ink">{verdict.replace(/^⚠ (DO NOT ALLOW|Check with IT) – /, '')}</p>}
                  {badge && device && (
                    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
                      <dt className="text-muted">Holder</dt><dd className="font-semibold">{employeeName(ix, badge.holder_id)}</dd>
                      <dt className="text-muted">Device</dt><dd>{device.type} · {device.brand}</dd>
                      <dt className="text-muted">Asset code</dt><dd className="code">{device.code}</dd>
                      <dt className="text-muted">Serial</dt><dd className="code">{device.serial || '—'}</dd>
                      <dt className="text-muted">Valid until</dt><dd>{formatDate(badge.valid_until)}</dd>
                    </dl>
                  )}
                  <p className="text-[12px] text-muted mt-4">Check the serial on the device matches before letting it through.</p>
                </div>
              )}
            </div>
          </form>
        </Card>
      )}

      <Card padded={false} title="Movement history" actions={<Button size="sm" icon={Download} onClick={() => void doExport()} disabled={!rows.length}>Export</Button>}>
        <div className="p-3 pb-0">
          <Toolbar>
            <SearchInput value={q} onChange={setQ} placeholder="Search badge, holder, guard…" />
            <label className="flex items-center gap-2 text-[13px] text-muted">From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="From date" /></label>
            <label className="flex items-center gap-2 text-[13px] text-muted">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="To date" /></label>
            <Select aria-label="Verdict" value={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.value)} className="w-auto">
              <option value="">All verdicts</option>
              <option value="1">Only warnings / refusals</option>
            </Select>
          </Toolbar>
        </div>
        <DataTable rows={rows} columns={columns} rowKey={(g) => g.id} initialSort={{ key: 'when', dir: 'desc' }}
          empty={ds.gateMovements.length ? { title: 'No movements in this range' } : { title: 'No gate movements logged yet' }} />
      </Card>
    </>
  );
}
