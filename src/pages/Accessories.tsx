import { useEffect, useMemo, useState } from 'react';
import { Download, PencilLine, Plus, Undo2 } from 'lucide-react';
import { logEvent, useData } from '../lib/data';
import { useAuth } from '../lib/auth';
import { friendlyError, supabase } from '../lib/supabase';
import { accessoryChecks, accessoryStatus, departmentName, employeeName } from '../lib/rules';
import { formatDate, isValidISODate, todayISO } from '../lib/dates';
import { exportRows } from '../lib/export';
import type { Accessory } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';
import { FormModal } from '../components/Modal';
import { EmployeePicker, ListPicker, required } from '../components/pickers';
import { Button, Card, CheckList, Field, Input, PageHeader, SearchInput, Select, StatusPill, Textarea, Toolbar } from '../components/ui';
import { useToast } from '../components/toast';

export function Accessories() {
  const { ds, ix } = useData();
  const { canEdit } = useAuth();
  const [edit, setEdit] = useState<Accessory | 'new' | null>(null);
  const [ret, setRet] = useState<Accessory | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('Issued');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ds.accessories.filter((x) => (!status || accessoryStatus(x) === status) &&
      (!needle || [x.accessory_type, x.brand_model, x.serial_tag, employeeName(ix, x.employee_id)].some((v) => v?.toLowerCase().includes(needle))));
  }, [ds.accessories, ix, q, status]);

  const columns: Column<Accessory>[] = [
    { key: 'issued', header: 'Date issued', sort: (x) => x.date_issued, cell: (x) => formatDate(x.date_issued) },
    { key: 'emp', header: 'Employee', sort: (x) => employeeName(ix, x.employee_id), cell: (x) => (
      <div><div>{employeeName(ix, x.employee_id)}</div><div className="text-[12px] text-muted">{departmentName(ix, ix.employee.get(x.employee_id)?.department_id)}</div></div>) },
    { key: 'what', header: 'Accessory', sort: (x) => x.accessory_type, cell: (x) => (
      <div><div>{x.accessory_type}{x.qty > 1 && <span className="text-muted"> × {x.qty}</span>}</div>
        <div className="text-[12px] text-muted">{[x.brand_model, x.serial_tag].filter(Boolean).join(' · ')}</div></div>) },
    { key: 'for', header: 'For device', minWidth: 'md', cell: (x) => x.for_asset_id ? <span className="code">{ix.asset.get(x.for_asset_id)?.asset_code}</span> : <span className="text-muted">—</span> },
    { key: 'reason', header: 'Reason', minWidth: 'lg', sort: (x) => x.reason, cell: (x) => x.reason ?? '—' },
    { key: 'status', header: 'Status', sort: accessoryStatus, cell: (x) => <div><StatusPill status={accessoryStatus(x)} />
      {x.date_returned && <div className="text-[12px] text-muted mt-0.5">{formatDate(x.date_returned)}{x.return_condition ? ` · ${x.return_condition}` : ''}</div>}</div> },
    { key: 'check', header: 'Check', minWidth: 'md', cell: (x) => <CheckList items={accessoryChecks(ix, x)} /> },
    ...(canEdit ? [{ key: 'actions', header: '', cell: (x: Accessory) => (
      <div className="flex gap-1 justify-end">
        {!x.date_returned && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setRet(x)}>Returned</Button>}
        <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setEdit(x)} aria-label="Edit" />
      </div>) } as Column<Accessory>] : []),
  ];

  async function doExport() {
    await exportRows(`accessory-log-${todayISO()}.xlsx`, 'Accessory Log', [
      { header: 'Date Issued', value: (x: Accessory) => x.date_issued },
      { header: 'Employee', value: (x) => employeeName(ix, x.employee_id), width: 24 },
      { header: 'Department', value: (x) => departmentName(ix, ix.employee.get(x.employee_id)?.department_id), width: 22 },
      { header: 'Accessory', value: (x) => x.accessory_type, width: 22 },
      { header: 'Brand / Model', value: (x) => x.brand_model, width: 18 },
      { header: 'Serial / Tag No.', value: (x) => x.serial_tag, width: 16 },
      { header: 'Qty', value: (x) => x.qty },
      { header: 'For Device (Asset Code)', value: (x) => (x.for_asset_id ? ix.asset.get(x.for_asset_id)?.asset_code : ''), width: 22 },
      { header: 'Reason Issued', value: (x) => x.reason, width: 20 },
      { header: 'Date Returned', value: (x) => x.date_returned },
      { header: 'Condition on Return', value: (x) => x.return_condition },
      { header: 'Status', value: accessoryStatus },
      { header: 'Check', value: (x) => accessoryChecks(ix, x).join(' ') || 'OK', width: 30 },
      { header: 'Remarks', value: (x) => x.remarks, width: 30 },
    ], rows);
    await logEvent('EXPORT', 'Accessory Log', { rows: rows.length });
  }

  return (
    <>
      <PageHeader title="Accessories" description="Chargers, bags, mice, headsets and other items handed to employees. One row per hand-out; mark it returned when it comes back."
        actions={<>
          <Button icon={Download} onClick={() => void doExport()} disabled={!rows.length}>Export to Excel</Button>
          {canEdit && <Button icon={Plus} variant="primary" onClick={() => setEdit('new')}>Record accessory</Button>}
        </>} />
      <Card padded={false}>
        <div className="p-3 pb-0"><Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Search item, employee, tag…" />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <option value="Issued">Still with the employee</option>
            <option value="Returned">Returned</option>
            <option value="">All</option>
          </Select>
        </Toolbar></div>
        <DataTable rows={rows} columns={columns} rowKey={(x) => x.id} initialSort={{ key: 'issued', dir: 'desc' }}
          empty={ds.accessories.length ? { title: 'Nothing matches these filters' } : { title: 'No accessories recorded yet',
            body: 'Example: a charger and bag issued with a laptop are one row each; a later keyboard & mouse request is a new row.' }} />
      </Card>
      <AccessoryFormModal open={edit !== null} onClose={() => setEdit(null)} item={edit === 'new' ? undefined : edit ?? undefined} />
      {ret && <ReturnAccessoryModal item={ret} onClose={() => setRet(null)} />}
    </>
  );
}

