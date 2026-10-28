// ============================================================================
// DEVELOPMENT ONLY — never deployed.
// A local stand-in for Supabase so the app can be tried without a cloud
// project: real Postgres (PGlite) running the real migrations and Row Level
// Security, behind the small part of the Supabase REST/Auth API this app uses.
//
//   npm run dev:backend      (then, in another terminal)   npm run dev
//
// Sign in with admin@pasti.local / editor@pasti.local / viewer@pasti.local,
// password "dev-password". Data lives in memory and resets on restart.
// ============================================================================
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createUser, freshDb } from '../tests/pg';

// Optional settings from the git-ignored .env.local (e.g. PASTI_WORKBOOK for UI import tests).
const ENV_FILE = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const PORT = Number(process.env.DEV_BACKEND_PORT ?? 54321);
const PASSWORD = 'dev-password';
const db = await freshDb();
const users = new Map<string, { id: string; email: string }>();
for (const [email, role] of [['admin@pasti.local', 'admin'], ['editor@pasti.local', 'editor'], ['viewer@pasti.local', 'viewer'], ['pending@pasti.local', null]] as const) {
  users.set(email, { id: await createUser(db, email, role), email });
}

// Requests touch one shared connection, so run them one at a time.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(u: { id: string; email: string }) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp, aud: 'authenticated' })}.dev`;
}
function userFromToken(req: IncomingMessage) {
  const t = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const parts = t.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return [...users.values()].find((u) => u.id === claims.sub) ?? null;
  } catch { return null; }
}
const authUser = (u: { id: string; email: string }) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {},
  created_at: new Date().toISOString(),
});
const session = (u: { id: string; email: string }) => ({
  access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `refresh.${u.id}`, user: authUser(u),
});

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s: string) => { if (!IDENT.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { status: 400 }); return `"${s}"`; };

async function asUser<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; set role ${userId ? 'authenticated' : 'anon'};`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`,
    [userId ?? '', JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : {})]);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}

function filters(params: URLSearchParams, args: unknown[]): string {
  const where: string[] = [];
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    const m = /^(eq|neq|gt|gte|lt|lte|is|in)\.(.*)$/s.exec(raw);
    if (!m) continue;
    const col = ident(k);
    if (m[1] === 'is') { where.push(`${col} is ${m[2] === 'null' ? 'null' : m[2] === 'true' ? 'true' : 'false'}`); continue; }
    if (m[1] === 'in') {
      const vals = m[2].replace(/^\(|\)$/g, '').split(',');
      where.push(`${col}::text = any($${args.push(vals)}::text[])`); continue;
    }
    // Untyped parameter: Postgres infers the column's type (uuid, date, timestamptz ...).
    const op = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[m[1]]!;
    where.push(`${col} ${op} $${args.push(m[2])}`);
  }
  return where.length ? ` where ${where.join(' and ')}` : '';
}

function orderBy(params: URLSearchParams): string {
  const o = params.get('order');
  if (!o) return '';
  return ' order by ' + o.split(',').map((part) => {
    const [col, dir] = part.split('.');
    return `${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}`;
  }).join(', ');
}

function selectCols(params: URLSearchParams): string {
  const s = (params.get('select') ?? '*').replace(/\s/g, '');
  return s === '*' ? '*' : s.split(',').map(ident).join(', ');
}

