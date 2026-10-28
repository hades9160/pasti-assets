import { useEffect, useState } from 'react';
import { useData } from '../lib/data';
import { friendlyError, supabase } from '../lib/supabase';
import { formatDate, isValidISODate, todayISO } from '../lib/dates';
import { EMPLOYMENT_STATUSES, type Employee } from '../lib/types';
import { FormModal } from './Modal';
import { DepartmentPicker, OptionsSelect, required } from './pickers';
import { Field, Input, Notice, Textarea } from './ui';
import { useToast } from './toast';

const EMPLOYEE_BLANK = { name: '', no: '', dept: '', position: '', status: 'Active', separated: '', signed: '', remarks: '' };

export function EmployeeFormModal({ open, onClose, employee, onSaved }: {
  open: boolean; onClose: () => void; employee?: Employee; onSaved?: (id: string) => void;
}) {
  const { ds, reload } = useData();
  const toast = useToast();
  const [v, setV] = useState(EMPLOYEE_BLANK);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrs({});
    setV(employee ? {
      name: employee.full_name, no: employee.employee_no ?? '', dept: employee.department_id ? String(employee.department_id) : '',
      position: employee.position ?? '', status: employee.employment_status, separated: employee.date_separated ?? '',
      signed: employee.last_form_signed ?? '', remarks: employee.remarks ?? '',
    } : EMPLOYEE_BLANK);
  }, [open, employee]);
  const set = (k: keyof typeof EMPLOYEE_BLANK) => (x: string) => {
    setV((s) => ({ ...s, [k]: x }));
    setErrs((e) => { const { [k]: _gone, ...rest } = e; return rest; });
  };

  const sameName = v.name.trim() && ds.employees.find((e) => e.id !== employee?.id && e.full_name.trim().toLowerCase() === v.name.trim().toLowerCase());

  async function submit(): Promise<string | null> {
    const e = required(v, { name: 'Employee name', dept: 'Department', status: 'Employment status' });
    if (sameName) e.name = `${sameName.full_name} is already on the list.`;
    if (v.status === 'Resigned/Separated' && !v.separated) e.separated = 'Enter the date the employee separated.';
    for (const k of ['separated', 'signed'] as const) if (v[k] && !isValidISODate(v[k])) e[k] = 'Enter a valid date.';
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';
    const row = {
      full_name: v.name.trim(), employee_no: v.no.trim() || null, department_id: Number(v.dept), position: v.position.trim() || null,
      employment_status: v.status, date_separated: v.status === 'Resigned/Separated' ? v.separated : null,
      last_form_signed: v.signed || null, remarks: v.remarks.trim() || null,
    };
    const res = employee
      ? await supabase.from('employees').update(row).eq('id', employee.id).select('id').single()
      : await supabase.from('employees').insert(row).select('id').single();
    if (res.error) return friendlyError(res.error);
    toast('ok', employee ? `Saved ${row.full_name}.` : `Added ${row.full_name}.`);
    await reload();
    onSaved?.(res.data.id);
    return null;
  }

  return (
    <FormModal open={open} onClose={onClose} wide onSubmit={submit} submitLabel={employee ? 'Save changes' : 'Add employee'}
      title={employee ? `Edit ${employee.full_name}` : 'Add an employee'}
      description="Names come from this list everywhere, so they are always spelled the same way.">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Employee name" htmlFor="e-name" required error={errs.name} hint={employee ? 'Renaming updates every record that refers to this person.' : 'Full name, as on company records.'}>
          <Input id="e-name" value={v.name} onChange={(e) => set('name')(e.target.value)} invalid={!!errs.name} />
        </Field>
        <Field label="Employee ID" htmlFor="e-no">
          <Input id="e-no" value={v.no} onChange={(e) => set('no')(e.target.value)} />
        </Field>
        <Field label="Department" htmlFor="e-dept" required error={errs.dept}>
          <DepartmentPicker id="e-dept" value={v.dept} onChange={set('dept')} invalid={!!errs.dept} />
        </Field>
        <Field label="Position" htmlFor="e-pos">
          <Input id="e-pos" value={v.position} onChange={(e) => set('position')(e.target.value)} />
        </Field>
        <Field label="Employment status" htmlFor="e-status" required>
          <OptionsSelect id="e-status" value={v.status} onChange={set('status')} options={EMPLOYMENT_STATUSES} />
        </Field>
        {v.status === 'Resigned/Separated' && (
          <Field label="Date separated" htmlFor="e-sep" required error={errs.separated}>
            <Input id="e-sep" type="date" value={v.separated} onChange={(e) => set('separated')(e.target.value)} invalid={!!errs.separated} />
          </Field>
        )}
        <Field label="Last form signed" htmlFor="e-signed" error={errs.signed} hint="Date of the last signed accountability form. Items issued after it show as NEW.">
          <Input id="e-signed" type="date" value={v.signed} onChange={(e) => set('signed')(e.target.value)} invalid={!!errs.signed} />
        </Field>
        <Field label="Remarks" htmlFor="e-remarks" className="sm:col-span-2">
          <Textarea id="e-remarks" rows={2} value={v.remarks} onChange={(e) => set('remarks')(e.target.value)} />
        </Field>
      </div>
      {v.status === 'Resigned/Separated' && employee?.employment_status !== 'Resigned/Separated' && (
        <Notice tone="info">Exit clearance will list every device, accessory and gate pass still to be collected.</Notice>
      )}
    </FormModal>
  );
}

/** Step 3 of the signing workflow: print, sign, then record the date here. */
export function FormSignedModal({ open, onClose, employee }: { open: boolean; onClose: () => void; employee: Employee }) {
  const { reload } = useData();
  const toast = useToast();
  const [date, setDate] = useState('');
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => { if (open) { setDate(todayISO()); setErr(undefined); } }, [open]);
  async function submit(): Promise<string | null> {
    if (!isValidISODate(date)) { setErr('Enter a valid date.'); return 'Please fix the highlighted field.'; }
    const { error } = await supabase.from('employees').update({ last_form_signed: date }).eq('id', employee.id);
    if (error) return friendlyError(error);
    toast('ok', `Recorded ${employee.full_name}'s signed form dated ${formatDate(date)}.`);
    await reload();
    return null;
  }
  return (
    <FormModal open={open} onClose={onClose} onSubmit={submit} submitLabel="Save date" title="Record a signed form"
      description={`Enter the date ${employee.full_name} signed the printed accountability form.`}>
      <Field label="Date signed" htmlFor="fs-date" required error={err}>
        <Input id="fs-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!err} />
      </Field>
    </FormModal>
  );
}