const ACCESSORY_BLANK = { date: '', emp: '', type: '', brand: '', tag: '', qty: '1', asset: '', reason: '', remarks: '' };

function AccessoryFormModal({ open, onClose, item }: { open: boolean; onClose: () => void; item?: Accessory }) {
  const { ds, reload } = useData();
  const toast = useToast();
  const [v, setV] = useState(ACCESSORY_BLANK);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrs({});
    setV(item ? {
      date: item.date_issued, emp: item.employee_id, type: item.accessory_type, brand: item.brand_model ?? '', tag: item.serial_tag ?? '',
      qty: String(item.qty), asset: item.for_asset_id ?? '', reason: item.reason ?? '', remarks: item.remarks ?? '',
    } : { ...ACCESSORY_BLANK, date: todayISO() });
  }, [open, item]);
  const set = (k: keyof typeof ACCESSORY_BLANK) => (x: string) => {
    setV((s) => ({ ...s, [k]: x }));
    setErrs((e) => { const { [k]: _gone, ...rest } = e; return rest; });
  };
  const empAssets = ds.assets.filter((a) => a.custodian_id === v.emp && a.status !== 'Void');

  async function submit(): Promise<string | null> {
    const e = required(v, { date: 'Date issued', emp: 'Employee', type: 'Accessory', qty: 'Qty' });
    if (v.date && !isValidISODate(v.date)) e.date = 'Enter a valid date.';
    if (v.qty && !(Number.isInteger(Number(v.qty)) && Number(v.qty) > 0)) e.qty = 'Enter a whole number above zero.';
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';
    const row = {
      date_issued: v.date, employee_id: v.emp, accessory_type: v.type, brand_model: v.brand.trim() || null, serial_tag: v.tag.trim() || null,
      qty: Number(v.qty), for_asset_id: v.asset || null, reason: v.reason || null, remarks: v.remarks.trim() || null,
    };
    const { error } = item ? await supabase.from('accessories').update(row).eq('id', item.id) : await supabase.from('accessories').insert(row);
    if (error) return friendlyError(error);
    toast('ok', item ? 'Accessory record saved.' : `${v.type} recorded.`);
    await reload();
    return null;
  }

  return (
    <FormModal open={open} onClose={onClose} wide onSubmit={submit} submitLabel={item ? 'Save changes' : 'Record accessory'}
      title={item ? 'Edit accessory record' : 'Record an accessory hand-out'}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Date issued" htmlFor="x-date" required error={errs.date}>
          <Input id="x-date" type="date" value={v.date} onChange={(e) => set('date')(e.target.value)} invalid={!!errs.date} />
        </Field>
        <Field label="Employee" htmlFor="x-emp" required error={errs.emp}>
          <EmployeePicker id="x-emp" value={v.emp} onChange={set('emp')} invalid={!!errs.emp} includeSeparated={!!item} />
        </Field>
        <Field label="Accessory" htmlFor="x-type" required error={errs.type} hint="Missing an item? An administrator can add it in Settings.">
          <ListPicker id="x-type" list="accessory_type" value={v.type} onChange={set('type')} invalid={!!errs.type} />
        </Field>
        <Field label="Qty" htmlFor="x-qty" required error={errs.qty}>
          <Input id="x-qty" type="number" min={1} step={1} value={v.qty} onChange={(e) => set('qty')(e.target.value)} invalid={!!errs.qty} />
        </Field>
        <Field label="Brand / Model" htmlFor="x-brand"><Input id="x-brand" value={v.brand} onChange={(e) => set('brand')(e.target.value)} /></Field>
        <Field label="Serial / Tag No." htmlFor="x-tag" hint="Optional."><Input id="x-tag" value={v.tag} onChange={(e) => set('tag')(e.target.value)} /></Field>
        <Field label="For device" htmlFor="x-asset" hint="Optional — the asset this goes with.">
          <Select id="x-asset" value={v.asset} onChange={(e) => set('asset')(e.target.value)}>
            <option value="">Not tied to a device</option>
            {(v.asset && !empAssets.some((a) => a.id === v.asset) ? [...empAssets, ...ds.assets.filter((a) => a.id === v.asset)] : empAssets)
              .map((a) => <option key={a.id} value={a.id}>{a.asset_code} · {a.brand_model}</option>)}
          </Select>
        </Field>
        <Field label="Reason issued" htmlFor="x-reason"><ListPicker id="x-reason" list="issue_reason" value={v.reason} onChange={set('reason')} /></Field>
        <Field label="Remarks" htmlFor="x-remarks" className="sm:col-span-2"><Textarea id="x-remarks" rows={2} value={v.remarks} onChange={(e) => set('remarks')(e.target.value)} /></Field>
      </div>
    </FormModal>
  );
}

