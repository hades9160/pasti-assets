// ============================================================================
// Workbook calculations, one function per calculated column of
// PASTI_Asset_Code_Registerv2.xlsx. Each comment names the column it replaces.
// Messages are worded exactly like the workbook so staff recognise them.
// tests/rules.test.ts checks these against the values Excel itself computed.
// ============================================================================
import { addMonths, daysBetween } from './dates';
import {
  NOT_ISSUED_STATUSES,
  type Accessory, type Asset, type Assignment, type Badge, type ByodDevice, type Dataset, type Employee,
  type GateMovement,
} from './types';

export const BADGE_VALID_MONTHS = 3;
export const BADGE_WARNING_DAYS = 14;

const norm = (s: string | null | undefined) => (s ?? '').toString().trim().toUpperCase();

/** Lookups built once per dataset so every rule is a cheap map read. */
export interface Index {
  ds: Dataset;
  employee: Map<string, Employee>;
  asset: Map<string, Asset>;
  byod: Map<string, ByodDevice>;
  deviceTypeById: Map<number, Dataset['deviceTypes'][number]>;
  departmentById: Map<number, Dataset['departments'][number]>;
  assignmentsByAsset: Map<string, Assignment[]>;
  badgesByCode: Map<string, Badge[]>;       // in row order
  gateByCode: Map<string, GateMovement[]>;  // in logging order
}

export function buildIndex(ds: Dataset): Index {
  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) {
      const k = key(r);
      const list = m.get(k);
      if (list) list.push(r); else m.set(k, [r]);
    }
    return m;
  };
  const badges = [...ds.badges].sort((a, b) => a.row_no - b.row_no);
  const gate = [...ds.gateMovements].sort((a, b) =>
    (a.moved_on + a.moved_time + a.created_at).localeCompare(b.moved_on + b.moved_time + b.created_at));
  return {
    ds,
    employee: new Map(ds.employees.map((e) => [e.id, e])),
    asset: new Map(ds.assets.map((a) => [a.id, a])),
    byod: new Map(ds.byod.map((b) => [b.id, b])),
    deviceTypeById: new Map(ds.deviceTypes.map((t) => [t.id, t])),
    departmentById: new Map(ds.departments.map((d) => [d.id, d])),
    assignmentsByAsset: group(ds.assignments, (a) => a.asset_id),
    badgesByCode: group(badges, (b) => b.badge_code),
    gateByCode: group(gate, (g) => g.badge_code),
  };
}

export const employeeName = (ix: Index, id: string | null | undefined) => (id ? ix.employee.get(id)?.full_name ?? '' : '');
export const departmentName = (ix: Index, id: number | null | undefined) => (id ? ix.departmentById.get(id)?.name ?? '' : '');
export const deviceTypeName = (ix: Index, id: number) => ix.deviceTypeById.get(id)?.name ?? '';

// ---------------------------------------------------------------------------
// Asset Register
// ---------------------------------------------------------------------------

/** Asset Register "Active Badge ID" */
export function assetActiveBadge(ix: Index, a: Asset): string {
  if (a.status === 'Void') return '—';
  const active = ix.ds.badges.filter((b) => b.asset_id === a.id && b.ownership === 'Company-Owned' && b.status === 'Active');
  if (!active.length) return 'No active badge';
  return active.sort((x, y) => x.row_no - y.row_no)[active.length - 1].badge_code;
}

/** Asset Register "Also in BYOD Sheet?" */
export function assetAlsoInByod(ix: Index, a: Asset): string {
  if (!norm(a.serial_number)) return '';
  if (a.status === 'Void') return 'Void';
  return ix.ds.byod.some((b) => norm(b.serial_number) === norm(a.serial_number)) ? '⚠ Also in BYOD' : 'OK';
}

/** Asset Register "In Assignment History?" */
export function assetInHistory(ix: Index, a: Asset): string {
  if (!a.custodian_id) return '';
  if (NOT_ISSUED_STATUSES.includes(a.status)) return 'OK (not issued)';
  const open = (ix.assignmentsByAsset.get(a.id) ?? []).some((h) => h.custodian_id === a.custodian_id && !h.date_returned);
  return open ? 'OK' : '⚠ Not in Assignment History';
}

/** Read Me: placeholder serials such as 'OrtizMonitor', 'DESKTOP-001', '1234567890'. */
export function isPlaceholderSerial(serial: string): boolean {
  const s = serial.toString();
  return s === '1234567890' || /monitor/i.test(s) || s.toLowerCase().includes('-00') || !/[0-9]/.test(s);
}

