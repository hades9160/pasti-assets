// ============================================================================
// Reading the existing workbook for the initial import.
// Columns are matched by header name (so moved columns still work), every row
// is validated, and rows that depend on a rejected row are rejected too —
// e.g. an asset whose custodian was rejected on the Employees sheet. Only
// entered values are imported; calculated columns are recomputed by the app.
// ============================================================================
import * as XLSX from 'xlsx';
import { excelFractionToTime, excelSerialToISO, isValidISODate } from './dates';
import { ASSET_STATUSES, BADGE_STATUSES, BYOD_STATUSES, EMPLOYMENT_STATUSES, OWNERSHIP_TYPES } from './types';

export type FieldKind = 'text' | 'date' | 'time' | 'int' | 'bool';

export interface FieldSpec {
  key: string;
  label: string;
  headers: string[];   // accepted header spellings, first one is the workbook's
  kind: FieldKind;
  required?: boolean;
}

export interface SheetSpec {
  key: SheetKey;
  label: string;
  sheetNames: string[];
  primary: string;      // a row is blank when this field is empty
  fields: FieldSpec[];
}

export type SheetKey = 'type_codes' | 'lists' | 'employees' | 'assets' | 'byod' | 'assignments' | 'badges' | 'accessories' | 'gate';

const f = (key: string, label: string, kind: FieldKind = 'text', required = false, more: string[] = []): FieldSpec =>
  ({ key, label, headers: [label, ...more], kind, required });

export const SHEETS: SheetSpec[] = [
  {
    key: 'type_codes', label: 'Type Codes', sheetNames: ['Type Codes'], primary: 'name',
    fields: [f('name', 'Device Type', 'text', true), f('code', 'Type Code', 'text', true), f('description', 'Description')],
  },
  {
    key: 'lists', label: 'Lists', sheetNames: ['Lists'], primary: 'departments',
    fields: [f('departments', 'Departments'), f('accessory_types', 'Accessory Types'), f('reasons', 'Reason Issued'),
      f('conditions', 'Condition on Return')],
  },
  {
    key: 'employees', label: 'Employees', sheetNames: ['Employees'], primary: 'full_name',
    fields: [f('full_name', 'Employee Name', 'text', true, ['Name', 'Full Name']), f('employee_no', 'Employee ID'),
      f('department', 'Department'), f('position', 'Position'), f('employment_status', 'Employment Status'),
      f('date_separated', 'Date Separated', 'date'), f('last_form_signed', 'Last Form Signed', 'date'), f('remarks', 'Remarks')],
  },
  {
    key: 'assets', label: 'Asset Register', sheetNames: ['Asset Register'], primary: 'asset_code',
    fields: [f('date_encoded', 'Date Encoded', 'date', true), f('device_type', 'Device Type', 'text', true),
      f('asset_code', 'Asset Code', 'text', true), f('brand_model', 'Brand / Model', 'text', false, ['Brand/Model']),
      f('serial_number', 'Serial Number'), f('custodian', 'Custodian / Keeper', 'text', false, ['Custodian/Keeper', 'Custodian']),
      f('department', 'Department / Location', 'text', false, ['Department/Location', 'Department']),
      f('status', 'Status', 'text', true), f('remarks', 'Remarks')],
  },
  {
    key: 'byod', label: 'Employee-Owned Devices', sheetNames: ['Employee-Owned Devices'], primary: 'byod_code',
    fields: [f('date_registered', 'Date Registered', 'date', true), f('device_type', 'Device Type', 'text', true),
      f('byod_code', 'Asset Code', 'text', true, ['BYOD Code']), f('brand_model', 'Brand / Model', 'text', false, ['Brand/Model']),
      f('serial_number', 'Serial Number'), f('owner', 'Employee Name (Owner)', 'text', false, ['Owner', 'Employee Name']),
      f('department', 'Department / Location', 'text', false, ['Department']),
      f('consent_signed', 'Consent Form Signed?', 'bool'), f('status', 'Status'), f('remarks', 'Remarks')],
  },
  {
    key: 'assignments', label: 'Assignment History', sheetNames: ['Assignment History'], primary: 'asset_code',
    fields: [f('asset_code', 'Asset Code', 'text', true), f('custodian', 'Custodian / Keeper', 'text', true, ['Custodian']),
      f('department', 'Department / Location', 'text', false, ['Department']), f('date_issued', 'Date Issued', 'date', true),
      f('date_returned', 'Date Returned', 'date'), f('return_condition', 'Condition on Return'),
      f('badge_code', 'Badge ID Issued'), f('remarks', 'Remarks')],
  },
  {
    key: 'badges', label: 'Device Pass Badge Register', sheetNames: ['Device Pass Badge Register'], primary: 'date_issued',
    fields: [f('date_issued', 'Date Issued', 'date', true), f('ownership', 'Ownership Type', 'text', true),
      f('serial_number', 'Serial Number', 'text', true), f('replaces_badge_code', 'Replacement of Badge ID'),
      f('badge_code', 'Badge ID', 'text', true), f('holder', 'Owner / Custodian', 'text', true),
      f('holder_department', 'Department / Location', 'text', false, ['Department']),
      f('status', 'Status', 'text', true), f('remarks', 'Remarks')],
  },
  {
    key: 'accessories', label: 'Accessory Log', sheetNames: ['Accessory Log'], primary: 'employee',
    fields: [f('date_issued', 'Date Issued', 'date', true), f('employee', 'Employee', 'text', true),
      f('accessory_type', 'Accessory', 'text', true), f('brand_model', 'Brand / Model'), f('serial_tag', 'Serial / Tag No.'),
      f('qty', 'Qty', 'int', true), f('for_asset_code', 'For Device (Asset Code)'), f('reason', 'Reason Issued'),
      f('date_returned', 'Date Returned', 'date'), f('return_condition', 'Condition on Return'), f('remarks', 'Remarks')],
  },
  {
    key: 'gate', label: 'Gate Movement Log', sheetNames: ['Gate Movement Log'], primary: 'badge_code',
    fields: [f('moved_on', 'Date', 'date', true), f('moved_time', 'Time', 'time', true), f('badge_code', 'Badge ID', 'text', true),
      f('direction', 'IN / OUT', 'text', true, ['IN/OUT', 'Direction']), f('guard_name', 'Guard on Duty', 'text', true),
      f('remarks', 'Remarks')],
  },
];

