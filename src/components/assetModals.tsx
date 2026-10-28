import { useEffect, useState } from 'react';
import { useData } from '../lib/data';
import { friendlyError, supabase } from '../lib/supabase';
import { formatDate, isValidISODate, todayISO, yearOf } from '../lib/dates';
import { employeeName, isPlaceholderSerial } from '../lib/rules';
import type { Asset } from '../lib/types';
import { FormModal } from './Modal';
import { DepartmentPicker, DeviceTypePicker, EmployeePicker, ListPicker, required } from './pickers';
import { Field, Input, Notice, Textarea } from './ui';
import { useToast } from './toast';

const norm = (s: string) => s.trim().toUpperCase();

/** Register a new asset or edit an existing one's details. */
export function AssetFormModal({ open, onClose, asset, onSaved }: {
  open: boolean; onClose: () => void; asset?: Asset; onSaved?: (id: string) => void;
}) {
  const { ix, reload } = useData();
  const toast = useToast();
  const editing = Boolean(asset);
  const [v, setV] = useState({ date: '', type: '', brand: '', serial: '', dept: '', remarks: '', holder: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrs({});
    setV(asset ? {
      date: asset.date_encoded, type: String(asset.device_type_id), brand: asset.brand_model ?? '', serial: asset.serial_number ?? '',
      dept: asset.department_id ? String(asset.department_id) : '', remarks: asset.remarks ?? '', holder: '',
    } : { date: todayISO(), type: '', brand: '', serial: '', dept: '', remarks: '', holder: '' });
  }, [open, asset]);
  const set = (k: keyof typeof v) => (val: string) => {
    setV((x) => ({ ...x, [k]: val }));
    setErrs((e) => { const { [k]: _gone, ...rest } = e; return rest; });
  };

  // Live duplicate check, like the workbook's red "⚠ DUPLICATE" cell.
  const s = norm(v.serial);
  const dupAsset = s ? ix.ds.assets.find((a) => a.id !== asset?.id && a.status !== 'Void' && norm(a.serial_number ?? '') === s) : undefined;
  const dupByod = s ? ix.ds.byod.find((d) => norm(d.serial_number ?? '') === s) : undefined;
  const placeholder = s && isPlaceholderSerial(v.serial);

  async function submit(): Promise<string | null> {
    const e = required(v, { date: 'Date encoded', type: 'Device type', brand: 'Brand / Model' });
    if (v.date && !isValidISODate(v.date)) e.date = 'Enter a valid date.';
    if (editing && v.date && yearOf(v.date) !== asset!.code_year) e.date = `Must stay in ${asset!.code_year} (the year in ${asset!.asset_code}).`;
    if (dupAsset) e.serial = `Already registered as ${dupAsset.asset_code}.`;
    if (dupByod) e.serial = `Already registered as a personal device (${dupByod.byod_code}).`;
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';

    const row = {
      date_encoded: v.date, device_type_id: Number(v.type), brand_model: v.brand.trim(), serial_number: v.serial.trim() || null,
      department_id: v.dept ? Number(v.dept) : null, remarks: v.remarks.trim() || null,
    };
    if (editing) {
      const { error } = await supabase.from('assets').update(row).eq('id', asset!.id);
      if (error) return friendlyError(error);
      toast('ok', `Saved ${asset!.asset_code}.`);
      await reload();
      onSaved?.(asset!.id);
      return null;
    }
    const { data, error } = await supabase.from('assets').insert(row).select('id, asset_code').single();
    if (error) return friendlyError(error);
    let note = '';
    if (v.holder) {
      const r = await supabase.rpc('issue_asset', {
        p_asset_id: data.id, p_employee_id: v.holder, p_department_id: v.dept ? Number(v.dept) : null,
        p_date: v.date, p_previous_condition: null, p_remarks: null,
      });
      note = r.error ? ` It was registered, but could not be issued: ${friendlyError(r.error)}` : ` and issued to ${employeeName(ix, v.holder)}`;
    }
    toast(note.startsWith(' It was') ? 'error' : 'ok', `Registered ${data.asset_code}${note}.`);
    await reload();
    onSaved?.(data.id);
    return null;
  }

  return (
    <FormModal open={open} onClose={onClose} wide submitLabel={editing ? 'Save changes' : 'Register asset'} onSubmit={submit}
      title={editing ? `Edit ${asset!.asset_code}` : 'Register a company asset'}
      description={editing ? 'The asset code never changes. To change who holds it or its status, use the buttons on the asset page.'
        : 'The Asset Code (PASTI-TYPE-YY-####) is created automatically when you save.'}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Date encoded" htmlFor="a-date" required error={errs.date}>
          <Input id="a-date" type="date" value={v.date} onChange={(e) => set('date')(e.target.value)} invalid={!!errs.date} />
        </Field>
        <Field label="Device type" htmlFor="a-type" required error={errs.type}
          hint={editing ? 'Fixed — part of the asset code.' : 'Missing a type? An administrator can add it in Settings.'}>
          <DeviceTypePicker id="a-type" value={v.type} onChange={set('type')} invalid={!!errs.type} disabled={editing} />
        </Field>
        <Field label="Brand / Model" htmlFor="a-brand" required error={errs.brand}>
          <Input id="a-brand" value={v.brand} onChange={(e) => set('brand')(e.target.value)} placeholder="e.g. HP EliteBook 840 G6" invalid={!!errs.brand} />
        </Field>
        <Field label="Serial number" htmlFor="a-serial" error={errs.serial}
          hint={placeholder ? '⚠ This looks like a placeholder. Copy the real serial from the label on the device.'
            : 'Copy it exactly as printed on the device label.'}>
          <Input id="a-serial" value={v.serial} onChange={(e) => set('serial')(e.target.value)} className="code" invalid={!!errs.serial || !!dupAsset || !!dupByod} />
        </Field>
        <Field label="Department / Location" htmlFor="a-dept">
          <DepartmentPicker id="a-dept" value={v.dept} onChange={set('dept')} />
        </Field>
        {!editing && (
          <Field label="Issue to (optional)" htmlFor="a-holder" hint="Fill this in if you are handing it over today — it creates the first Assignment History record.">
            <EmployeePicker id="a-holder" value={v.holder} onChange={set('holder')} placeholder="Keep with IT for now" />
          </Field>
        )}
        <Field label="Remarks" htmlFor="a-remarks" className="sm:col-span-2">
          <Textarea id="a-remarks" value={v.remarks} onChange={(e) => set('remarks')(e.target.value)} rows={2} />
        </Field>
      </div>
      {(dupAsset || dupByod) && (
        <Notice tone="danger">This serial number is already on the register as <b>{dupAsset?.asset_code ?? dupByod?.byod_code}</b>.
          One physical unit keeps one code for life — open that record instead of encoding it again.</Notice>
      )}
    </FormModal>
  );
}

