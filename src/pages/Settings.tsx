import { useEffect, useState } from 'react';
import { Check, MailPlus, PencilLine, Plus, X } from 'lucide-react';
import { useData } from '../lib/data';
import { useAuth } from '../lib/auth';
import { friendlyError, supabase } from '../lib/supabase';
import { formatDateTime } from '../lib/dates';
import type { ListName, Profile, Role } from '../lib/types';
import { FormModal } from '../components/Modal';
import { required } from '../components/pickers';
import { Button, Card, cx, Field, Input, Notice, PageHeader, Pill, Select } from '../components/ui';
import { useToast } from '../components/toast';

type Tab = 'departments' | 'device_types' | ListName | 'users';
const TABS: [Tab, string][] = [
  ['users', 'Users & roles'], ['departments', 'Departments'], ['device_types', 'Device types'],
  ['accessory_type', 'Accessory types'], ['issue_reason', 'Reasons issued'], ['return_condition', 'Return conditions'],
];

export function Settings() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <>
      <PageHeader title="Settings & Users" description="Who can use the system, and the lists behind every dropdown. Only administrators see this page." />
      <div role="tablist" aria-label="Settings sections" className="flex flex-wrap gap-1 mb-4 border-b border-line">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx('px-3.5 py-2 text-[13.5px] font-medium border-b-2 -mb-px transition-colors',
              tab === k ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink')}>{label}</button>
        ))}
      </div>
      {tab === 'users' ? <Users /> : tab === 'device_types' ? <DeviceTypes /> : <SimpleList kind={tab} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Departments and the three simple lists
// ---------------------------------------------------------------------------
function SimpleList({ kind }: { kind: 'departments' | ListName }) {
  const { ds, reload } = useData();
  const toast = useToast();
  const items = kind === 'departments' ? ds.departments : ds.listItems.filter((i) => i.list === kind);
  const table = kind === 'departments' ? 'departments' : 'list_items';
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!name.trim()) { setError('Type a name first.'); return; }
    const row = { name: name.trim(), sort_order: items.length + 1, ...(kind === 'departments' ? {} : { list: kind }) };
    const { error: err } = await supabase.from(table).insert(row);
    if (err) { setError(friendlyError(err)); return; }
    setName(''); toast('ok', `Added "${row.name}".`); await reload();
  }
  async function save(id: number, patch: Record<string, unknown>) {
    setError(null);
    const { error: err } = await supabase.from(table).update(patch).eq('id', id);
    if (err) { setError(friendlyError(err)); return false; }
    await reload(); return true;
  }

  return (
    <Card title={TABS.find(([k]) => k === kind)![1]} description="Inactive entries disappear from dropdowns but stay on existing records. Entries are never deleted.">
      {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
      <ul className="divide-y divide-line/70 border border-line rounded-[var(--radius-ctl)] mb-4">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-2">
            {editing?.id === i.id ? (
              <>
                <Input aria-label="Name" value={editing.name} onChange={(e) => setEditing({ id: i.id, name: e.target.value })} className="flex-1" autoFocus />
                <Button size="sm" variant="primary" icon={Check} onClick={async () => { if (editing.name.trim() && await save(i.id, { name: editing.name.trim() })) setEditing(null); }}>Save</Button>
                <Button size="sm" variant="ghost" icon={X} onClick={() => setEditing(null)} aria-label="Cancel" />
              </>
            ) : (
              <>
                <span className={cx('flex-1', !i.is_active && 'text-muted line-through')}>{i.name}</span>
                {!i.is_active && <Pill>Inactive</Pill>}
                <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setEditing({ id: i.id, name: i.name })} aria-label={`Rename ${i.name}`} />
                <Button size="sm" variant="ghost" onClick={() => void save(i.id, { is_active: !i.is_active })}>{i.is_active ? 'Deactivate' : 'Reactivate'}</Button>
              </>
            )}
          </li>
        ))}
        {!items.length && <li className="px-3 py-4 text-muted">Nothing on this list yet.</li>}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Input aria-label="New entry" placeholder="New entry…" value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
        <Button type="submit" icon={Plus}>Add</Button>
      </form>
    </Card>
  );
}