// ---------------------------------------------------------------------------

export interface RawSheet { name: string; headers: string[]; rows: unknown[][] }
export interface WorkbookFile { fileName: string; sheets: RawSheet[]; date1904: boolean }

export function readWorkbook(data: ArrayBuffer, fileName: string): WorkbookFile {
  const wb = XLSX.read(data, { type: 'array', cellDates: false, cellFormula: false, cellHTML: false });
  const sheets = wb.SheetNames.map((name) => {
    const all = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, raw: true, blankrows: true });
    // The register sheets start at A1; keep row numbers equal to Excel's.
    const ref = wb.Sheets[name]['!ref'];
    const startRow = ref ? XLSX.utils.decode_range(ref).s.r : 0;
    const padded: unknown[][] = [...Array(startRow).fill([]), ...all];
    return { name, headers: (padded[0] ?? []).map((h) => (h == null ? '' : String(h).trim())), rows: padded };
  });
  return { fileName, sheets, date1904: Boolean(wb.Workbook?.WBProps?.date1904) };
}

const headerKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** field key -> column index (-1 = not mapped) */
export type Mapping = Record<string, number>;

export function findSheet(file: WorkbookFile, spec: SheetSpec): RawSheet | undefined {
  const wanted = spec.sheetNames.map(headerKey);
  return file.sheets.find((s) => wanted.includes(headerKey(s.name)));
}

