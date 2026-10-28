// Workflows and security, run against the real migrations in Postgres.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createUser, freshDb, loadDataset, Session } from './pg';
import { badgeCheck, buildIndex, gateAlert } from '../src/lib/rules';
import { addMonths } from '../src/lib/dates';

let db: PGlite;
let admin: Session, editor: Session, viewer: Session, pending: Session, anon: Session;
let ana: string, ben: string, cara: string;   // employees
let lap: number, mon: number;                 // device type ids

async function newAsset(s: Session, type: number, date: string, serial: string, brand = 'HP EliteBook') {
  const rows = await s.query<{ id: string; asset_code: string }>(
    `insert into assets (date_encoded, device_type_id, brand_model, serial_number, asset_code, type_code, code_year, sequence_no)
     values ($1, $2, $3, $4, '', '', 0, 0) returning id, asset_code`, [date, type, brand, serial]);
  return rows[0];
}

beforeAll(async () => {
  db = await freshDb();
  admin = new Session(db, await createUser(db, 'admin@test.local', 'admin'));
  editor = new Session(db, await createUser(db, 'editor@test.local', 'editor'));
  viewer = new Session(db, await createUser(db, 'viewer@test.local', 'viewer'));
  pending = new Session(db, await createUser(db, 'new@test.local', null));
  anon = new Session(db, null);
  const dept = (await db.query<{ id: number }>(`select id from departments order by id limit 1`)).rows[0].id;
  const emp = async (name: string) => (await editor.query<{ id: string }>(
    `insert into employees (full_name, department_id) values ($1, $2) returning id`, [name, dept]))[0].id;
  ana = await emp('Ana Santos'); ben = await emp('Ben Cruz'); cara = await emp('Cara Reyes');
  lap = (await db.query<{ id: number }>(`select id from device_types where code = 'LAP'`)).rows[0].id;
  mon = (await db.query<{ id: number }>(`select id from device_types where code = 'MON'`)).rows[0].id;
}, 120_000);

describe('codes', () => {
  it('generates PASTI-[TYPE]-[YY]-[####], per type and per year, ignoring anything the client sends', async () => {
    expect((await newAsset(editor, lap, '2026-03-01', 'SN-A1')).asset_code).toBe('PASTI-LAP-26-0001');
    expect((await newAsset(editor, lap, '2026-03-02', 'SN-A2')).asset_code).toBe('PASTI-LAP-26-0002');
    expect((await newAsset(editor, mon, '2026-03-02', 'SN-M1')).asset_code).toBe('PASTI-MON-26-0001');
    expect((await newAsset(editor, lap, '2027-01-05', 'SN-A3')).asset_code).toBe('PASTI-LAP-27-0001');
  });

  it('never changes a code afterwards', async () => {
    const a = await newAsset(editor, lap, '2026-04-01', 'SN-CODE');
    await expect(editor.query(`update assets set device_type_id = $1 where id = $2`, [mon, a.id])).rejects.toThrow(/Void this record/);
    await expect(editor.query(`update assets set date_encoded = '2027-01-01' where id = $1`, [a.id])).rejects.toThrow(/must stay in 2026/);
    await expect(editor.query(`update assets set asset_code = 'X' where id = $1`, [a.id])).rejects.toThrow(/cannot be changed/);
    await editor.query(`update assets set date_encoded = '2026-04-02', brand_model = 'Dell' where id = $1`, [a.id]);
  });

  it('pads to 4 digits without ever truncating', async () => {
    const r = await db.query<{ a: string; b: string }>(`select pad4(7) a, pad4(12345) b`);
    expect(r.rows[0]).toEqual({ a: '0007', b: '12345' });
  });
});

describe('duplicates', () => {
  it('rejects a serial already on the register (case/space-insensitive), but not a voided one', async () => {
    await newAsset(editor, mon, '2026-05-01', 'DUP-1');
    await expect(newAsset(editor, mon, '2026-05-01', ' dup-1 ')).rejects.toThrow(/duplicate key/);
  });

  it('a unit is company-owned or employee-owned, never both', async () => {
    const a = await newAsset(editor, lap, '2026-05-01', 'BOTH-1');
    const byod = `insert into byod_devices (date_registered, device_type_id, serial_number, owner_id, status, byod_code, type_code, code_year, sequence_no)
                  values ('2026-05-02', $1, 'BOTH-1', $2, 'Active', '', '', 0, 0) returning byod_code`;
    await expect(editor.query(byod, [lap, ana])).rejects.toThrow(/already registered as a company asset/);
    await editor.rpc('return_asset', [a.id, '2026-05-02', 'Void', null, 'personal laptop']);
    const [d] = await editor.query<{ byod_code: string }>(byod, [lap, ana]);
    expect(d.byod_code).toBe('PASTI-BYOD-LAP-26-0001');
  });
});