function DeviceTypes() {
  const { ds, reload } = useData();
  const toast = useToast();
  const [modal, setModal] = useState<number | 'new' | null>(null);
  const t = typeof modal === 'number' ? ds.deviceTypes.find((x) => x.id === modal) : undefined;
  const used = (id: number) => ds.assets.some((a) => a.device_type_id === id) || ds.byod.some((d) => d.device_type_id === id);
  const [v, setV] = useState({ name: '', code: '', description: '', gate: false, active: true });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    setErrs({});
    setV(t ? { name: t.name, code: t.code, description: t.description ?? '', gate: t.requires_gate_pass, active: t.is_active }
      : { name: '', code: '', description: '', gate: false, active: true });
  }, [modal, t]);

  async function submit(): Promise<string | null> {
    const e = required(v, { name: 'Device type', code: 'Type code' });
    if (v.code && !/^[A-Z]{3}$/.test(v.code)) e.code = 'Exactly 3 capital letters, e.g. LAP.';
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';
    const row = { name: v.name.trim(), description: v.description.trim() || null, requires_gate_pass: v.gate, is_active: v.active,
      ...(t && used(t.id) ? {} : { code: v.code }) };
    const { error } = t ? await supabase.from('device_types').update(row).eq('id', t.id)
      : await supabase.from('device_types').insert({ ...row, sort_order: ds.deviceTypes.length + 1 });
    if (error) return friendlyError(error);
    toast('ok', `Saved ${row.name}.`); await reload(); return null;
  }

  return (
    <Card title="Device types" description="The 3-letter code goes into every Asset Code, BYOD code and Badge ID. It is fixed once a device uses it."
      actions={<Button icon={Plus} onClick={() => setModal('new')}>Add device type</Button>} padded={false}>
      <table className="w-full text-[13.5px]">
        <thead><tr className="bg-surface-2/70 text-left text-[12px] uppercase tracking-wide text-muted">
          <th className="px-4 py-2.5">Device type</th><th className="px-4 py-2.5">Code</th><th className="px-4 py-2.5 hidden md:table-cell">Description</th>
          <th className="px-4 py-2.5">Needs gate pass</th><th className="px-4 py-2.5 text-right">Registered</th><th className="px-4 py-2.5"></th></tr></thead>
        <tbody>{ds.deviceTypes.map((d) => (
          <tr key={d.id} className="border-t border-line/70">
            <td className={cx('px-4 py-2.5', !d.is_active && 'text-muted line-through')}>{d.name}</td>
            <td className="px-4 py-2.5 code">{d.code}</td>
            <td className="px-4 py-2.5 text-muted hidden md:table-cell">{d.description}</td>
            <td className="px-4 py-2.5">{d.requires_gate_pass ? <Pill tone="primary">Yes</Pill> : <span className="text-muted">No</span>}</td>
            <td className="px-4 py-2.5 text-right">{ds.assets.filter((a) => a.device_type_id === d.id).length}</td>
            <td className="px-4 py-2.5 text-right"><Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setModal(d.id)} aria-label={`Edit ${d.name}`} /></td>
          </tr>
        ))}</tbody>
      </table>
      <FormModal open={modal !== null} onClose={() => setModal(null)} onSubmit={submit} submitLabel="Save" title={t ? `Edit ${t.name}` : 'Add a device type'}>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Device type" htmlFor="dt-name" required error={errs.name}><Input id="dt-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} invalid={!!errs.name} /></Field>
          <Field label="Type code" htmlFor="dt-code" required error={errs.code} hint={t && used(t.id) ? 'In use — cannot be changed.' : '3 capital letters.'}>
            <Input id="dt-code" value={v.code} maxLength={3} className="code uppercase" disabled={!!t && used(t.id)}
              onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} invalid={!!errs.code} />
          </Field>
          <Field label="Description" htmlFor="dt-desc" className="sm:col-span-2"><Input id="dt-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        </div>
        <label className="flex items-start gap-2.5 text-[13.5px]"><input type="checkbox" checked={v.gate} onChange={(e) => setV({ ...v, gate: e.target.checked })} className="mt-1 size-4 accent-[var(--color-primary)]" />
          <span>Every active unit of this type must have a gate pass<span className="block text-muted text-[12.5px]">The workbook applies this to laptops, phones and tablets.</span></span></label>
        <label className="flex items-center gap-2.5 text-[13.5px]"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} className="size-4 accent-[var(--color-primary)]" />Show in dropdowns</label>
      </FormModal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const ROLE_HELP: Record<Role, string> = {
  viewer: 'Read everything, export and print forms.',
  editor: 'Viewer + register assets, issue/return, badges, gate log, accessories.',
  admin: 'Editor + users, lists, Excel import, deleting mistaken records.',
};