/** Asset Register "Alerts" — empty list means OK. */
export function assetAlerts(ix: Index, a: Asset): string[] {
  if (a.status === 'Void') return [];
  const out: string[] = [];
  const type = ix.deviceTypeById.get(a.device_type_id);
  if (ix.ds.assets.filter((x) => x.asset_code === a.asset_code).length > 1) out.push('⚠ Duplicate asset code');
  if (type?.requires_gate_pass && a.status === 'Active' && assetActiveBadge(ix, a) === 'No active badge') out.push('⚠ Needs gate pass');
  if (!norm(a.serial_number)) out.push('⚠ No serial number');
  else if (isPlaceholderSerial(a.serial_number!)) out.push('⚠ Placeholder serial – enter the real one');
  if (!norm(a.brand_model)) out.push('⚠ Brand/Model missing');
  if (a.custodian_id && !ix.employee.has(a.custodian_id)) out.push('⚠ Custodian not in Employee List');
  return out;
}

/** The text the workbook shows in the Alerts cell. */
export function assetAlertsText(ix: Index, a: Asset): string {
  if (a.status === 'Void') return 'Void – not counted';
  const list = assetAlerts(ix, a);
  return list.length ? list.map((m) => m + ' ').join('') : 'OK';
}

/** Last person who held an asset (the register shows nobody once it is back with IT). */
export function lastHolder(ix: Index, a: Asset): Assignment | undefined {
  const rows = ix.assignmentsByAsset.get(a.id) ?? [];
  return [...rows].sort((x, y) => (x.date_issued + x.created_at).localeCompare(y.date_issued + y.created_at)).at(-1);
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export interface EmployeeStats {
  devicesHeld: number;
  accessoriesHeld: number;
  activeBadges: number;
  newItemsSinceSigned: number;
  formStatus: string;
  exitClearance: string;
  checks: string[];
}

/** Employees "Devices Held", "Accessories Held", "Active Badges", "Form Status", "Exit Clearance", "Check" */
export function employeeStats(ix: Index, e: Employee): EmployeeStats {
  const devicesHeld = ix.ds.assets.filter((a) => a.custodian_id === e.id && (a.status === 'Active' || a.status === 'Under Repair')).length;
  const openAccessories = ix.ds.accessories.filter((x) => x.employee_id === e.id && !x.date_returned);
  const accessoriesHeld = openAccessories.reduce((s, x) => s + x.qty, 0);
  const activeBadges = ix.ds.badges.filter((b) => b.holder_id === e.id && b.status === 'Active').length;

  let newItemsSinceSigned = 0;
  let formStatus: string;
  if (devicesHeld + accessoriesHeld === 0) formStatus = '—';
  else if (!e.last_form_signed) formStatus = 'Enter date of last signed form';
  else {
    const signed = e.last_form_signed;
    newItemsSinceSigned =
      ix.ds.assignments.filter((h) => h.custodian_id === e.id && !h.date_returned && h.date_issued > signed).length +
      openAccessories.filter((x) => x.date_issued > signed).length;
    formStatus = newItemsSinceSigned > 0 ? `⚠ ${newItemsSinceSigned} new item(s) – print & sign` : 'Signed ✓';
  }

  let exitClearance = '';
  if (e.employment_status === 'Resigned/Separated') {
    exitClearance = devicesHeld + accessoriesHeld + activeBadges === 0
      ? 'Cleared ✓'
      : `⚠ Not cleared: ${devicesHeld} device(s), ${accessoriesHeld} accessory(ies), ${activeBadges} active badge(s)`;
  }

  const checks: string[] = [];
  if (ix.ds.employees.filter((x) => norm(x.full_name) === norm(e.full_name)).length > 1) checks.push('⚠ Duplicate name');
  if (!e.department_id) checks.push('⚠ No department');
  if (e.employment_status === 'Resigned/Separated' && !e.date_separated) checks.push('⚠ Enter Date Separated');

  return { devicesHeld, accessoriesHeld, activeBadges, newItemsSinceSigned, formStatus, exitClearance, checks };
}

/** Employee Summary "Signed?" column for one item issued on `dateIssued`. */
export function signedMark(e: Employee, dateIssued: string | null | undefined): '—' | 'Yes' | 'NEW' {
  if (!e.last_form_signed || !dateIssued) return '—';
  return dateIssued <= e.last_form_signed ? 'Yes' : 'NEW';
}

// ---------------------------------------------------------------------------
// Device Pass Badge Register
// ---------------------------------------------------------------------------

/** Badge Register "Valid Until" (EDATE(Date Issued, 3)); the database stores the same value. */
export const badgeValidUntil = (dateIssued: string) => addMonths(dateIssued, BADGE_VALID_MONTHS);

/** Badge Register "Badge Validity" */
export function badgeValidity(b: Pick<Badge, 'status' | 'valid_until'>, today: string): string {
  if (b.status !== 'Active') return `— (${b.status})`;
  if (today > b.valid_until) return '⚠ EXPIRED - Renew';
  const left = daysBetween(today, b.valid_until);
  if (left <= BADGE_WARNING_DAYS) return `⚠ Expires in ${left} day(s) - Renew`;
  return 'Valid';
}

/** Badge Register "Duplicate Serial?" */
export function badgeDuplicate(ix: Index, b: Badge): string {
  if (b.replaces_badge_code) return 'N/A (Replacement)';
  if (b.status !== 'Active') return 'OK';
  const sameDevice = ix.ds.badges.filter((x) => x.status === 'Active' &&
    ((b.asset_id && x.asset_id === b.asset_id) || (b.byod_id && x.byod_id === b.byod_id)));
  return sameDevice.length > 1 ? '⚠ 2+ active badges for this device' : 'OK';
}

/** Badge Register "Check" (same rule as badge_check() in the database). */
export function badgeCheck(ix: Index, b: Badge): string {
  if (b.status !== 'Active') return '';
  if (b.ownership === 'Company-Owned') {
    const a = b.asset_id ? ix.asset.get(b.asset_id) : undefined;
    if (a && NOT_ISSUED_STATUSES.includes(a.status)) return `⚠ Device is ${a.status} – revoke this badge`;
    if (a?.custodian_id && a.custodian_id !== b.holder_id) {
      return `⚠ Device now with ${employeeName(ix, a.custodian_id)} – revoke & issue new badge`;
    }
    return 'OK';
  }
  const d = b.byod_id ? ix.byod.get(b.byod_id) : undefined;
  if (d?.status && d.status !== 'Active') return `⚠ BYOD is ${d.status} – revoke this badge`;
  return 'OK';
}

/** Latest row for a Badge ID (replacements reuse the ID; the newest row wins). */
export function latestBadgeRow(ix: Index, code: string): Badge | undefined {
  return ix.badgesByCode.get(code.trim().toUpperCase())?.at(-1) ?? ix.badgesByCode.get(code.trim())?.at(-1);
}

/** Badge Register "Last Gate Movement" */
export function lastGateMovement(ix: Index, code: string): GateMovement | undefined {
  return ix.gateByCode.get(code)?.at(-1);
}

/** Gate Movement Log "Alert" (same rule as gate_alert() in the database). */
export function gateAlert(ix: Index, code: string, on: string): string {
  const b = latestBadgeRow(ix, code);
  if (!b) return '⚠ DO NOT ALLOW – badge not found';
  if (b.status !== 'Active') return `⚠ DO NOT ALLOW – badge ${b.status}`;
  if (on > b.valid_until) return '⚠ DO NOT ALLOW – badge expired';
  const chk = badgeCheck(ix, b);
  if (chk.startsWith('⚠')) return `⚠ Check with IT – ${chk.slice(2, 82)}`;
  return 'OK';
}

/** The device a badge belongs to, described for people. */
export function badgeDevice(ix: Index, b: Badge): { code: string; type: string; brand: string; serial: string } {
  const dev = b.asset_id ? ix.asset.get(b.asset_id) : b.byod_id ? ix.byod.get(b.byod_id) : undefined;
  if (!dev) return { code: '', type: '', brand: '', serial: '' };
  return {
    code: 'asset_code' in dev ? dev.asset_code : dev.byod_code,
    type: deviceTypeName(ix, dev.device_type_id),
    brand: dev.brand_model ?? '',
    serial: dev.serial_number ?? '',
  };
}

// ---------------------------------------------------------------------------
// Assignment History
// ---------------------------------------------------------------------------

/** Assignment History "Record Status" */
export const recordStatus = (h: Assignment) => (h.date_returned ? 'Returned' : 'Current Holder');

/** Assignment History "Days Held" */
export const daysHeld = (h: Assignment, today: string) => daysBetween(h.date_issued, h.date_returned ?? today);

/** Assignment History "Check" */
export function assignmentCheck(ix: Index, h: Assignment): string {
  if (h.date_returned) return h.date_returned < h.date_issued ? '⚠ Return date is before issue date' : 'OK';
  const openForAsset = (ix.assignmentsByAsset.get(h.asset_id) ?? []).filter((x) => !x.date_returned);
  if (openForAsset.length > 1) return "⚠ Close previous holder's record";
  const a = ix.asset.get(h.asset_id);
  if (!a) return '⚠ Asset code not found';
  if (NOT_ISSUED_STATUSES.includes(a.status)) return `⚠ Asset is ${a.status} – enter Date Returned`;
  if (h.custodian_id !== a.custodian_id) return '⚠ Update custodian on Asset Register';
  if ((h.department_id ?? null) !== (a.department_id ?? null)) return '⚠ Department differs from Asset Register';
  if (!ix.employee.has(h.custodian_id)) return '⚠ Name not in Employee List';
  return 'OK';
}

// ---------------------------------------------------------------------------
// Employee-Owned Devices
// ---------------------------------------------------------------------------

/** Employee-Owned Devices "Active Badge ID" */
export function byodActiveBadge(ix: Index, d: ByodDevice): string {
  const active = ix.ds.badges.filter((b) => b.byod_id === d.id && b.status === 'Active');
  if (active.length) return active.sort((x, y) => x.row_no - y.row_no)[active.length - 1].badge_code;
  return norm(d.serial_number) ? 'No active badge' : '';
}

/** Employee-Owned Devices "Also in Asset Register?" */
export function byodAlsoInAssets(ix: Index, d: ByodDevice): string {
  if (!norm(d.serial_number)) return '';
  return ix.ds.assets.some((a) => a.status !== 'Void' && norm(a.serial_number) === norm(d.serial_number))
    ? '⚠ Also in Asset Register' : 'OK';
}

// ---------------------------------------------------------------------------
// Accessory Log
// ---------------------------------------------------------------------------

/** Accessory Log "Status" */
export const accessoryStatus = (x: Accessory) => (x.date_returned ? 'Returned' : 'Issued');

/** Accessory Log "Check" — empty list means OK. */
export function accessoryChecks(ix: Index, x: Accessory): string[] {
  const out: string[] = [];
  const emp = ix.employee.get(x.employee_id);
  if (!emp) out.push('⚠ Employee not in list');
  if (!x.date_issued) out.push('⚠ Enter Date Issued');
  if (!(x.qty > 0)) out.push('⚠ Enter Qty');
  if (x.date_returned && x.date_returned < x.date_issued) out.push('⚠ Return date before issue date');
  if (!x.date_returned && emp?.employment_status === 'Resigned/Separated') out.push('⚠ Employee separated – collect item');
  if (x.for_asset_id && !x.date_returned) {
    const a = ix.asset.get(x.for_asset_id);
    if (a?.custodian_id && a.custodian_id !== x.employee_id) {
      out.push(`⚠ Device ${a.asset_code} is now with ${employeeName(ix, a.custodian_id)}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Type Codes "Registered Count" and dashboard figures
// ---------------------------------------------------------------------------

export function registeredCountByType(ix: Index): Map<number, number> {
  const m = new Map<number, number>();
  for (const a of ix.ds.assets) m.set(a.device_type_id, (m.get(a.device_type_id) ?? 0) + 1);
  return m;
}

export interface Summary {
  assetsInService: number;     // Active + Under Repair
  assetsTotal: number;         // excluding Void
  needsGatePass: number;
  assetsWithAlerts: number;
  activeBadges: number;
  expiringBadges: number;      // within 14 days
  expiredBadges: number;
  employeesUnsigned: number;   // Form Status starts with ⚠ or needs a first signature
  employeesNotCleared: number;
  byodActive: number;
  accessoriesOut: number;
}

export function summary(ix: Index, today: string): Summary {
  const live = ix.ds.assets.filter((a) => a.status !== 'Void');
  const alerts = live.map((a) => assetAlerts(ix, a));
  const activeBadges = ix.ds.badges.filter((b) => b.status === 'Active');
  const validity = activeBadges.map((b) => badgeValidity(b, today));
  const stats = ix.ds.employees.map((e) => employeeStats(ix, e));
  return {
    assetsInService: live.filter((a) => a.status === 'Active' || a.status === 'Under Repair').length,
    assetsTotal: live.length,
    needsGatePass: alerts.filter((l) => l.includes('⚠ Needs gate pass')).length,
    assetsWithAlerts: alerts.filter((l) => l.length > 0).length,
    activeBadges: activeBadges.length,
    expiringBadges: validity.filter((v) => v.startsWith('⚠ Expires')).length,
    expiredBadges: validity.filter((v) => v.startsWith('⚠ EXPIRED')).length,
    employeesUnsigned: stats.filter((s) => s.formStatus.startsWith('⚠') || s.formStatus === 'Enter date of last signed form').length,
    employeesNotCleared: stats.filter((s) => s.exitClearance.startsWith('⚠')).length,
    byodActive: ix.ds.byod.filter((d) => d.status === 'Active').length,
    accessoriesOut: ix.ds.accessories.filter((x) => !x.date_returned).reduce((s, x) => s + x.qty, 0),
  };
}