describe('issue, hand-over and return (Read Me "TURNOVER")', () => {
  let asset: { id: string; asset_code: string };
  let badge1: string;

  it('blocks direct custodian/status edits — use the actions', async () => {
    asset = await newAsset(editor, lap, '2026-06-01', 'FLOW-1');
    await expect(editor.query(`update assets set custodian_id = $1 where id = $2`, [ana, asset.id])).rejects.toThrow(/Issue, Return/);
    await expect(editor.query(`update assets set status = 'Lost/Stolen' where id = $1`, [asset.id])).rejects.toThrow(/Issue, Return/);
  });

  it('issues to an employee and records Assignment History', async () => {
    await editor.rpc('issue_asset', [asset.id, ana, null, '2026-06-02', null, null]);
    const h = await db.query<{ custodian_id: string; date_returned: string | null }>(`select * from assignments where asset_id = $1`, [asset.id]);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].custodian_id).toBe(ana);
    await expect(editor.rpc('issue_asset', [asset.id, ana, null, '2026-06-03', null, null])).rejects.toThrow(/already holds/);
  });

  it('issues a gate pass for the holder and writes it on the history row', async () => {
    const b = await editor.rpc<{ badge_code: string; valid_until: string; holder_id: string }>('issue_badge', ['Company-Owned', asset.id, '2026-06-03', null]);
    expect(b.badge_code).toBe('PASTI-EDP-LAP-26-0001');
    expect(b.valid_until).toBe(addMonths('2026-06-03', 3));
    expect(b.holder_id).toBe(ana);
    badge1 = b.badge_code;
    const h = await db.query<{ badge_code: string }>(`select badge_code from assignments where asset_id = $1 and date_returned is null`, [asset.id]);
    expect(h.rows[0].badge_code).toBe(badge1);
    await expect(editor.rpc('issue_badge', ['Company-Owned', asset.id, '2026-06-04', null])).rejects.toThrow(/already has an active badge/);
  });

  it('gate check: OK, then the database and the app agree on every verdict', async () => {
    const g = await editor.rpc<{ alert: string }>('log_gate_movement', [badge1, 'OUT', '2026-06-10', '17:30', 'Guard Lim', null]);
    expect(g.alert).toBe('OK');
    const ix = buildIndex(await loadDataset(db));
    expect(gateAlert(ix, badge1, '2026-06-10')).toBe('OK');
    expect(gateAlert(ix, badge1, '2026-09-04')).toBe('⚠ DO NOT ALLOW – badge expired');
    const sqlExpired = await db.query<{ a: string }>(`select gate_alert($1, '2026-09-04') a`, [badge1]);
    expect(sqlExpired.rows[0].a).toBe('⚠ DO NOT ALLOW – badge expired');
    const unknown = await editor.rpc<{ alert: string }>('log_gate_movement', ['PASTI-EDP-LAP-26-9999', 'IN', '2026-06-10', '08:00', 'Guard Lim', null]);
    expect(unknown.alert).toBe('⚠ DO NOT ALLOW – badge not found');
  });

  it('hand-over closes the old record, opens a new one and revokes the old badge', async () => {
    const r = await editor.rpc<{ badges_revoked: number }>('issue_asset', [asset.id, ben, null, '2026-07-01', 'Good', 'transfer']);
    expect(r.badges_revoked).toBe(1);
    const h = await db.query<{ custodian_id: string; date_returned: string | null; return_condition: string | null }>(
      `select custodian_id, date_returned::text, return_condition from assignments where asset_id = $1 order by date_issued`, [asset.id]);
    expect(h.rows.map((x) => [x.custodian_id, x.date_returned, x.return_condition]))
      .toEqual([[ana, '2026-07-01', 'Good'], [ben, null, null]]);
    const g = await editor.rpc<{ alert: string }>('log_gate_movement', [badge1, 'OUT', '2026-07-02', '18:00', 'Guard Lim', null]);
    expect(g.alert).toBe('⚠ DO NOT ALLOW – badge Revoked');
  });

  it('a revoked badge can never be reactivated', async () => {
    await expect(editor.query(`update badges set status = 'Active' where badge_code = $1`, [badge1])).rejects.toThrow(/cannot be reactivated/);
  });

  it('renewal keeps the Badge ID, supersedes the old row and does not use up a number', async () => {
    const b2 = await editor.rpc<{ id: string; badge_code: string }>('issue_badge', ['Company-Owned', asset.id, '2026-07-02', null]);
    expect(b2.badge_code).toBe('PASTI-EDP-LAP-26-0002');
    const renewed = await editor.rpc<{ badge_code: string; sequence_no: number | null; replaces_badge_code: string }>(
      'renew_badge', [b2.id, '2026-10-01', null, 'Superseded', 'expired']);
    expect(renewed).toMatchObject({ badge_code: b2.badge_code, sequence_no: null, replaces_badge_code: b2.badge_code });
    const old = await db.query<{ status: string }>(`select status from badges where id = $1`, [b2.id]);
    expect(old.rows[0].status).toBe('Superseded');
    const other = await newAsset(editor, lap, '2026-07-05', 'FLOW-2');
    await editor.rpc('issue_asset', [other.id, cara, null, '2026-07-05', null, null]);
    const b3 = await editor.rpc<{ badge_code: string }>('issue_badge', ['Company-Owned', other.id, '2026-07-05', null]);
    expect(b3.badge_code).toBe('PASTI-EDP-LAP-26-0003');
  });

  it('renewal for a different holder is refused', async () => {
    const [latest] = await db.query<{ id: string }>(`select id from badges where asset_id = $1 and status = 'Active'`, [asset.id]).then((r) => r.rows);
    await editor.rpc('issue_asset', [asset.id, cara, null, '2026-10-05', null, null]);   // auto-revokes
    await expect(editor.rpc('renew_badge', [latest.id, '2026-10-06', null, 'Superseded', null])).rejects.toThrow(/was revoked/);
  });

  it('return to IT closes the record, clears the holder and revokes the badge', async () => {
    const b = await editor.rpc<{ badge_code: string }>('issue_badge', ['Company-Owned', asset.id, '2026-10-06', null]);
    const r = await editor.rpc<{ assignment_closed: boolean; badges_revoked: number }>(
      'return_asset', [asset.id, '2026-10-20', 'Returned to IT', 'Minor Wear', 'resigned']);
    expect(r).toEqual({ assignment_closed: true, badges_revoked: 1 });
    const a = await db.query<{ status: string; custodian_id: string | null }>(`select status, custodian_id from assets where id = $1`, [asset.id]);
    expect(a.rows[0]).toEqual({ status: 'Returned to IT', custodian_id: null });
    const open = await db.query(`select 1 from assignments where asset_id = $1 and date_returned is null`, [asset.id]);
    expect(open.rows).toHaveLength(0);
    const ix = buildIndex(await loadDataset(db));
    const row = ix.ds.badges.find((x) => x.badge_code === b.badge_code && x.status !== 'Active');
    expect(row?.status).toBe('Revoked');
  });

  it('refuses a return dated before the issue', async () => {
    const a = await newAsset(editor, lap, '2026-08-01', 'FLOW-3');
    await editor.rpc('issue_asset', [a.id, ana, null, '2026-08-10', null, null]);
    await expect(editor.rpc('return_asset', [a.id, '2026-08-09', 'Returned to IT', null, null])).rejects.toThrow(/before/);
  });

  it('cannot issue to a separated employee', async () => {
    const a = await newAsset(editor, mon, '2026-08-01', 'FLOW-4');
    await editor.query(`update employees set employment_status = 'Resigned/Separated', date_separated = '2026-08-01' where id = $1`, [cara]);
    await expect(editor.rpc('issue_asset', [a.id, cara, null, '2026-08-02', null, null])).rejects.toThrow(/Resigned\/Separated/);
    await editor.query(`update employees set employment_status = 'Active', date_separated = null where id = $1`, [cara]);
  });

  it('badge_check in the database matches the app for every badge', async () => {
    const ix = buildIndex(await loadDataset(db));
    for (const b of ix.ds.badges) {
      const r = await db.query<{ c: string }>(`select badge_check(b) c from badges b where id = $1`, [b.id]);
      expect(r.rows[0].c, b.badge_code).toBe(badgeCheck(ix, b));
    }
  });
});

