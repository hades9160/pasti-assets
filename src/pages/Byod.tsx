import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BadgePlus, Download, PencilLine, Plus, Trash2 } from 'lucide-react';
import { logEvent, useData } from '../lib/data';
import { useAuth } from '../lib/auth';
import { friendlyError, supabase } from '../lib/supabase';
import { byodActiveBadge, byodAlsoInAssets, departmentName, deviceTypeName, employeeName } from '../lib/rules';
import { isValidISODate, todayISO, yearOf } from '../lib/dates';
import { exportRows } from '../lib/export';
import { BYOD_STATUSES, type ByodDevice } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';
import { FormModal } from '../components/Modal';
import { IssueBadgeModal } from '../components/badgeModals';
import { DepartmentPicker, DeviceTypePicker, EmployeePicker, OptionsSelect, required } from '../components/pickers';
import { Button, Card, CheckText, Field, Input, Notice, PageHeader, SearchInput, Select, StatusPill, Textarea, Toolbar } from '../components/ui';
import { useToast } from '../components/toast';

export function Byod() {
  const { ds, ix } = useData();
  const { canEdit, isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState<ByodDevice | 'new' | null>(null);
  const [badgeFor, setBadgeFor] = useState<ByodDevice | null>(null);
  const [del, setDel] = useState<ByodDevice | null>(null);
  const { reload } = useData();
  const toast = useToast();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const setParam = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ds.byod.filter((d) => (!status || (d.status ?? '') === status) &&
      (!needle || [d.byod_code, d.brand_model, d.serial_number, employeeName(ix, d.owner_id)].some((x) => x?.toLowerCase().includes(needle))));
  }, [ds.byod, ix, q, status]);

  const columns: Column<ByodDevice>[] = [
    { key: 'code', header: 'BYOD code', sort: (d) => d.byod_code, cell: (d) => <span className="code text-ink font-medium">{d.byod_code}</span> },
    { key: 'device', header: 'Device', sort: (d) => d.brand_model, cell: (d) => <div><div>{d.brand_model || <span className="text-muted">—</span>}</div>
      <div className="text-[12px] text-muted">{deviceTypeName(ix, d.device_type_id)}</div></div> },
    { key: 'serial', header: 'Serial number', minWidth: 'md', sort: (d) => d.serial_number, cell: (d) => <span className="code">{d.serial_number ?? '—'}</span> },
    { key: 'owner', header: 'Owner', sort: (d) => employeeName(ix, d.owner_id), cell: (d) => employeeName(ix, d.owner_id) || <span className="text-muted">Not set</span> },
    { key: 'consent', header: 'Consent signed', minWidth: 'lg', cell: (d) => d.consent_signed == null ? <span className="text-muted">—</span> : d.consent_signed ? 'Yes' : <span className="text-warn">No</span> },
    { key: 'status', header: 'Status', sort: (d) => d.status, cell: (d) => <StatusPill status={d.status} /> },
    { key: 'badge', header: 'Gate pass', minWidth: 'md', cell: (d) => { const b = byodActiveBadge(ix, d); return b.startsWith('PASTI') ? <span className="code">{b}</span> : <span className="text-muted">{b ? 'None' : '—'}</span>; } },
    { key: 'check', header: 'Also on Asset Register?', minWidth: 'lg', cell: (d) => <CheckText text={byodAlsoInAssets(ix, d) || '—'} /> },
    ...(canEdit ? [{ key: 'actions', header: '', cell: (d: ByodDevice) => (
      <div className="flex gap-1 justify-end">
        {d.status === 'Active' && d.owner_id && !byodActiveBadge(ix, d).startsWith('PASTI') &&
          <Button size="sm" variant="ghost" icon={BadgePlus} onClick={() => setBadgeFor(d)}>Gate pass</Button>}
        <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setEdit(d)} aria-label={`Edit ${d.byod_code}`}>Edit</Button>
        {isAdmin && !ds.badges.some((b) => b.byod_id === d.id) &&
          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(d)} aria-label={`Delete ${d.byod_code}`} />}
      </div>) } as Column<ByodDevice>] : []),
  ];

  async function doExport() {
    await exportRows(`employee-owned-devices-${todayISO()}.xlsx`, 'Employee-Owned Devices', [
      { header: 'Date Registered', value: (d: ByodDevice) => d.date_registered },
      { header: 'Device Type', value: (d) => deviceTypeName(ix, d.device_type_id), width: 18 },
      { header: 'Asset Code', value: (d) => d.byod_code, width: 24 },
      { header: 'Brand / Model', value: (d) => d.brand_model, width: 20 },
      { header: 'Serial Number', value: (d) => d.serial_number, width: 18 },
      { header: 'Employee Name (Owner)', value: (d) => employeeName(ix, d.owner_id), width: 24 },
      { header: 'Department / Location', value: (d) => departmentName(ix, d.department_id), width: 22 },
      { header: 'Consent Form Signed?', value: (d) => (d.consent_signed == null ? '' : d.consent_signed ? 'Yes' : 'No') },
      { header: 'Status', value: (d) => d.status },
      { header: 'Remarks', value: (d) => d.remarks, width: 30 },
      { header: 'Active Badge ID', value: (d) => byodActiveBadge(ix, d), width: 24 },
      { header: 'Also in Asset Register?', value: (d) => byodAlsoInAssets(ix, d) },
    ], rows);
    await logEvent('EXPORT', 'Employee-Owned Devices', { rows: rows.length });
  }

  async function remove(): Promise<string | null> {
    const { error } = await supabase.from('byod_devices').delete().eq('id', del!.id);
    if (error) return friendlyError(error);
    toast('ok', `${del!.byod_code} was removed. A copy is kept in the recycle bin.`);
    await reload();
    return null;
  }

  return (
    <>
      <PageHeader title="Personal Devices" description="Employee-owned devices (BYOD) brought to the office. Kept apart from company assets, with their own PASTI-BYOD codes."
        actions={<>
          <Button icon={Download} onClick={() => void doExport()} disabled={!rows.length}>Export to Excel</Button>
          {canEdit && <Button icon={Plus} variant="primary" onClick={() => setEdit('new')}>Register personal device</Button>}
        </>} />
      <Card padded={false}>
        <div className="p-3 pb-0"><Toolbar>
          <SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Search code, owner, serial…" />
          <Select aria-label="Status" value={status} onChange={(e) => setParam('status', e.target.value)} className="w-auto">
            <option value="">All statuses</option>
            {BYOD_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Toolbar></div>
        <DataTable rows={rows} columns={columns} rowKey={(d) => d.id} initialSort={{ key: 'code', dir: 'asc' }}
          empty={ds.byod.length ? { title: 'No devices match these filters' } : { title: 'No personal devices registered' }} />
      </Card>
      <ByodFormModal open={edit !== null} onClose={() => setEdit(null)} device={edit === 'new' ? undefined : edit ?? undefined} />
      {badgeFor && <IssueBadgeModal open onClose={() => setBadgeFor(null)} ownership="Employee-Owned" deviceId={badgeFor.id} />}
      <FormModal open={!!del} onClose={() => setDel(null)} onSubmit={remove} danger submitLabel="Delete" title={`Delete ${del?.byod_code}?`}
        description="Use this only for a record entered by mistake. To stop tracking a device, set its status to Inactive instead.">
        <p className="text-ink-2">The code will not be reused. A copy is kept in the recycle bin.</p>
      </FormModal>
    </>
  );
}

