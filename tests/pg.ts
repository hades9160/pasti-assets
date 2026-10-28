// Test harness: a real Postgres (PGlite) with just enough of Supabase's
// auth schema and roles to run the migrations and Row Level Security.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Dataset } from '../src/lib/types';

const MIGRATIONS = ['0001_core.sql', '0002_workflows.sql', '0003_security.sql', '0004_default_lists.sql'];

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role supabase_auth_admin nologin;
  grant usage on schema public to anon, authenticated;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                           current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
`;

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of MIGRATIONS) {
    const sql = readFileSync(fileURLToPath(new URL(`../supabase/migrations/${f}`, import.meta.url)), 'utf8');
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  }
  return db;
}

export async function createUser(db: PGlite, email: string, role: 'admin' | 'editor' | 'viewer' | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
  const id = rows[0].id;
  await db.query('update profiles set role = $1 where user_id = $2', [role, id]);
  return id;
}

/** Run queries the way PostgREST does: as role "authenticated" (or anon) with the user's id. */
export class Session {
  constructor(private db: PGlite, private userId: string | null) {}

  private async enter() {
    await this.db.exec(`reset role; set role ${this.userId ? 'authenticated' : 'anon'};`);
    await this.db.query(`select set_config('request.jwt.claim.sub', $1, false),
                                set_config('request.jwt.claims', $2, false)`,
      [this.userId ?? '', JSON.stringify(this.userId ? { sub: this.userId } : {})]);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.enter();
    try {
      return (await this.db.query<T>(sql, params)).rows;
    } finally {
      await this.db.exec('reset role;');
    }
  }

  async rpc<T = unknown>(fn: string, args: unknown[]): Promise<T> {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.query<{ r: T }>(`select to_jsonb(${fn}(${placeholders})) as r`, args);
    return rows[0].r;
  }
}

/** All rows of a table as PostgREST would return them (dates as strings). */
export async function tableJson<T>(db: PGlite, table: string, order = 'created_at'): Promise<T[]> {
  const { rows } = await db.query<{ j: T[] }>(`select coalesce(json_agg(t order by ${order}), '[]'::json) as j from ${table} t`);
  return rows[0].j;
}

/** The whole register, shaped like the app loads it. */
export async function loadDataset(db: PGlite): Promise<Dataset> {
  return {
    employees: await tableJson(db, 'employees'),
    departments: await tableJson(db, 'departments', 'id'),
    deviceTypes: await tableJson(db, 'device_types', 'id'),
    listItems: await tableJson(db, 'list_items', 'id'),
    assets: await tableJson(db, 'assets', 'asset_code'),
    byod: await tableJson(db, 'byod_devices', 'byod_code'),
    assignments: await tableJson(db, 'assignments'),
    badges: await tableJson(db, 'badges', 'row_no'),
    accessories: await tableJson(db, 'accessories'),
    gateMovements: await tableJson(db, 'gate_movements'),
  };
}
