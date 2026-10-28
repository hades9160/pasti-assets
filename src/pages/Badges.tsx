import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgePlus, Download, RefreshCw, ShieldOff } from 'lucide-react';
import { logEvent, useData } from '../lib/data';
import { useAuth } from '../lib/auth';
import { badgeCheck, badgeDevice, badgeDuplicate, badgeValidity, departmentName, employeeName, lastGateMovement } from '../lib/rules';
import { formatDate, formatTime } from '../lib/dates';
import { exportRows } from '../lib/export';
import { BADGE_STATUSES, type Badge } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';
import { IssueBadgeModal, RenewBadgeModal, RevokeBadgeModal } from '../components/badgeModals';
import { Button, Card, CheckText, PageHeader, SearchInput, Select, StatusPill, Toolbar } from '../components/ui';

export function Badges() {
  const { ds, ix, today } = useData();
  const { canEdit } = useAuth();
  const [params, setParams] = useSearchParams();
  const [issuing, setIssuing] = useState(false);
  const [renew, setRenew] = useState<Badge | null>(null);
  const [revoke, setRevoke] = useState<Badge | null>(null);
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const validity = params.get('validity') ?? '';
  const own = params.get('own') ?? '';
  const setParam = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ds.badges.filter((b) => {
      if (status && b.status !== status) return false;
      if (own && b.ownership !== own) return false;
      if (validity === 'attention' && !(b.status === 'Active' && (badgeValidity(b, today).startsWith('⚠') || badgeCheck(ix, b).startsWith('⚠')))) return false;
      if (!needle) return true;
      const d = badgeDevice(ix, b);
      return [b.badge_code, employeeName(ix, b.holder_id), d.code, d.serial, d.brand].some((x) => x?.toLowerCase().includes(needle));
    });
  }, [ds.badges, ix, q, status, own, validity, today]);

  // Latest row per Badge ID is the one that can be renewed.
  const latestRow = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of ds.badges) m.set(b.badge_code, Math.max(m.get(b.badge_code) ?? 0, b.row_no));
    return m;
  }, [ds.badges]);

  const columns: Column<Badge>[] = [
    { key: 'code', header: 'Badge ID', sort: (b) => b.badge_code, cell: (b) => (
      <div><span className="code text-ink font-medium">{b.badge_code}</span>
        {b.replaces_badge_code && <div className="text-[11.5px] text-muted">Replacement</div>}</div>) },
    { key: 'holder', header: 'Holder', sort: (b) => employeeName(ix, b.holder_id), cell: (b) => (
      <div><Link to={`/employees/${b.holder_id}`} className="text-ink hover:text-primary" onClick={(e) => e.stopPropagation()}>{employeeName(ix, b.holder_id)}</Link>
        <div className="text-[12px] text-muted">{departmentName(ix, b.holder_department_id)}</div></div>) },
    { key: 'device', header: 'Device', minWidth: 'md', sort: (b) => badgeDevice(ix, b).code, cell: (b) => {
      const d = badgeDevice(ix, b);
      const to = b.asset_id ? `/assets/${b.asset_id}` : `/byod?q=${d.code}`;
      return <div><Link to={to} className="code text-primary hover:underline">{d.code}</Link>
        <div className="text-[12px] text-muted">{b.ownership === 'Employee-Owned' ? 'Personal · ' : ''}{d.brand || d.type}</div></div>;
    } },
    { key: 'issued', header: 'Issued', minWidth: 'lg', sort: (b) => b.date_issued, cell: (b) => formatDate(b.date_issued) },
    { key: 'valid', header: 'Valid until', sort: (b) => b.valid_until, cell: (b) => formatDate(b.valid_until) },
    { key: 'validity', header: 'Validity', sort: (b) => badgeValidity(b, today), cell: (b) => <CheckText text={badgeValidity(b, today)} /> },
    { key: 'status', header: 'Status', sort: (b) => b.status, cell: (b) => <StatusPill status={b.status} /> },
    { key: 'check', header: 'Check', minWidth: 'md', cell: (b) => <CheckText text={badgeCheck(ix, b) || '—'} /> },
    { key: 'gate', header: 'Last gate movement', minWidth: 'lg', cell: (b) => {
      const g = lastGateMovement(ix, b.badge_code);
      return g ? <span>{g.direction} · {formatDate(g.moved_on)} {formatTime(g.moved_time)}</span> : <span className="text-muted">None logged</span>;
    } },
    ...(canEdit ? [{ key: 'actions', header: '', cell: (b: Badge) => (
      <div className="flex gap-1 justify-end">
        {b.row_no === latestRow.get(b.badge_code) && b.status !== 'Revoked' &&
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setRenew(b)} title="Renew or replace this badge">Renew</Button>}
        {b.status === 'Active' && <Button size="sm" variant="ghost" icon={ShieldOff} onClick={() => setRevoke(b)}>Revoke</Button>}
      </div>) } as Column<Badge>] : []),
  ];

  async function doExport() {
    await exportRows(`device-pass-badges-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Device Pass Badge Register', [
      { header: 'Date Issued', value: (b: Badge) => b.date_issued },
      { header: 'Ownership Type', value: (b) => b.ownership, width: 16 },
      { header: 'Serial Number', value: (b) => badgeDevice(ix, b).serial, width: 18 },
      { header: 'Device Type', value: (b) => badgeDevice(ix, b).type, width: 18 },
      { header: 'Type Code', value: (b) => b.type_code },
      { header: 'Year', value: (b) => b.code_year },
      { header: 'Sequence No.', value: (b) => b.sequence_no },
      { header: 'Replacement of Badge ID', value: (b) => b.replaces_badge_code, width: 22 },
      { header: 'Badge ID', value: (b) => b.badge_code, width: 24 },
      { header: 'Brand / Model', value: (b) => badgeDevice(ix, b).brand, width: 20 },
      { header: 'Owner / Custodian', value: (b) => employeeName(ix, b.holder_id), width: 24 },
      { header: 'Department / Location', value: (b) => departmentName(ix, b.holder_department_id), width: 22 },
      { header: 'Asset Code of Device', value: (b) => badgeDevice(ix, b).code, width: 22 },
      { header: 'Duplicate Serial?', value: (b) => badgeDuplicate(ix, b) },
      { header: 'Valid Until', value: (b) => b.valid_until },
      { header: 'Badge Validity', value: (b) => badgeValidity(b, today), width: 26 },
      { header: 'Status', value: (b) => b.status },
      { header: 'Remarks', value: (b) => b.remarks, width: 30 },
      { header: 'Check', value: (b) => badgeCheck(ix, b), width: 36 },
    ], rows);
    await logEvent('EXPORT', 'Device Pass Badge Register', { rows: rows.length });
  }

  return (
    <>
      <PageHeader title="Gate Passes" description="Electronic Device Pass badges that let Security check devices in and out. Each pass is valid for 3 months."
        actions={<>
          <Button icon={Download} onClick={() => void doExport()} disabled={!rows.length}>Export to Excel</Button>
          {canEdit && <Button icon={BadgePlus} variant="primary" onClick={() => setIssuing(true)}>Issue gate pass</Button>}
        </>} />
      <Card padded={false}>
        <div className="p-3 pb-0">
          <Toolbar>
            <SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Search badge ID, holder, device, serial…" />
            <Select aria-label="Status" value={status} onChange={(e) => setParam('status', e.target.value)} className="w-auto">
              <option value="">All statuses</option>
              {BADGE_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </Select>
            <Select aria-label="Ownership" value={own} onChange={(e) => setParam('own', e.target.value)} className="w-auto">
              <option value="">Company and personal</option>
              <option value="Company-Owned">Company-owned</option>
              <option value="Employee-Owned">Employee-owned</option>
            </Select>
            <Select aria-label="Needs attention" value={validity} onChange={(e) => setParam('validity', e.target.value)} className="w-auto">
              <option value="">All passes</option>
              <option value="attention">Expiring, expired or flagged</option>
            </Select>
          </Toolbar>
        </div>
        <DataTable rows={rows} columns={columns} rowKey={(b) => b.id} initialSort={{ key: 'code', dir: 'asc' }}
          rowClassName={(b) => (b.status !== 'Active' ? 'opacity-70' : undefined)}
          empty={ds.badges.length ? { title: 'No passes match these filters' } : { title: 'No gate passes issued yet' }} />
      </Card>
      <IssueBadgeModal open={issuing} onClose={() => setIssuing(false)} />
      {renew && <RenewBadgeModal open onClose={() => setRenew(null)} badge={renew} />}
      {revoke && <RevokeBadgeModal open onClose={() => setRevoke(null)} badge={revoke} />}
    </>
  );
}
