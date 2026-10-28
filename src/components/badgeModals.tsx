import { useEffect, useState } from 'react';
import { useData } from '../lib/data';
import { friendlyError, supabase } from '../lib/supabase';
import { formatDate, isValidISODate, todayISO } from '../lib/dates';
import { badgeDevice, badgeValidUntil, deviceTypeName, employeeName } from '../lib/rules';
import type { Badge, Ownership } from '../lib/types';
import { FormModal } from './Modal';
import { required } from './pickers';
import { Details, Field, Input, Notice, Select, Textarea } from './ui';
import { useToast } from './toast';

/** Issue a new Electronic Device Pass. */
export function IssueBadgeModal({ open, onClose, ownership: fixedOwnership, deviceId }: {
  open: boolean; onClose: () => void; ownership?: Ownership; deviceId?: string;
}) {
  const { ix, reload } = useData();
  const toast = useToast();
  const [v, setV] = useState({ ownership: 'Company-Owned' as Ownership, device: '', date: '', remarks: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) { setV({ ownership: fixedOwnership ?? 'Company-Owned', device: deviceId ?? '', date: todayISO(), remarks: '' }); setErrs({}); }
  }, [open, fixedOwnership, deviceId]);

  const hasActive = (id: string, own: Ownership) => ix.ds.badges.some((b) => b.status === 'Active' && (own === 'Company-Owned' ? b.asset_id : b.byod_id) === id);
  const companyOptions = ix.ds.assets
    .filter((a) => a.status === 'Active' && a.custodian_id && (!hasActive(a.id, 'Company-Owned') || a.id === deviceId))
    .map((a) => ({ id: a.id, label: `${a.asset_code} · ${a.brand_model ?? deviceTypeName(ix, a.device_type_id)} · ${employeeName(ix, a.custodian_id)}` }));
  const byodOptions = ix.ds.byod
    .filter((d) => d.status === 'Active' && d.owner_id && (!hasActive(d.id, 'Employee-Owned') || d.id === deviceId))
    .map((d) => ({ id: d.id, label: `${d.byod_code} · ${d.brand_model ?? deviceTypeName(ix, d.device_type_id)} · ${employeeName(ix, d.owner_id)}` }));
  const options = v.ownership === 'Company-Owned' ? companyOptions : byodOptions;

  const holder = v.device ? (v.ownership === 'Company-Owned' ? ix.asset.get(v.device)?.custodian_id : ix.byod.get(v.device)?.owner_id) : null;

  async function submit(): Promise<string | null> {
    const e = required(v, { device: 'Device', date: 'Date issued' });
    if (v.date && !isValidISODate(v.date)) e.date = 'Enter a valid date.';
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';
    const { data, error } = await supabase.rpc('issue_badge', { p_ownership: v.ownership, p_device_id: v.device, p_date: v.date, p_remarks: v.remarks || null });
    if (error) return friendlyError(error);
    toast('ok', `Badge ${(data as Badge).badge_code} issued, valid until ${formatDate((data as Badge).valid_until)}.`);
    await reload();
    return null;
  }

  return (
    <FormModal open={open} onClose={onClose} title="Issue a gate pass" submitLabel="Issue badge" onSubmit={submit}
      description="Badge ID PASTI-EDP-TYPE-YY-#### is created automatically. Valid for 3 months.">
      {!fixedOwnership && (
        <Field label="Ownership" htmlFor="b-own" required>
          <Select id="b-own" value={v.ownership} onChange={(e) => setV({ ...v, ownership: e.target.value as Ownership, device: '' })}>
            <option value="Company-Owned">Company-owned asset</option>
            <option value="Employee-Owned">Employee-owned (personal) device</option>
          </Select>
        </Field>
      )}
      <Field label="Device" htmlFor="b-device" required error={errs.device}
        hint={options.length ? 'Only active devices with a holder and no active pass are listed.'
          : v.ownership === 'Company-Owned' ? 'No eligible assets. Issue the asset to an employee first.' : 'No eligible personal devices. Register it with an owner and Active status first.'}>
        <Select id="b-device" value={v.device} onChange={(e) => setV({ ...v, device: e.target.value })} invalid={!!errs.device} disabled={!!deviceId}>
          <option value="">Choose a device…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Date issued" htmlFor="b-date" required error={errs.date}>
          <Input id="b-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} invalid={!!errs.date} />
        </Field>
        <Field label="Valid until" htmlFor="b-valid" hint="Calculated: 3 months from the issue date.">
          <Input id="b-valid" value={isValidISODate(v.date) ? formatDate(badgeValidUntil(v.date)) : ''} readOnly className="text-muted" />
        </Field>
      </div>
      {holder && <Notice tone="info">The pass will be in the name of <b>{employeeName(ix, holder)}</b>, the device's holder.</Notice>}
      <Field label="Remarks" htmlFor="b-remarks">
        <Textarea id="b-remarks" rows={2} value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} />
      </Field>
    </FormModal>
  );
}