/** Issue to an employee, or hand over from the current holder to someone else. */
export function IssueAssetModal({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: Asset }) {
  const { ix, reload } = useData();
  const toast = useToast();
  const current = (ix.assignmentsByAsset.get(asset.id) ?? []).find((h) => !h.date_returned);
  const [v, setV] = useState({ emp: '', dept: '', date: '', cond: '', remarks: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setV({ emp: '', dept: '', date: todayISO(), cond: '', remarks: '' }); setErrs({}); } }, [open]);

  useEffect(() => {
    const e = v.emp ? ix.employee.get(v.emp) : undefined;
    if (e) setV((x) => ({ ...x, dept: e.department_id ? String(e.department_id) : x.dept }));
  }, [v.emp, ix]);

  async function submit(): Promise<string | null> {
    const e = required(v, { emp: 'Employee', date: 'Date issued' });
    if (v.date && !isValidISODate(v.date)) e.date = 'Enter a valid date.';
    if (current && v.date && v.date < current.date_issued) e.date = `Cannot be before ${formatDate(current.date_issued)}, when the current holder received it.`;
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';
    const { data, error } = await supabase.rpc('issue_asset', {
      p_asset_id: asset.id, p_employee_id: v.emp, p_department_id: v.dept ? Number(v.dept) : null,
      p_date: v.date, p_previous_condition: v.cond || null, p_remarks: v.remarks || null,
    });
    if (error) return friendlyError(error);
    const revoked = (data as { badges_revoked: number }).badges_revoked;
    toast('ok', `${asset.asset_code} issued to ${employeeName(ix, v.emp)}.${revoked ? ' The previous holder\'s gate pass was revoked — issue a new one if needed.' : ''}`);
    await reload();
    return null;
  }

  return (
    <FormModal open={open} onClose={onClose} title={current ? `Hand over ${asset.asset_code}` : `Issue ${asset.asset_code}`}
      submitLabel={current ? 'Hand over' : 'Issue asset'} onSubmit={submit}
      description="Updates the Asset Register and adds an Assignment History record in one step.">
      {current && (
        <Notice tone="info">
          Currently with <b>{employeeName(ix, current.custodian_id)}</b> since {formatDate(current.date_issued)}. Their record will be closed on the
          hand-over date{ix.ds.badges.some((b) => b.asset_id === asset.id && b.status === 'Active') ? ' and their gate pass revoked' : ''}.
        </Notice>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Issue to" htmlFor="i-emp" required error={errs.emp} className="sm:col-span-2">
          <EmployeePicker id="i-emp" value={v.emp} onChange={(x) => setV({ ...v, emp: x })} invalid={!!errs.emp} />
        </Field>
        <Field label="Department / Location" htmlFor="i-dept" hint="Defaults to the employee's department.">
          <DepartmentPicker id="i-dept" value={v.dept} onChange={(x) => setV({ ...v, dept: x })} />
        </Field>
        <Field label="Date issued" htmlFor="i-date" required error={errs.date}>
          <Input id="i-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} invalid={!!errs.date} />
        </Field>
        {current && (
          <Field label="Condition when returned by the previous holder" htmlFor="i-cond" className="sm:col-span-2">
            <ListPicker id="i-cond" list="return_condition" value={v.cond} onChange={(x) => setV({ ...v, cond: x })} placeholder="Not checked" />
          </Field>
        )}
        <Field label="Remarks" htmlFor="i-remarks" className="sm:col-span-2">
          <Textarea id="i-remarks" rows={2} value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} />
        </Field>
      </div>
    </FormModal>
  );
}

