// Full pipeline against the real workbook:
//   Excel file -> planImport() -> import_workbook() in Postgres -> rows back
//   -> rules.ts -> compared with the values Excel calculated and saved.
// The workbook holds staff names, so it is never committed; point
// PASTI_WORKBOOK at it to run this file:
//   PASTI_WORKBOOK="C:\path\PASTI_Asset_Code_Registerv2.xlsx" npm test
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';
import type { PGlite } from '@electric-sql/pglite';
import { createUser, freshDb, loadDataset, Session } from './pg';
import { planImport, readWorkbook, type ImportPlan } from '../src/lib/workbook';
import {
  assetActiveBadge, assetAlertsText, assetAlsoInByod, assetInHistory, assignmentCheck, badgeCheck, badgeDuplicate,
  badgeValidity, buildIndex, byodActiveBadge, byodAlsoInAssets, daysHeld, employeeStats, recordStatus,
  registeredCountByType, type Index,
} from '../src/lib/rules';
import { excelSerialToISO } from '../src/lib/dates';

const WORKBOOK = process.env.PASTI_WORKBOOK;

/** Cached (Excel-calculated) values of one sheet, as objects keyed by header. */
function excelRows(wb: XLSX.WorkBook, sheet: string): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet], { defval: '', raw: true });
}
const s = (v: unknown) => (v == null ? '' : String(v));