/** Replacement / renewal: same Badge ID, old row superseded (Read Me "REPLACEMENTS"). */
export function RenewBadgeModal({ open, onClose, badge }: { open: boolean; onClose: () => void; badge: Badge }) {
  const { ix, reload } = useData();
  const toast = useToast();
  const [v, setV] = useState({ date: '', reason: 'Superseded', remarks: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setV({ date: todayISO(), reason: 'Superseded', remarks: '' }); setErrs({}); } }, [open]);
  const dev = badgeDevice(ix, badge);

  async function submit(): Promise<string | null> {
    const e = required(v, { date: 'Date issued' });
    if (v.date && v.date < badge.date_issued) e.date = `Cannot be before ${formatDate(badge.date_issued)}.`;
    setErrs(e);
    if (Object.keys(e).length) return 'Please fix the highlighted fields.';
    const { data, error } = await supabase.rpc('renew_badge', {
      p_badge_id: badge.id, p_date: v.date, p_new_device_id: null, p_old_status: v.reason, p_remarks: v.remarks || null,
    });
    if (error) return friendlyError(error);
    toast('ok', `${badge.badge_code} renewed, valid until ${formatDate((data as Badge).valid_until)}.`);
    await reload();
    return null;
  }

  return (
    <FormModal open={open} onClose={onClose} title={`Renew ${badge.badge_code}`} submitLabel="Renew badge" onSubmit={submit}
      description="Adds a new row with the same Badge ID for the same holder. No new number is used.">
      <Details items={[['Holder', employeeName(ix, badge.holder_id)], ['Device', `${dev.code} · ${dev.brand || dev.type}`],
        ['Currently valid until', formatDate(badge.valid_until)], ['Status', badge.status]]} />
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Why is it being replaced?" htmlFor="rn-reason" required>
          <Select id="rn-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })}>
            <option value="Superseded">Expired / renewal</option>
            <option value="Lost/Damaged">Old badge lost or damaged</option>
          </Select>
        </Field>
        <Field label="Date issued" htmlFor="rn-date" required error={errs.date}>
          <Input id="rn-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} invalid={!!errs.date} />
        </Field>
      </div>
      <Field label="Remarks" htmlFor="rn-remarks">
        <Textarea id="rn-remarks" rows={2} value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} />
      </Field>
    </FormModal>
  );
}

export function RevokeBadgeModal({ open, onClose, badge }: { open: boolean; onClose: () => void; badge: Badge }) {
  const { ix, reload } = useData();
  const toast = useToast();
  const [status, setStatus] = useState('Revoked');
  const [remarks, setRemarks] = useState('');
  useEffect(() => { if (open) { setStatus('Revoked'); setRemarks(''); } }, [open]);
  async function submit(): Promise<string | null> {
    const note = remarks.trim() ? [badge.remarks, remarks.trim()].filter(Boolean).join(' | ') : badge.remarks;
    const { error } = await supabase.from('badges').update({ status, remarks: note }).eq('id', badge.id);
    if (error) return friendlyError(error);
    toast('ok', `${badge.badge_code} is now "${status}". Security will be told not to allow it.`);
    await reload();
    return null;
  }
  return (
    <FormModal open={open} onClose={onClose} title={`Revoke ${badge.badge_code}`} submitLabel="Revoke badge" danger onSubmit={submit}
      description={`Held by ${employeeName(ix, badge.holder_id)}. A revoked badge can never be made active again.`}>
      <Field label="New status" htmlFor="rv-status" required>
        <Select id="rv-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="Revoked">Revoked (device returned or moved to someone else)</option>
          <option value="Lost/Damaged">Lost / damaged badge</option>
        </Select>
      </Field>
      <Field label="Remarks" htmlFor="rv-remarks">
        <Textarea id="rv-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </FormModal>
  );
}