function Users() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const load = async () => {
    const { data, error: err } = await supabase.from('profiles').select('*').order('email');
    if (err) setError(friendlyError(err)); else setUsers(data as Profile[]);
  };
  useEffect(() => { void load(); }, []);

  async function update(u: Profile, patch: Partial<Profile>) {
    setError(null);
    const { error: err } = await supabase.from('profiles').update(patch).eq('user_id', u.user_id);
    if (err) { setError(friendlyError(err)); return; }
    toast('ok', `Updated ${u.email}.`); await load();
  }

  return (
    <Card title="Users & roles" description="New sign-ups have no access until you give them a role here."
      actions={<Button icon={MailPlus} variant="primary" onClick={() => setInviting(true)}>Invite user</Button>} padded={false}>
      {error && <div className="p-4 pb-0"><Notice tone="danger">{error}</Notice></div>}
      <div className="px-5 py-3 grid sm:grid-cols-3 gap-2 text-[12.5px] text-muted border-b border-line">
        {(Object.keys(ROLE_HELP) as Role[]).map((r) => <div key={r}><b className="text-ink-2 capitalize">{r}</b>: {ROLE_HELP[r]}</div>)}
      </div>
      <div className="overflow-x-auto"><table className="w-full text-[13.5px]">
        <thead><tr className="bg-surface-2/70 text-left text-[12px] uppercase tracking-wide text-muted">
          <th className="px-4 py-2.5">User</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Account</th><th className="px-4 py-2.5 hidden md:table-cell">Created</th></tr></thead>
        <tbody>{(users ?? []).map((u) => {
          const self = u.user_id === me?.user_id;
          return (
            <tr key={u.user_id} className="border-t border-line/70">
              <td className="px-4 py-2.5"><div>{u.full_name || u.email}</div>{u.full_name && <div className="text-[12px] text-muted">{u.email}</div>}</td>
              <td className="px-4 py-2.5">
                {self ? <span className="capitalize">{u.role} <span className="text-muted">(you)</span></span> : (
                  <Select aria-label={`Role for ${u.email}`} value={u.role ?? ''} onChange={(e) => void update(u, { role: (e.target.value || null) as Role | null })} className="w-40">
                    <option value="">No access</option><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Administrator</option>
                  </Select>
                )}
              </td>
              <td className="px-4 py-2.5">
                {self ? <Pill tone="ok">Active</Pill> : (
                  <Button size="sm" variant="ghost" onClick={() => void update(u, { is_active: !u.is_active })}>{u.is_active ? <><Pill tone="ok">Active</Pill> Disable</> : <><Pill>Disabled</Pill> Enable</>}</Button>
                )}
              </td>
              <td className="px-4 py-2.5 text-muted hidden md:table-cell">{formatDateTime(u.created_at)}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <InviteModal open={inviting} onClose={() => setInviting(false)} onDone={() => void load()} />
    </Card>
  );
}

function InviteModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ email: '', name: '', role: 'viewer' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setV({ email: '', name: '', role: 'viewer' }); setErrs({}); } }, [open]);
  async function submit(): Promise<string | null> {
    const e = required(v, { email: 'Email', name: 'Full name' });
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = 'Enter a valid email address.';
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/invite-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ email: v.email.trim(), full_name: v.name.trim(), role: v.role, redirect_to: `${location.origin}/set-password` }),
    }).catch(() => null);
    if (!res) return 'Could not reach the server. Check your connection.';
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return body.error ?? 'The invitation could not be sent.';
    toast('ok', `Invitation sent to ${v.email.trim()}.`);
    onDone();
    return null;
  }
  return (
    <FormModal open={open} onClose={onClose} onSubmit={submit} submitLabel="Send invitation" title="Invite a user"
      description="They receive an email with a link to set their password.">
      <Field label="Email" htmlFor="iv-email" required error={errs.email}><Input id="iv-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} invalid={!!errs.email} /></Field>
      <Field label="Full name" htmlFor="iv-name" required error={errs.name}><Input id="iv-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} invalid={!!errs.name} /></Field>
      <Field label="Role" htmlFor="iv-role" required hint={ROLE_HELP[v.role as Role]}>
        <Select id="iv-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
          <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Administrator</option>
        </Select>
      </Field>
    </FormModal>
  );
}