const BYOD_BLANK = { date: '', type: '', brand: '', serial: '', owner: '', dept: '', consent: '', status: 'Active', remarks: '' };

function ByodFormModal({ open, onClose, device }: { open: boolean; onClose: () => void; device?: ByodDevice }) {
  const { ix, reload } = useData();
  const toast = useToast();
  const [v, setV] = useState(BYOD_BLANK);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrs({});
    setV(device ? {
      date: device.date_registered, type: String(device.device_type_id), brand: device.brand_model ?? '', serial: device.serial_number ?? '',
      owner: device.owner_id ?? '', dept: device.department_id ? String(device.department_id) : '',
      consent: device.consent_signed == null ? '' : device.consent_signed ? 'Yes' : 'No', status: device.status ?? '', remarks: device.remarks ?? '',
    } : { ...BYOD_BLANK, date: todayISO() });
  }, [open, device]);
  useEffect(() => {
    const e = v.owner ? ix.employee.get(v.owner) : undefined;
    if (e?.department_id && !device) setV((x) => ({ ...x, dept: String(e.department_id) }));
  }, [v.owner, ix, device]);
  const set = (k: keyof typeof BYOD_BLANK) => (x: string) => {
    setV((s) => ({ ...s, [k]: x }));
    setErrs((e) => { const { [k]: _gone, ...rest } = e; return rest; });
  };
  const s = v.serial.trim().toUpperCase();
  const clashAsset = s ? ix.ds.assets.find((a) => a.status !== 'Void' && (a.serial_number ?? '').trim().toUpperCase() === s) : undefined;
  const clashByod = s ? ix.ds.byod.find((d) => d.id !== device?.id && (d.serial_number ?? '').trim().toUpperCase() === s) : undefined;

  async function submit(): Promise<string | null> {
    const e = required(v, { date: 'Date registered', type: 'Device type', brand: 'Brand / Model', serial: 'Serial number', owner: 'Owner', status: 'Status' });
    if (v.date && !isValidISODate(v.date)) e.date = 'Enter a valid date.';
    if (device && v.date && yearOf(v.date) !== device.code_year) e.date = `Must stay in ${device.code_year} (the year in ${device.byod_code}).`;
    if (clashAsset) e.serial = `This serial is company asset ${clashAsset.asset_code}.`;
    if (clashByod) e.serial = `Already registered as ${clashByod.byod_code}.`;
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';
    const row = {
      date_registered: v.date, device_type_id: Number(v.type), brand_model: v.brand.trim(), serial_number: v.serial.trim(),
      owner_id: v.owner, department_id: v.dept ? Number(v.dept) : null, consent_signed: v.consent ? v.consent === 'Yes' : null,
      status: v.status, remarks: v.remarks.trim() || null,
    };
    const res = device
      ? await supabase.from('byod_devices').update(row).eq('id', device.id).select('byod_code').single()
      : await supabase.from('byod_devices').insert(row).select('byod_code').single();
    if (res.error) return friendlyError(res.error);
    toast('ok', device ? `Saved ${res.data.byod_code}.` : `Registered ${res.data.byod_code}.`);
    await reload();
    return null;
  }

  return (
    <FormModal open={open} onClose={onClose} wide onSubmit={submit} submitLabel={device ? 'Save changes' : 'Register device'}
      title={device ? `Edit ${device.byod_code}` : 'Register a personal device'}
      description={device ? 'The BYOD code never changes.' : 'Code PASTI-BYOD-TYPE-YY-#### is created automatically.'}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Date registered" htmlFor="y-date" required error={errs.date}>
          <Input id="y-date" type="date" value={v.date} onChange={(e) => set('date')(e.target.value)} invalid={!!errs.date} />
        </Field>
        <Field label="Device type" htmlFor="y-type" required error={errs.type}>
          <DeviceTypePicker id="y-type" value={v.type} onChange={set('type')} invalid={!!errs.type} disabled={!!device} />
        </Field>
        <Field label="Brand / Model" htmlFor="y-brand" required error={errs.brand}>
          <Input id="y-brand" value={v.brand} onChange={(e) => set('brand')(e.target.value)} invalid={!!errs.brand} />
        </Field>
        <Field label="Serial number" htmlFor="y-serial" required error={errs.serial}>
          <Input id="y-serial" value={v.serial} onChange={(e) => set('serial')(e.target.value)} className="code" invalid={!!errs.serial || !!clashAsset || !!clashByod} />
        </Field>
        <Field label="Owner" htmlFor="y-owner" required error={errs.owner}>
          <EmployeePicker id="y-owner" value={v.owner} onChange={set('owner')} invalid={!!errs.owner} includeSeparated={!!device} />
        </Field>
        <Field label="Department / Location" htmlFor="y-dept">
          <DepartmentPicker id="y-dept" value={v.dept} onChange={set('dept')} />
        </Field>
        <Field label="Consent form signed?" htmlFor="y-consent" hint="Is the BYOD undertaking on file with HR/IT?">
          <OptionsSelect id="y-consent" value={v.consent} onChange={set('consent')} options={['Yes', 'No']} placeholder="Not yet recorded" />
        </Field>
        <Field label="Status" htmlFor="y-status" required error={errs.status}>
          <OptionsSelect id="y-status" value={v.status} onChange={set('status')} options={BYOD_STATUSES} placeholder="Choose…" invalid={!!errs.status} />
        </Field>
        <Field label="Remarks" htmlFor="y-remarks" className="sm:col-span-2">
          <Textarea id="y-remarks" rows={2} value={v.remarks} onChange={(e) => set('remarks')(e.target.value)} />
        </Field>
      </div>
      {clashAsset && <Notice tone="danger">A unit is either company-owned or employee-owned, never both. If {clashAsset.asset_code} was encoded by mistake, set it to Void first.</Notice>}
      {device && v.status !== 'Active' && byodActiveBadge(ix, device).startsWith('PASTI') &&
        <Notice tone="warn">This device still has an active gate pass. Revoke it on the Gate Passes page.</Notice>}
    </FormModal>
  );
}