describe('security', () => {
  it('viewers can read but not write', async () => {
    expect((await viewer.query(`select id from assets`)).length).toBeGreaterThan(0);
    await expect(newAsset(viewer, lap, '2026-01-01', 'V-1')).rejects.toThrow(/row-level security/);
    await expect(viewer.rpc('issue_asset', [ana, ana, null, '2026-01-01', null, null])).rejects.toThrow(/permission/);
    await expect(viewer.rpc('log_gate_movement', ['X', 'IN', '2026-01-01', '08:00', 'G', null])).rejects.toThrow(/permission/);
  });

  it('accounts without an approved role see nothing; anonymous callers are refused', async () => {
    expect(await pending.query(`select id from assets`)).toHaveLength(0);
    expect(await pending.query(`select id from employees`)).toHaveLength(0);
    await expect(anon.query(`select id from assets`)).rejects.toThrow(/permission denied/);
    await expect(anon.query(`select * from activity_log`)).rejects.toThrow(/permission denied/);
  });

  it('assets, badges, history and the gate log can never be deleted, even by an admin', async () => {
    for (const t of ['assets', 'badges', 'assignments', 'gate_movements']) {
      await expect(admin.query(`delete from ${t}`)).rejects.toThrow(/permission denied/);
    }
  });

  it('badges, history rows and gate entries cannot be written directly', async () => {
    await expect(editor.query(`insert into gate_movements (moved_on, moved_time, badge_code, direction, guard_name, alert)
      values ('2026-01-01', '08:00', 'X', 'IN', 'G', 'OK')`)).rejects.toThrow(/permission denied/);
    await expect(editor.query(`update badges set holder_id = $1`, [ana])).rejects.toThrow(/permission denied/);
    await expect(editor.query(`update assignments set date_returned = '2026-12-31'`)).rejects.toThrow(/permission denied/);
  });

  it('only admins change lists and roles; nobody changes their own role', async () => {
    await expect(editor.query(`insert into departments (name) values ('IT')`)).rejects.toThrow(/row-level security/);
    await admin.query(`insert into departments (name) values ('IT')`);
    const editorRows = await editor.query(`update profiles set role = 'admin' returning user_id`);
    expect(editorRows).toHaveLength(0);
    const own = await admin.query(`update profiles set role = 'viewer' where email = 'admin@test.local' returning user_id`);
    expect(own).toHaveLength(0);
    const promoted = await admin.query(`update profiles set role = 'viewer' where email = 'new@test.local' returning user_id`);
    expect(promoted).toHaveLength(1);
  });

  it('every change is logged with who made it; deleted employees are kept in the recycle bin', async () => {
    const [e] = await editor.query<{ id: string }>(`insert into employees (full_name) values ('Temp Person') returning id`);
    await expect(editor.query(`delete from employees where id = $1 returning id`, [e.id])).resolves.toHaveLength(0);
    await admin.query(`delete from employees where id = $1`, [e.id]);
    const bin = await db.query<{ row_data: { full_name: string }; deleted_by: string }>(`select * from deleted_records where record_id = $1`, [e.id]);
    expect(bin.rows[0]).toMatchObject({ row_data: { full_name: 'Temp Person' }, deleted_by: 'admin@test.local' });
    const log = await db.query<{ action: string; user_email: string }>(
      `select action, user_email from activity_log where record_id = $1 order by id`, [e.id]);
    expect(log.rows).toEqual([{ action: 'CREATE', user_email: 'editor@test.local' }, { action: 'DELETE', user_email: 'admin@test.local' }]);
    await expect(editor.query(`delete from activity_log`)).rejects.toThrow(/permission denied/);
  });

  it('import is admin-only', async () => {
    await expect(editor.rpc('import_workbook', ['{}'])).rejects.toThrow(/administrator/);
  });
});