function ReturnAccessoryModal({ item, onClose }: { item: Accessory; onClose: () => void }) {
  const { ix, reload } = useData();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [cond, setCond] = useState('');
  const [err, setErr] = useState<string>();
  async function submit(): Promise<string | null> {
    if (!isValidISODate(date)) { setErr('Enter a valid date.'); return 'Please fix the highlighted field.'; }
    if (date < item.date_issued) { setErr(`Cannot be before ${formatDate(item.date_issued)}.`); return 'Please fix the highlighted field.'; }
    const { error } = await supabase.from('accessories').update({ date_returned: date, return_condition: cond || null }).eq('id', item.id);
    if (error) return friendlyError(error);
    toast('ok', `${item.accessory_type} marked returned.`);
    await reload();
    return null;
  }
  return (
    <FormModal open onClose={onClose} onSubmit={submit} submitLabel="Mark returned" title={`${item.accessory_type} returned`}
      description={`From ${employeeName(ix, item.employee_id)}, issued ${formatDate(item.date_issued)}.`}>
      <Field label="Date returned" htmlFor="xr-date" required error={err}>
        <Input id="xr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!err} />
      </Field>
      <Field label="Condition on return" htmlFor="xr-cond"><ListPicker id="xr-cond" list="return_condition" value={cond} onChange={setCond} placeholder="Not checked" /></Field>
    </FormModal>
  );
}
