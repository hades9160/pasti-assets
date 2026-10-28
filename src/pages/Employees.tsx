import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, UserPlus } from 'lucide-react';
import { logEvent, useData } from '../lib/data';
import { useAuth } from '../lib/auth';
import { departmentName, employeeStats, type EmployeeStats } from '../lib/rules';
import { exportRows } from '../lib/export';
import { EMPLOYMENT_STATUSES, type Employee } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';
import { EmployeeFormModal } from '../components/employeeModals';
import { Button, Card, CheckList, CheckText, PageHeader, SearchInput, Select, StatusPill, Toolbar } from '../components/ui';

type Row = Employee & { st: EmployeeStats };

export function Employees() {
  const { ds, ix } = useData();
  const { canEdit } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const dept = params.get('dept') ?? '';
  const form = params.get('form') ?? '';
  const clearance = params.get('clearance') ?? '';
  const setParam = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    return ds.employees.map((e) => ({ ...e, st: employeeStats(ix, e) })).filter((e) => {
      if (status && e.employment_status !== status) return false;
      if (dept && String(e.department_id ?? '') !== dept) return false;
      if (form === 'attention' && !(e.st.formStatus.startsWith('⚠') || e.st.formStatus === 'Enter date of last signed form')) return false;
      if (clearance === 'pending' && !e.st.exitClearance.startsWith('⚠')) return false;
      return !needle || [e.full_name, e.employee_no, e.position, departmentName(ix, e.department_id)].some((x) => x?.toLowerCase().includes(needle));
    });
  }, [ds.employees, ix, q, status, dept, form, clearance]);

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Employee', sort: (e) => e.full_name, cell: (e) => (
      <div><div className="text-ink font-medium">{e.full_name}</div>
        <div className="text-[12px] text-muted">{[e.employee_no, e.position].filter(Boolean).join(' · ') || 'No ID or position yet'}</div></div>) },
    { key: 'dept', header: 'Department', minWidth: 'md', sort: (e) => departmentName(ix, e.department_id), cell: (e) => departmentName(ix, e.department_id) || '—' },
    { key: 'status', header: 'Status', minWidth: 'sm', sort: (e) => e.employment_status, cell: (e) => <StatusPill status={e.employment_status} /> },
    { key: 'dev', header: 'Devices', align: 'right', sort: (e) => e.st.devicesHeld, cell: (e) => e.st.devicesHeld || <span className="text-muted">0</span> },
    { key: 'acc', header: 'Accessories', align: 'right', minWidth: 'lg', sort: (e) => e.st.accessoriesHeld, cell: (e) => e.st.accessoriesHeld || <span className="text-muted">0</span> },
    { key: 'badges', header: 'Passes', align: 'right', minWidth: 'lg', sort: (e) => e.st.activeBadges, cell: (e) => e.st.activeBadges || <span className="text-muted">0</span> },
    { key: 'form', header: 'Form status', sort: (e) => e.st.formStatus, cell: (e) => <CheckText text={e.st.formStatus} /> },
    { key: 'clear', header: 'Exit clearance', minWidth: 'md', sort: (e) => e.st.exitClearance, cell: (e) => <CheckText text={e.st.exitClearance || '—'} /> },
    { key: 'check', header: 'Check', minWidth: 'lg', cell: (e) => <CheckList items={e.st.checks} /> },
  ];

  async function doExport() {
    await exportRows(`employees-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Employees', [
      { header: 'Employee Name', value: (e: Row) => e.full_name, width: 26 },
      { header: 'Employee ID', value: (e) => e.employee_no },
      { header: 'Department', value: (e) => departmentName(ix, e.department_id), width: 24 },
      { header: 'Position', value: (e) => e.position, width: 20 },
      { header: 'Employment Status', value: (e) => e.employment_status, width: 18 },
      { header: 'Date Separated', value: (e) => e.date_separated },
      { header: 'Last Form Signed', value: (e) => e.last_form_signed },
      { header: 'Devices Held', value: (e) => e.st.devicesHeld },
      { header: 'Accessories Held', value: (e) => e.st.accessoriesHeld },
      { header: 'Active Badges', value: (e) => e.st.activeBadges },
      { header: 'Form Status', value: (e) => e.st.formStatus, width: 30 },
      { header: 'Exit Clearance', value: (e) => e.st.exitClearance, width: 40 },
      { header: 'Check', value: (e) => e.st.checks.join(' ') || 'OK', width: 24 },
      { header: 'Remarks', value: (e) => e.remarks, width: 30 },
    ], rows);
    await logEvent('EXPORT', 'Employees', { rows: rows.length });
  }

  return (
    <>
      <PageHeader title="Employees" description="Everyone who can hold company devices. Open a person to see what they hold and print their accountability form."
        actions={<>
          <Button icon={Download} onClick={() => void doExport()} disabled={!rows.length}>Export to Excel</Button>
          {canEdit && <Button icon={UserPlus} variant="primary" onClick={() => setAdding(true)}>Add employee</Button>}
        </>} />
      <Card padded={false}>
        <div className="p-3 pb-0">
          <Toolbar>
            <SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Search name, ID, position…" />
            <Select aria-label="Employment status" value={status} onChange={(e) => setParam('status', e.target.value)} className="w-auto">
              <option value="">All statuses</option>
              {EMPLOYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </Select>
            <Select aria-label="Department" value={dept} onChange={(e) => setParam('dept', e.target.value)} className="w-auto">
              <option value="">All departments</option>
              {ds.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select aria-label="Form status" value={form} onChange={(e) => setParam('form', e.target.value)} className="w-auto">
              <option value="">Any form status</option>
              <option value="attention">Needs a form printed & signed</option>
            </Select>
            <Select aria-label="Exit clearance" value={clearance} onChange={(e) => setParam('clearance', e.target.value)} className="w-auto">
              <option value="">Any clearance</option>
              <option value="pending">Not cleared</option>
            </Select>
          </Toolbar>
        </div>
        <DataTable rows={rows} columns={columns} rowKey={(e) => e.id} onRowClick={(e) => nav(`/employees/${e.id}`)} initialSort={{ key: 'name', dir: 'asc' }}
          empty={ds.employees.length ? { title: 'No employees match these filters' } : { title: 'No employees yet', body: 'Add employees here or import them from Excel.' }} />
      </Card>
      <p className="text-[12px] text-muted mt-3">Devices held counts Active and Under Repair assets. Form status counts items issued after the Last Form Signed date.</p>
      <EmployeeFormModal open={adding} onClose={() => setAdding(false)} onSaved={(id) => nav(`/employees/${id}`)} />
    </>
  );
}