describe.skipIf(!WORKBOOK)('real workbook reconciliation', () => {
  let wb: XLSX.WorkBook;
  let plan: ImportPlan;
  let ix: Index;
  let today: string;
  let result: Record<string, number>;
  let db: PGlite;

  beforeAll(async () => {
    const buf = readFileSync(WORKBOOK!);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    wb = XLSX.read(ab, { type: 'array' });
    plan = planImport(readWorkbook(ab, basename(WORKBOOK!)));
    // "today" as Excel last calculated it (Employee Summary!G5 = TODAY()).
    today = excelSerialToISO(wb.Sheets['Employee Summary'].G5.v as number);

    db = await freshDb();
    const admin = new Session(db, await createUser(db, 'admin@test.local', 'admin'));
    result = await admin.rpc('import_workbook', [JSON.stringify(plan.payload)]);
    ix = buildIndex(await loadDataset(db));
  }, 120_000);

  it('validates every sheet and reports what it found', () => {
    for (const r of plan.reports) {
      console.log(`${r.label.padEnd(28)} rows=${r.total} valid=${r.valid} invalid=${r.invalid.length} warnings=${r.warnings.length}`);
      for (const i of r.invalid) console.log(`   ✗ row ${i.row}: ${i.message}`);
      for (const w of r.warnings) console.log(`   ! row ${w.row}: ${w.message}`);
      expect(r.missingColumns).toEqual([]);
    }
    expect(plan.canImport).toBe(true);
  });

  it('imports exactly the valid rows', () => {
    const valid = (k: string) => plan.reports.find((r) => r.key === k)!.valid;
    expect(result).toMatchObject({
      employees: valid('employees'), assets: valid('assets'), byod: valid('byod'),
      assignments: valid('assignments'), badges: valid('badges'), accessories: valid('accessories'),
      gate_movements: valid('gate'),
    });
  });

  it('keeps every Asset Code, BYOD code and Badge ID exactly as issued', () => {
    const codes = excelRows(wb, 'Asset Register').map((r) => s(r['Asset Code'])).filter(Boolean);
    expect(ix.ds.assets.map((a) => a.asset_code).sort()).toEqual([...codes].sort());
    const badgeIds = excelRows(wb, 'Device Pass Badge Register').map((r) => s(r['Badge ID'])).filter(Boolean);
    expect(ix.ds.badges.map((b) => b.badge_code)).toEqual(badgeIds);
  });

  it('Asset Register: Alerts, Active Badge ID, Also in BYOD, In Assignment History', () => {
    const byCode = new Map(ix.ds.assets.map((a) => [a.asset_code, a]));
    let n = 0;
    for (const row of excelRows(wb, 'Asset Register')) {
      const a = byCode.get(s(row['Asset Code']));
      if (!a) continue;
      n++;
      expect.soft(assetAlertsText(ix, a), `${a.asset_code} Alerts`).toBe(s(row['Alerts']));
      expect.soft(assetActiveBadge(ix, a), `${a.asset_code} Active Badge ID`).toBe(s(row['Active Badge ID']));
      expect.soft(assetAlsoInByod(ix, a), `${a.asset_code} Also in BYOD`).toBe(s(row['Also in BYOD Sheet?']));
      expect.soft(assetInHistory(ix, a), `${a.asset_code} In Assignment History`).toBe(s(row['In Assignment History?']));
    }
    expect(n).toBe(ix.ds.assets.length);
  });

  it('Type Codes: Registered Count', () => {
    const counts = registeredCountByType(ix);
    for (const row of excelRows(wb, 'Type Codes')) {
      const t = ix.ds.deviceTypes.find((d) => d.code === s(row['Type Code']));
      expect.soft(counts.get(t!.id) ?? 0, `${t!.name}`).toBe(Number(row['Registered Count']));
    }
  });

  it('Employees: Devices/Accessories/Badges held, Form Status, Exit Clearance, Check', () => {
    const byName = new Map(ix.ds.employees.map((e) => [e.full_name, e]));
    for (const row of excelRows(wb, 'Employees')) {
      const e = byName.get(s(row['Employee Name']));
      if (!e) continue;
      const st = employeeStats(ix, e);
      expect.soft(st.devicesHeld, `${e.full_name} Devices Held`).toBe(Number(row['Devices Held']));
      expect.soft(st.accessoriesHeld, `${e.full_name} Accessories Held`).toBe(Number(row['Accessories Held']));
      expect.soft(st.activeBadges, `${e.full_name} Active Badges`).toBe(Number(row['Active Badges']));
      expect.soft(st.formStatus, `${e.full_name} Form Status`).toBe(s(row['Form Status']));
      expect.soft(st.exitClearance, `${e.full_name} Exit Clearance`).toBe(s(row['Exit Clearance']));
      expect.soft(st.checks.length ? st.checks.map((c) => c + ' ').join('') : 'OK', `${e.full_name} Check`).toBe(s(row['Check']));
    }
  });

  it('Assignment History: Days Held, Record Status, Check', () => {
    const name = (id: string) => ix.employee.get(id)!.full_name;
    const code = (id: string) => ix.asset.get(id)!.asset_code;
    const used = new Set<string>();
    for (const row of excelRows(wb, 'Assignment History')) {
      if (!s(row['Asset Code'])) continue;
      const issued = excelSerialToISO(Number(row['Date Issued']));
      const h = ix.ds.assignments.find((x) => !used.has(x.id) && code(x.asset_id) === s(row['Asset Code'])
        && name(x.custodian_id) === s(row['Custodian / Keeper']) && x.date_issued === issued);
      expect(h, `assignment for ${s(row['Asset Code'])}`).toBeDefined();
      used.add(h!.id);
      const label = `${s(row['Asset Code'])} / ${s(row['Custodian / Keeper'])}`;
      expect.soft(daysHeld(h!, today), `${label} Days Held`).toBe(Number(row['Days Held']));
      expect.soft(recordStatus(h!), `${label} Record Status`).toBe(s(row['Record Status']));
      expect.soft(assignmentCheck(ix, h!), `${label} Check`).toBe(s(row['Check']));
    }
  });

  it('Device Pass Badge Register: Duplicate check, Badge Validity, Check', () => {
    const rows = excelRows(wb, 'Device Pass Badge Register').filter((r) => s(r['Badge ID']));
    rows.forEach((row, i) => {
      const b = ix.ds.badges[i];
      expect(b.badge_code).toBe(s(row['Badge ID']));
      expect.soft(b.valid_until, `${b.badge_code} Valid Until`).toBe(excelSerialToISO(Number(row['Valid Until'])));
      expect.soft(badgeDuplicate(ix, b), `${b.badge_code} Duplicate`).toBe(s(row['Duplicate Serial?']));
      expect.soft(badgeValidity(b, today), `${b.badge_code} Validity`).toBe(s(row['Badge Validity']));
      expect.soft(badgeCheck(ix, b), `${b.badge_code} Check`).toBe(s(row['Check']));
    });
  });

  it('Employee-Owned Devices: Active Badge ID, Also in Asset Register', () => {
    const byCode = new Map(ix.ds.byod.map((d) => [d.byod_code, d]));
    for (const row of excelRows(wb, 'Employee-Owned Devices')) {
      const d = byCode.get(s(row['Asset Code']));
      if (!d) continue;
      expect.soft(byodActiveBadge(ix, d), `${d.byod_code} Active Badge`).toBe(s(row['Active Badge ID']));
      expect.soft(byodAlsoInAssets(ix, d), `${d.byod_code} Also in Asset Register`).toBe(s(row['Also in Asset Register?']));
    }
  });

  it('continues numbering after the highest imported code', async () => {
    const { rows } = await db.query<{ prefix: string; type_code: string; code_year: number; last_seq: number }>(
      `select * from code_counters where prefix = 'ASSET' and type_code = 'LAP'`);
    const maxLap = Math.max(...ix.ds.assets.filter((a) => a.type_code === 'LAP').map((a) => a.sequence_no));
    expect(rows[0].last_seq).toBe(maxLap);
  });

  it('refuses a second full import', async () => {
    const admin = new Session(db, (await db.query<{ user_id: string }>(`select user_id from profiles where role = 'admin'`)).rows[0].user_id);
    await expect(admin.rpc('import_workbook', [JSON.stringify(plan.payload)])).rejects.toThrow(/already contains records/);
  });
});