async function rest(req: IncomingMessage, url: URL, body: unknown, userId: string | null): Promise<{ status: number; data: unknown }> {
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  const params = url.searchParams;
  if (path.startsWith('rpc/')) {
    const fn = ident(path.slice(4));
    const entries = Object.entries((body ?? {}) as Record<string, unknown>);
    const args: unknown[] = [];
    const named = entries.map(([k, v]) => `${ident(k)} => $${args.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v)}`).join(', ');
    const rows = await asUser(userId, () => db.query<{ r: unknown }>(`select to_jsonb(${fn}(${named})) as r`, args));
    return { status: 200, data: rows.rows[0]?.r ?? null };
  }
  const table = ident(path);
  const args: unknown[] = [];
  const wantObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
  const returnRep = String(req.headers.prefer ?? '').includes('return=representation');
  let sql: string;
  if (req.method === 'GET') {
    const limit = params.get('limit') ? ` limit ${Number(params.get('limit'))}` : '';
    const offset = params.get('offset') ? ` offset ${Number(params.get('offset'))}` : '';
    sql = `select coalesce(json_agg(t), '[]') as j from (select ${selectCols(params)} from ${table}${filters(params, args)}${orderBy(params)}${limit}${offset}) t`;
  } else if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r as object)))].map(ident).join(', ');
    args.push(JSON.stringify(rows));
    sql = `with x as (insert into ${table} (${cols}) select ${cols} from json_populate_recordset(null::${table}, $1::json) returning *) select coalesce(json_agg(x), '[]') as j from x`;
  } else if (req.method === 'PATCH') {
    const cols = Object.keys(body as object).map(ident);
    args.push(JSON.stringify(body));
    sql = `with x as (update ${table} set (${cols.join(', ')}) = (select ${cols.join(', ')} from json_populate_record(null::${table}, $1::json))${filters(params, args)} returning *) select coalesce(json_agg(x), '[]') as j from x`;
    if (cols.length === 1) sql = sql.replace(`set (${cols[0]}) = (select ${cols[0]} from`, `set ${cols[0]} = (select ${cols[0]} from`);
  } else if (req.method === 'DELETE') {
    sql = `with x as (delete from ${table}${filters(params, args)} returning *) select coalesce(json_agg(x), '[]') as j from x`;
  } else {
    return { status: 405, data: { message: 'method not allowed' } };
  }
  const res = await asUser(userId, () => db.query<{ j: Record<string, unknown>[] }>(sql, args));
  let rows = res.rows[0].j;
  const pick = selectCols(params);
  if (pick !== '*') rows = rows.map((r) => Object.fromEntries(pick.split(', ').map((c) => c.replace(/"/g, '')).map((c) => [c, r[c]])));
  if (req.method !== 'GET' && !returnRep && !wantObject) return { status: req.method === 'POST' ? 201 : 204, data: null };
  if (wantObject) {
    if (rows.length !== 1) return { status: 406, data: { code: 'PGRST116', message: `JSON object requested, multiple (or no) rows returned`, details: `${rows.length} rows` } };
    return { status: 200, data: rows[0] };
  }
  return { status: req.method === 'POST' ? 201 : 200, data: rows };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : null;
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'content-range',
  });
  res.end(data === null || status === 204 ? '' : JSON.stringify(data));
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'authorization,apikey,content-type,prefer,accept,accept-profile,content-profile,x-client-info,range,x-supabase-api-version',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  try {
    const body = req.method === 'GET' || req.method === 'DELETE' ? null : await readBody(req);
    if (url.pathname === '/dev/workbook') {
      const p = process.env.PASTI_WORKBOOK;
      if (!p || !existsSync(p)) return send(res, 404, { message: 'Set PASTI_WORKBOOK to serve a workbook for UI tests' });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
      return res.end(readFileSync(p));
    }
    if (url.pathname === '/auth/v1/token') {
      const { email, password, refresh_token } = (body ?? {}) as { email?: string; password?: string; refresh_token?: string };
      const u = refresh_token ? [...users.values()].find((x) => `refresh.${x.id}` === refresh_token)
        : users.get(String(email).toLowerCase());
      if (!u || (!refresh_token && password !== PASSWORD)) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(u));
    }
    if (url.pathname === '/auth/v1/user') {
      const u = userFromToken(req);
      return u ? send(res, 200, authUser(u)) : send(res, 401, { msg: 'invalid JWT', code: 'bad_jwt' });
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204, null);
    if (url.pathname === '/auth/v1/recover') return send(res, 200, {});
    if (url.pathname.startsWith('/rest/v1/')) {
      const u = userFromToken(req);
      const out = await serial(() => rest(req, url, body, u?.id ?? null));
      return send(res, out.status, out.data);
    }
    send(res, 404, { message: 'not found' });
  } catch (e) {
    const err = e as { message: string; code?: string; status?: number; detail?: string };
    const code = err.code ?? 'P0001';
    const status = err.status ?? (code === '42501' ? 403 : code === '23505' || code === '23503' || code === '23514' ? 409 : 400);
    send(res, status, { code, message: err.message, details: err.detail ?? null, hint: null });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`PASTI dev backend on http://localhost:${PORT}  (password for all users: ${PASSWORD})`);
  console.log([...users.keys()].join('  '));
});