const RETURN_OPTIONS = [
  ['Returned to IT', 'The device is back with IT and can be issued again.'],
  ['Lost/Stolen', 'The device is missing. Its gate pass is marked Lost/Damaged.'],
  ['Decommissioned', 'Retired for good (broken beyond repair, disposed of).'],
  ['Void', 'Encoded by mistake. The code is kept but ignored by every check.'],
] as const;

/** Return to IT, or mark Lost/Stolen, Decommissioned or Void. */
export function ReturnAssetModal({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: Asset }) {
  const { ix, reload } = useData();
  const toast = useToast();
  const current = (ix.assignmentsByAsset.get(asset.id) ?? []).find((h) => !h.date_returned);
  const [v, setV] = useState({ status: 'Returned to IT', date: '', cond: '', remarks: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setV({ status: 'Returned to IT', date: todayISO(), cond: '', remarks: '' }); setErrs({}); } }, [open]);

  async function submit(): Promise<string | null> {
    const e = required(v, { date: 'Date' });
    if (v.status === 'Void' && !v.remarks.trim()) e.remarks = 'Say why this record is void.';
    if (current && v.date && v.date < current.date_issued) e.date = `Cannot be before ${formatDate(current.date_issued)}, when it was issued.`;
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';
    const { data, error } = await supabase.rpc('return_asset', {
      p_asset_id: asset.id, p_date: v.date, p_new_status: v.status, p_condition: v.cond || null, p_remarks: v.remarks || null,
    });
    if (error) return friendlyError(error);
    const r = data as { badges_revoked: number };
    toast('ok', `${asset.asset_code} is now "${v.status}".${r.badges_revoked ? ' Its gate pass was revoked.' : ''}`);
    await reload();
    return null;
  }

  return (
    <FormModal open={open} onClose={onClose} title={`Return or retire ${asset.asset_code}`} submitLabel="Confirm" onSubmit={submit}
      danger={v.status !== 'Returned to IT'}
      description={current ? `Closes ${employeeName(ix, current.custodian_id)}'s record and revokes any active gate pass.` : 'Revokes any active gate pass.'}>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-medium text-ink-2 mb-1.5">What happened?</legend>
        {RETURN_OPTIONS.map(([s, help]) => (
          <label key={s} className={`flex gap-3 items-start rounded-[9px] border px-3 py-2.5 cursor-pointer ${v.status === s ? 'border-primary bg-primary-soft' : 'border-line hover:border-line-strong'}`}>
            <input type="radio" name="ret-status" value={s} checked={v.status === s} onChange={() => setV({ ...v, status: s })} className="mt-1 accent-[var(--color-primary)]" />
            <span><span className="font-medium">{s}</span><span className="block text-[12.5px] text-muted">{help}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Date" htmlFor="r-date" required error={errs.date}>
          <Input id="r-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} invalid={!!errs.date} />
        </Field>
        {current && (
          <Field label="Condition on return" htmlFor="r-cond">
            <ListPicker id="r-cond" list="return_condition" value={v.cond} onChange={(x) => setV({ ...v, cond: x })} placeholder="Not checked" />
          </Field>
        )}
        <Field label="Remarks" htmlFor="r-remarks" error={errs.remarks} required={v.status === 'Void'} className="sm:col-span-2">
          <Textarea id="r-remarks" rows={2} value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} />
        </Field>
      </div>
      {current && <Notice tone="info">Read Me reminder: back up what the company needs, wipe/reimage the unit and set up the admin and guest accounts again before re-issuing.</Notice>}
    </FormModal>
  );
}

/** Active <-> Under Repair, or put a returned/found unit back in service. */
export function StatusModal({ open, onClose, asset, to }: { open: boolean; onClose: () => void; asset: Asset; to: 'Active' | 'Under Repair' }) {
  const { reload } = useData();
  const toast = useToast();
  const [remarks, setRemarks] = useState('');
  useEffect(() => { if (open) setRemarks(''); }, [open]);
  async function submit(): Promise<string | null> {
    const { error } = await supabase.rpc('set_asset_status', { p_asset_id: asset.id, p_status: to, p_remarks: remarks || null });
    if (error) return friendlyError(error);
    toast('ok', `${asset.asset_code} is now "${to}".`);
    await reload();
    return null;
  }
  return (
    <FormModal open={open} onClose={onClose} onSubmit={submit} submitLabel={to === 'Under Repair' ? 'Mark under repair' : 'Put back in service'}
      title={to === 'Under Repair' ? `${asset.asset_code}: under repair` : `${asset.asset_code}: back in service`}
      description={to === 'Under Repair' ? 'The holder stays accountable while it is being repaired.'
        : asset.custodian_id ? 'Marks the asset Active again.' : 'Marks it Active without a holder (e.g. a shared printer). Use "Issue" to give it to someone.'}>
      <Field label="Remarks" htmlFor="s-remarks" hint="Optional — e.g. repair shop, ticket number.">
        <Textarea id="s-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </FormModal>
  );
}
