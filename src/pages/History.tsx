import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { logEvent, useData } from '../lib/data';
import { assignmentCheck, daysHeld, departmentName, deviceTypeName, employeeName, recordStatus } from '../lib/rules';
import { formatDate, todayISO } from '../lib/dates';
import { exportRows } from '../lib/export';
import type { Assignment } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';
import { Button, Card, CheckText, Input, PageHeader, SearchInput, Select, StatusPill, Toolbar } from '../components/ui';

export function History() {
  const { ds, ix, today } = useData();
  const [q, setQ] = useState('');
  const [rec, setRec] = useState('');
  const [check, setCheck] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ds.assignments.filter((h) => {
      if (rec && recordStatus(h) !== rec) return false;
      if (check && !assignmentCheck(ix, h).startsWith('⚠')) return false;
      if (from && h.date_issued < from) return false;
      if (to && h.date_issued > to) return false;
      const a = ix.asset.get(h.asset_id);
      return !needle || [a?.asset_code, a?.serial_number, a?.brand_model, employeeName(ix, h.custodian_id), h.badge_code].some((x) => x?.toLowerCase().includes(needle));
    });
  }, [ds.assignments, ix, q, rec, check, from, to]);

  const code = (h: Assignment) => ix.asset.get(h.asset_id)?.asset_code ?? '';
  const columns: Column<Assignment>[] = [
    { key: 'code', header: 'Asset code', sort: code, cell: (h) => <Link to={`/assets/${h.asset_id}`} className="code text-primary hover:underline">{code(h)}</Link> },
    { key: 'device', header: 'Device', minWidth: 'lg', cell: (h) => { const a = ix.asset.get(h.asset_id); return a ? <span>{a.brand_model} <span className="text-muted">· {deviceTypeName(ix, a.device_type_id)}</span></span> : '—'; } },
    { key: 'who', header: 'Custodian', sort: (h) => employeeName(ix, h.custodian_id), cell: (h) => <Link to={`/employees/${h.custodian_id}`} className="hover:text-primary">{employeeName(ix, h.custodian_id)}</Link> },
    { key: 'dept', header: 'Department', minWidth: 'md', sort: (h) => departmentName(ix, h.department_id), cell: (h) => departmentName(ix, h.department_id) || '—' },
    { key: 'issued', header: 'Issued', sort: (h) => h.date_issued, cell: (h) => formatDate(h.date_issued) },
    { key: 'returned', header: 'Returned', sort: (h) => h.date_returned, cell: (h) => formatDate(h.date_returned) },
    { key: 'days', header: 'Days held', align: 'right', sort: (h) => daysHeld(h, today), cell: (h) => daysHeld(h, today) },
    { key: 'badge', header: 'Badge issued', minWidth: 'lg', cell: (h) => h.badge_code ? <span className="code">{h.badge_code}</span> : <span className="text-muted">—</span> },
    { key: 'rec', header: 'Record', sort: recordStatus, cell: (h) => <StatusPill status={recordStatus(h)} /> },
    { key: 'check', header: 'Check', minWidth: 'md', cell: (h) => <CheckText text={assignmentCheck(ix, h)} /> },
  ];

  async function doExport() {
    await exportRows(`assignment-history-${todayISO()}.xlsx`, 'Assignment History', [
      { header: 'Asset Code', value: code, width: 20 },
      { header: 'Serial Number', value: (h: Assignment) => ix.asset.get(h.asset_id)?.serial_number, width: 18 },
      { header: 'Device Type', value: (h) => { const a = ix.asset.get(h.asset_id); return a ? deviceTypeName(ix, a.device_type_id) : ''; }, width: 18 },
      { header: 'Brand / Model', value: (h) => ix.asset.get(h.asset_id)?.brand_model, width: 22 },
      { header: 'Custodian / Keeper', value: (h) => employeeName(ix, h.custodian_id), width: 24 },
      { header: 'Department / Location', value: (h) => departmentName(ix, h.department_id), width: 22 },
      { header: 'Date Issued', value: (h) => h.date_issued },
      { header: 'Date Returned', value: (h) => h.date_returned },
      { header: 'Days Held', value: (h) => daysHeld(h, today) },
      { header: 'Condition on Return', value: (h) => h.return_condition },
      { header: 'Badge ID Issued', value: (h) => h.badge_code, width: 22 },
      { header: 'Record Status', value: recordStatus },
      { header: 'Check', value: (h) => assignmentCheck(ix, h), width: 36 },
      { header: 'Remarks', value: (h) => h.remarks, width: 30 },
    ], rows);
    await logEvent('EXPORT', 'Assignment History', { rows: rows.length });
  }

  return (
    <>
      <PageHeader title="Assignment History" description="One row per hand-over: who held each asset, from when to when. Records are added automatically when assets are issued or returned."
        actions={<Button icon={Download} onClick={() => void doExport()} disabled={!rows.length}>Export to Excel</Button>} />
      <Card padded={false}>
        <div className="p-3 pb-0"><Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Search asset, serial, custodian, badge…" />
          <Select aria-label="Record status" value={rec} onChange={(e) => setRec(e.target.value)} className="w-auto">
            <option value="">Current and returned</option><option value="Current Holder">Current holders</option><option value="Returned">Returned</option>
          </Select>
          <Select aria-label="Check" value={check} onChange={(e) => setCheck(e.target.value)} className="w-auto">
            <option value="">All checks</option><option value="1">With ⚠ only</option>
          </Select>
          <label className="flex items-center gap-2 text-[13px] text-muted">Issued from <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="Issued from" /></label>
          <label className="flex items-center gap-2 text-[13px] text-muted">to <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="Issued to" /></label>
        </Toolbar></div>
        <DataTable rows={rows} columns={columns} rowKey={(h) => h.id} initialSort={{ key: 'issued', dir: 'desc' }}
          empty={ds.assignments.length ? { title: 'No records match these filters' } : { title: 'No hand-overs recorded yet' }} />
      </Card>
    </>
  );
}
