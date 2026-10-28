import { useData } from '../lib/data';
import type { ListName } from '../lib/types';
import { Select } from './ui';

// Dropdowns fed from the master lists — the web version of the workbook's
// data-validation lists (EmployeeList, DeptList, DeviceTypeList, ...).

type SelProps = { id: string; value: string; onChange: (v: string) => void; invalid?: boolean; required?: boolean; disabled?: boolean };

export function EmployeePicker({ id, value, onChange, invalid, includeSeparated = false, placeholder = 'Choose an employee…', disabled }:
  SelProps & { includeSeparated?: boolean; placeholder?: string }) {
  const { ds } = useData();
  const list = ds.employees
    .filter((e) => includeSeparated || e.employment_status !== 'Resigned/Separated' || e.id === value)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid} disabled={disabled}>
      <option value="">{placeholder}</option>
      {list.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.employment_status !== 'Active' ? ` (${e.employment_status})` : ''}</option>)}
    </Select>
  );
}

export function DepartmentPicker({ id, value, onChange, invalid, placeholder = 'Choose a department…' }: SelProps & { placeholder?: string }) {
  const { ds } = useData();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <option value="">{placeholder}</option>
      {ds.departments.filter((d) => d.is_active || String(d.id) === value).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </Select>
  );
}

export function DeviceTypePicker({ id, value, onChange, invalid, disabled }: SelProps) {
  const { ds } = useData();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid} disabled={disabled}>
      <option value="">Choose a device type…</option>
      {ds.deviceTypes.filter((t) => t.is_active || String(t.id) === value).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
    </Select>
  );
}

export function ListPicker({ id, list, value, onChange, invalid, placeholder = 'Choose…' }: SelProps & { list: ListName; placeholder?: string }) {
  const { ds } = useData();
  const items = ds.listItems.filter((i) => i.list === list && (i.is_active || i.name === value));
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <option value="">{placeholder}</option>
      {items.map((i) => <option key={i.id} value={i.name}>{i.name}</option>)}
      {value && !items.some((i) => i.name === value) && <option value={value}>{value}</option>}
    </Select>
  );
}

export function OptionsSelect({ id, value, onChange, options, placeholder, invalid }:
  SelProps & { options: readonly string[]; placeholder?: string }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </Select>
  );
}

/** Small helper for simple forms: errors keyed by field id. */
export function required(values: Record<string, unknown>, labels: Record<string, string>): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const [k, label] of Object.entries(labels)) {
    const v = values[k];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) errs[k] = `${label} is required.`;
  }
  return errs;
}