export function autoMap(spec: SheetSpec, headers: string[]): Mapping {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const m: Mapping = {};
  for (const fld of spec.fields) {
    let idx = -1;
    for (const h of fld.headers) {
      idx = keys.findIndex((k, i) => k === headerKey(h) && !used.has(i));
      if (idx >= 0) break;
    }
    if (idx >= 0) used.add(idx);
    m[fld.key] = idx;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Cell conversion
// ---------------------------------------------------------------------------

const MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function toText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}

function toDate(v: unknown, date1904: boolean): string | null | 'invalid' {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelSerialToISO(v, date1904);
  const s = String(v).trim();
  if (isValidISODate(s.slice(0, 10))) return s.slice(0, 10);
  const m = MDY.exec(s);
  if (m) {
    const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (isValidISODate(iso)) return iso;
  }
  return 'invalid';
}

function toTime(v: unknown): string | null | 'invalid' {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelFractionToTime(v);
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(String(v).trim());
  if (!m) return 'invalid';
  let h = +m[1];
  if (m[3]) h = (h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return h < 24 && +m[2] < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : 'invalid';
}

// ---------------------------------------------------------------------------
// Validation and payload
// ---------------------------------------------------------------------------

export interface RowIssue { row: number; message: string }

export interface SheetReport {
  key: SheetKey;
  label: string;
  sheetName: string | null;
  headers: string[];
  mapping: Mapping;
  missingColumns: string[];   // required fields with no column
  total: number;              // non-blank rows
  valid: number;
  invalid: RowIssue[];
  warnings: RowIssue[];
}

export interface ImportPayload {
  file_name: string;
  departments: { name: string }[];
  device_types: { name: string; code: string; description: string | null; sort_order: number }[];
  list_items: { list: string; name: string; sort_order: number }[];
  employees: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  byod: Record<string, unknown>[];
  assignments: Record<string, unknown>[];
  badges: Record<string, unknown>[];
  accessories: Record<string, unknown>[];
  gate_movements: Record<string, unknown>[];
}

export interface ImportPlan { payload: ImportPayload; reports: SheetReport[]; canImport: boolean }

const ASSET_CODE = /^PASTI-([A-Z]{3})-(\d{2})-(\d{4,})$/;
const BYOD_CODE = /^PASTI-BYOD-([A-Z]{3})-(\d{2})-(\d{4,})$/;
const BADGE_CODE = /^PASTI-EDP-([A-Z]{3})-(\d{2})-(\d{4,})$/;
const ci = (s: string) => s.trim().toLowerCase();
const nserial = (s: string) => s.trim().toUpperCase();

export function planImport(file: WorkbookFile, mappings: Partial<Record<SheetKey, Mapping>> = {}): ImportPlan {
  const reports: SheetReport[] = [];
  const payload: ImportPayload = {
    file_name: file.fileName, departments: [], device_types: [], list_items: [], employees: [], assets: [],
    byod: [], assignments: [], badges: [], accessories: [], gate_movements: [],
  };

  // Read every sheet into objects first.
  type Row = { row: number; v: Record<string, unknown> };
  const rowsOf: Partial<Record<SheetKey, Row[]>> = {};
  for (const spec of SHEETS) {
    const sheet = findSheet(file, spec);
    const mapping = mappings[spec.key] ?? (sheet ? autoMap(spec, sheet.headers) : {});
    const rep: SheetReport = {
      key: spec.key, label: spec.label, sheetName: sheet?.name ?? null, headers: sheet?.headers ?? [], mapping,
      missingColumns: sheet ? spec.fields.filter((fl) => fl.required && (mapping[fl.key] ?? -1) < 0).map((fl) => fl.label) : [],
      total: 0, valid: 0, invalid: [], warnings: [],
    };
    reports.push(rep);
    const rows: Row[] = [];
    if (sheet && !rep.missingColumns.length) {
      for (let r = 1; r < sheet.rows.length; r++) {
        const raw = sheet.rows[r] ?? [];
        const v: Record<string, unknown> = {};
        for (const fl of spec.fields) {
          const idx = mapping[fl.key] ?? -1;
          v[fl.key] = idx >= 0 ? raw[idx] ?? null : null;
        }
        if (spec.key !== 'lists' && toText(v[spec.primary]) === '') continue;
        rows.push({ row: r + 1, v });
      }
    }
    rowsOf[spec.key] = rows;
  }
  const rep = (k: SheetKey) => reports.find((r) => r.key === k)!;

  // Generic per-field conversion; returns null when the row is invalid.
  function convert(spec: SheetSpec, row: Row, report: SheetReport): Record<string, unknown> | null {
    const out: Record<string, unknown> = { row: row.row };
    const errors: string[] = [];
    for (const fl of spec.fields) {
      const raw = row.v[fl.key];
      let val: unknown;
      if (fl.kind === 'date') {
        const d = toDate(raw, file.date1904);
        if (d === 'invalid') errors.push(`${fl.label} "${toText(raw)}" is not a valid date`);
        val = d === 'invalid' ? null : d;
      } else if (fl.kind === 'time') {
        const t = toTime(raw);
        if (t === 'invalid') errors.push(`${fl.label} "${toText(raw)}" is not a valid time`);
        val = t === 'invalid' ? null : t;
      } else if (fl.kind === 'int') {
        const s = toText(raw);
        const n = Number(s);
        if (s !== '' && !(Number.isInteger(n))) errors.push(`${fl.label} "${s}" is not a whole number`);
        val = s === '' ? null : n;
      } else if (fl.kind === 'bool') {
        const s = ci(toText(raw));
        val = s === 'yes' || s === 'true' ? true : s === 'no' || s === 'false' ? false : null;
        if (s && val === null) errors.push(`${fl.label} must be Yes or No`);
      } else {
        val = toText(raw);
      }
      if (fl.required && (val === null || val === '')) errors.push(`${fl.label} is empty`);
      out[fl.key] = val;
    }
    if (errors.length) {
      report.invalid.push({ row: row.row, message: errors.join('; ') });
      return null;
    }
    return out;
  }

  // ---- Lists and Type Codes ----
  const departments = new Map<string, string>();   // ci -> display
  const addDept = (name: string) => { if (name && !departments.has(ci(name))) departments.set(ci(name), name.trim()); };
  const lists = rowsOf.lists ?? [];
  const listOrder: Record<string, number> = {};
  for (const r of lists) {
    const pick = (k: string) => {
      const s = toText(r.v[k]);
      return s && !/^add new items/i.test(s) ? s : '';
    };
    addDept(pick('departments'));
    for (const [k, list] of [['accessory_types', 'accessory_type'], ['reasons', 'issue_reason'], ['conditions', 'return_condition']] as const) {
      const s = pick(k);
      if (s) payload.list_items.push({ list, name: s, sort_order: (listOrder[list] = (listOrder[list] ?? 0) + 1) });
    }
    if (pick('departments') || pick('accessory_types')) rep('lists').total++;
  }
  rep('lists').valid = rep('lists').total;

  const types = new Map<string, { name: string; code: string }>();  // ci name -> type
  const typeCodes = new Set<string>();
  for (const r of rowsOf.type_codes ?? []) {
    const report = rep('type_codes');
    report.total++;
    const o = convert(SHEETS[0], r, report);
    if (!o) continue;
    const code = String(o.code).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) { report.invalid.push({ row: r.row, message: `Type Code "${code}" must be 3 letters` }); continue; }
    if (typeCodes.has(code) || types.has(ci(String(o.name)))) { report.invalid.push({ row: r.row, message: 'Duplicate device type' }); continue; }
    typeCodes.add(code);
    types.set(ci(String(o.name)), { name: String(o.name), code });
    payload.device_types.push({ name: String(o.name), code, description: (o.description as string) || null, sort_order: report.valid + 1 });
    report.valid++;
  }
  const typeFor = (name: string) => types.get(ci(name));

  // ---- Employees ----
  const employees = new Set<string>();  // ci names that will be imported
  {
    const spec = SHEETS.find((s) => s.key === 'employees')!;
    const report = rep('employees');
    for (const r of rowsOf.employees ?? []) {
      report.total++;
      const o = convert(spec, r, report);
      if (!o) continue;
      const name = String(o.full_name);
      if (employees.has(ci(name))) { report.invalid.push({ row: r.row, message: `"${name}" appears more than once` }); continue; }
      const status = String(o.employment_status || 'Active');
      if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(status)) {
        report.invalid.push({ row: r.row, message: `Employment Status "${status}" is not one of ${EMPLOYMENT_STATUSES.join(', ')}` });
        continue;
      }
      const dept = String(o.department || '');
      if (dept && !departments.has(ci(dept))) report.warnings.push({ row: r.row, message: `Department "${dept}" is not on the Lists sheet; it will be added` });
      addDept(dept);
      if (!dept) report.warnings.push({ row: r.row, message: `${name} has no department` });
      employees.add(ci(name));
      payload.employees.push({ ...o, employment_status: status });
      report.valid++;
    }
  }
  const empOk = (name: unknown) => !toText(name) || employees.has(ci(toText(name)));

  // Serial sets for the cross-register rule, taken before validation.
  const byodSerials = new Set((rowsOf.byod ?? []).map((r) => nserial(toText(r.v.serial_number))).filter(Boolean));
  const liveAssetSerials = new Set((rowsOf.assets ?? [])
    .filter((r) => toText(r.v.status) !== 'Void').map((r) => nserial(toText(r.v.serial_number))).filter(Boolean));

  // ---- Asset Register ----
  const assetCodes = new Set<string>();
  const assetSerial = new Map<string, { code: string; status: string }>();  // serial -> first non-void (else void) row
  {
    const spec = SHEETS.find((s) => s.key === 'assets')!;
    const report = rep('assets');
    for (const r of rowsOf.assets ?? []) {
      report.total++;
      const o = convert(spec, r, report);
      if (!o) continue;
      const code = String(o.asset_code).toUpperCase();
      const m = ASSET_CODE.exec(code);
      const type = typeFor(String(o.device_type));
      const status = String(o.status);
      const serial = nserial(String(o.serial_number || ''));
      const errs: string[] = [];
      if (!m) errs.push(`Asset Code "${code}" is not in the PASTI-TYPE-YY-#### format`);
      if (!type) errs.push(`Device Type "${o.device_type}" is not on the Type Codes sheet`);
      if (m && type && m[1] !== type.code) errs.push(`Asset Code type ${m[1]} does not match device type ${type.name} (${type.code})`);
      if (m && Number(m[2]) !== Number(String(o.date_encoded).slice(2, 4))) {
        report.warnings.push({ row: r.row, message: `Code year ${m[2]} differs from Date Encoded ${o.date_encoded}; the code is kept as issued` });
      }
      if (!(ASSET_STATUSES as readonly string[]).includes(status)) errs.push(`Status "${status}" is not valid`);
      if (assetCodes.has(code)) errs.push(`Asset Code ${code} appears more than once`);
      if (!empOk(o.custodian)) errs.push(`Custodian "${o.custodian}" is not on the Employees sheet (or that row was rejected)`);
      if (serial && status !== 'Void') {
        const prev = assetSerial.get(serial);
        if (prev && prev.status !== 'Void') errs.push(`Serial ${serial} is already used by ${prev.code}`);
        if (byodSerials.has(serial)) errs.push(`Serial ${serial} is also on Employee-Owned Devices — a unit is either company- or employee-owned`);
      }
      if (errs.length) { report.invalid.push({ row: r.row, message: errs.join('; ') }); continue; }
      if (type && type.name !== String(o.device_type)) {
        report.warnings.push({ row: r.row, message: `Device Type "${o.device_type}" read as "${type.name}"` });
      }
      addDept(String(o.department || ''));
      assetCodes.add(code);
      if (serial && (!assetSerial.has(serial) || assetSerial.get(serial)!.status === 'Void')) assetSerial.set(serial, { code, status });
      payload.assets.push({
        ...o, asset_code: code, device_type: type!.name, type_code: m![1],
        code_year: 2000 + Number(m![2]), sequence_no: Number(m![3]),
      });
      report.valid++;
    }
  }

  // ---- Employee-Owned Devices ----
  const byodBySerial = new Map<string, string>();
  {
    const spec = SHEETS.find((s) => s.key === 'byod')!;
    const report = rep('byod');
    const codes = new Set<string>();
    for (const r of rowsOf.byod ?? []) {
      report.total++;
      const o = convert(spec, r, report);
      if (!o) continue;
      const code = String(o.byod_code).toUpperCase();
      const m = BYOD_CODE.exec(code);
      const type = typeFor(String(o.device_type));
      const serial = nserial(String(o.serial_number || ''));
      const status = String(o.status || '');
      const errs: string[] = [];
      if (!m) errs.push(`Code "${code}" is not in the PASTI-BYOD-TYPE-YY-#### format`);
      if (!type) errs.push(`Device Type "${o.device_type}" is not on the Type Codes sheet`);
      if (m && type && m[1] !== type.code) errs.push(`Code type ${m[1]} does not match device type ${type.name}`);
      if (status && !(BYOD_STATUSES as readonly string[]).includes(status)) errs.push(`Status "${status}" is not valid`);
      if (codes.has(code)) errs.push(`Code ${code} appears more than once`);
      if (serial && byodBySerial.has(serial)) errs.push(`Serial ${serial} is already used by ${byodBySerial.get(serial)}`);
      if (serial && liveAssetSerials.has(serial)) errs.push(`Serial ${serial} is also on the Asset Register (not void)`);
      if (!empOk(o.owner)) errs.push(`Owner "${o.owner}" is not on the Employees sheet (or that row was rejected)`);
      if (errs.length) { report.invalid.push({ row: r.row, message: errs.join('; ') }); continue; }
      if (!serial) report.warnings.push({ row: r.row, message: `${code} has no serial number` });
      if (!o.owner) report.warnings.push({ row: r.row, message: `${code} has no owner` });
      if (!status) report.warnings.push({ row: r.row, message: `${code} has no status` });
      addDept(String(o.department || ''));
      codes.add(code);
      if (serial) byodBySerial.set(serial, code);
      payload.byod.push({
        ...o, byod_code: code, device_type: type!.name, type_code: m![1], code_year: 2000 + Number(m![2]),
        sequence_no: Number(m![3]), status: status || null,
      });
      report.valid++;
    }
  }

  // ---- Assignment History ----
  {
    const spec = SHEETS.find((s) => s.key === 'assignments')!;
    const report = rep('assignments');
    const open = new Map<string, number>();
    for (const r of rowsOf.assignments ?? []) {
      report.total++;
      const o = convert(spec, r, report);
      if (!o) continue;
      const code = String(o.asset_code).toUpperCase();
      const errs: string[] = [];
      if (!assetCodes.has(code)) errs.push(`Asset Code ${code} is not on the Asset Register (or that row was rejected)`);
      if (!empOk(o.custodian)) errs.push(`Custodian "${o.custodian}" is not on the Employees sheet (or that row was rejected)`);
      if (o.date_returned && String(o.date_returned) < String(o.date_issued)) errs.push('Date Returned is before Date Issued');
      if (!o.date_returned && open.has(code)) errs.push(`${code} already has a current holder on row ${open.get(code)} — close that record first`);
      if (errs.length) { report.invalid.push({ row: r.row, message: errs.join('; ') }); continue; }
      if (!o.date_returned) open.set(code, r.row);
      addDept(String(o.department || ''));
      payload.assignments.push({ ...o, asset_code: code });
      report.valid++;
    }
  }

  // ---- Device Pass Badge Register ----
  {
    const spec = SHEETS.find((s) => s.key === 'badges')!;
    const report = rep('badges');
    const newCodes = new Set<string>();
    const activeDevice = new Map<string, number>();
    const activeCode = new Map<string, number>();
    for (const r of rowsOf.badges ?? []) {
      report.total++;
      const o = convert(spec, r, report);
      if (!o) continue;
      const code = String(o.badge_code).toUpperCase();
      const replaces = String(o.replaces_badge_code || '').toUpperCase();
      const m = BADGE_CODE.exec(code);
      const serial = nserial(String(o.serial_number));
      const ownership = String(o.ownership);
      const status = String(o.status);
      const errs: string[] = [];
      if (!(OWNERSHIP_TYPES as readonly string[]).includes(ownership)) errs.push(`Ownership Type "${ownership}" is not valid`);
      if (!m) errs.push(`Badge ID "${code}" is not in the PASTI-EDP-TYPE-YY-#### format`);
      if (!(BADGE_STATUSES as readonly string[]).includes(status)) errs.push(`Status "${status}" is not valid`);
      const device = ownership === 'Company-Owned' ? assetSerial.get(serial)?.code : byodBySerial.get(serial);
      if (!device) errs.push(`Serial ${serial} is not on the ${ownership === 'Company-Owned' ? 'Asset Register' : 'Employee-Owned Devices'} sheet (or that row was rejected)`);
      if (String(o.holder).startsWith('⚠') || !empOk(o.holder)) errs.push(`Owner/Custodian "${o.holder}" is not an employee`);
      if (replaces && replaces !== code) errs.push(`Replacement of Badge ID ${replaces} differs from Badge ID ${code}`);
      if (!replaces && newCodes.has(code)) errs.push(`Badge ID ${code} was already issued — mark the new row as a replacement`);
      if (status === 'Active' && device && activeDevice.has(device)) errs.push(`${device} already has an active badge (row ${activeDevice.get(device)})`);
      if (status === 'Active' && activeCode.has(code)) errs.push(`Badge ID ${code} is already active on row ${activeCode.get(code)}`);
      if (errs.length) { report.invalid.push({ row: r.row, message: errs.join('; ') }); continue; }
      if (!replaces) newCodes.add(code);
      if (status === 'Active') { activeDevice.set(device!, r.row); activeCode.set(code, r.row); }
      addDept(String(o.holder_department || ''));
      payload.badges.push({
        ...o, badge_code: code, replaces_badge_code: replaces || null, ownership, serial_number: serial,
        type_code: m![1], code_year: 2000 + Number(m![2]), sequence_no: replaces ? null : Number(m![3]),
      });
      report.valid++;
    }
  }

  // ---- Accessory Log ----
  {
    const spec = SHEETS.find((s) => s.key === 'accessories')!;
    const report = rep('accessories');
    for (const r of rowsOf.accessories ?? []) {
      report.total++;
      const o = convert(spec, r, report);
      if (!o) continue;
      const errs: string[] = [];
      if (!empOk(o.employee)) errs.push(`Employee "${o.employee}" is not on the Employees sheet (or that row was rejected)`);
      if (!(Number(o.qty) > 0)) errs.push('Qty must be more than zero');
      const forCode = String(o.for_asset_code || '').toUpperCase();
      if (forCode && !assetCodes.has(forCode)) errs.push(`For Device ${forCode} is not on the Asset Register`);
      if (o.date_returned && String(o.date_returned) < String(o.date_issued)) errs.push('Date Returned is before Date Issued');
      if (errs.length) { report.invalid.push({ row: r.row, message: errs.join('; ') }); continue; }
      payload.accessories.push({ ...o, for_asset_code: forCode || null });
      report.valid++;
    }
  }

  // ---- Gate Movement Log ----
  {
    const spec = SHEETS.find((s) => s.key === 'gate')!;
    const report = rep('gate');
    for (const r of rowsOf.gate ?? []) {
      report.total++;
      const o = convert(spec, r, report);
      if (!o) continue;
      const dir = String(o.direction).toUpperCase();
      if (dir !== 'IN' && dir !== 'OUT') { report.invalid.push({ row: r.row, message: 'IN / OUT must be IN or OUT' }); continue; }
      payload.gate_movements.push({ ...o, direction: dir, badge_code: String(o.badge_code).toUpperCase() });
      report.valid++;
    }
  }

  payload.departments = [...departments.values()].map((name) => ({ name }));
  const canImport = reports.every((r) => !r.missingColumns.length) && payload.employees.length + payload.assets.length > 0;
  return { payload, reports, canImport };
}
