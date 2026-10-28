import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeAlert, CalendarClock, ClipboardSignature, Laptop, LogOut, Plus, ShieldAlert, Smartphone, TriangleAlert } from 'lucide-react';
import { useData } from '../lib/data';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { assetAlerts, badgeCheck, badgeValidity, employeeStats, registeredCountByType, summary } from '../lib/rules';
import { formatDate, formatDateTime } from '../lib/dates';
import type { ActivityEntry } from '../lib/types';
import { ButtonLink, Card, CheckText, EmptyState, PageHeader, Pill, StatCard } from '../components/ui';
import { actionLabel, tableLabel } from './Activity';

// Charting library is loaded separately so the rest of the app opens faster.
const TypeChart = lazy(() => import('../components/TypeChart'));

export function Dashboard() {
  const { ix, today } = useData();
  const { canEdit } = useAuth();
  const s = useMemo(() => summary(ix, today), [ix, today]);
  const [recent, setRecent] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(8)
      .then(({ data }) => setRecent((data as ActivityEntry[]) ?? []));
  }, [ix]);

  // The workbook's "filter the column for ⚠" to-do list, across all sheets.
  const todo = useMemo(() => {
    const out: { key: string; text: string; to: string; what: string }[] = [];
    for (const b of ix.ds.badges) {
      if (b.status !== 'Active') continue;
      const v = badgeValidity(b, today);
      if (v.startsWith('⚠')) out.push({ key: 'v' + b.id, text: v, to: `/badges?q=${b.badge_code}`, what: b.badge_code });
      const c = badgeCheck(ix, b);
      if (c.startsWith('⚠')) out.push({ key: 'c' + b.id, text: c, to: `/badges?q=${b.badge_code}`, what: b.badge_code });
    }
    for (const e of ix.ds.employees) {
      const st = employeeStats(ix, e);
      if (st.exitClearance.startsWith('⚠')) out.push({ key: 'x' + e.id, text: st.exitClearance, to: `/employees/${e.id}`, what: e.full_name });
    }
    for (const a of ix.ds.assets) {
      for (const m of assetAlerts(ix, a)) out.push({ key: a.id + m, text: m, to: `/assets/${a.id}`, what: a.asset_code });
    }
    return out;
  }, [ix, today]);

  const byType = useMemo(() => {
    const counts = registeredCountByType(ix);
    const live = new Map<number, number>();
    for (const a of ix.ds.assets) if (a.status !== 'Void') live.set(a.device_type_id, (live.get(a.device_type_id) ?? 0) + 1);
    return ix.ds.deviceTypes.filter((t) => counts.get(t.id)).map((t) => ({ name: t.code, full: t.name, count: live.get(t.id) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [ix]);

  const empty = ix.ds.assets.length === 0 && ix.ds.employees.length === 0;

  return (
    <>
      <PageHeader title="Dashboard" description={`What needs attention today, ${formatDate(today)}.`}
        actions={canEdit && <><ButtonLink to="/assets?new=1" icon={Plus} variant="primary">Register asset</ButtonLink>
          <ButtonLink to="/gate" icon={LogOut}>Log gate movement</ButtonLink></>} />

      {empty && (
        <Card className="mb-5"><EmptyState icon={Laptop} title="The register is empty">
          An administrator can bring in the existing Excel workbook from <Link className="text-primary hover:underline" to="/import">Import from Excel</Link>,
          or start by adding employees and registering assets.
        </EmptyState></Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Laptop} label="Assets in service" value={s.assetsInService} hint={`${s.assetsTotal} registered (excluding void)`} to="/assets" />
        <StatCard icon={ShieldAlert} label="Need a gate pass" value={s.needsGatePass} tone={s.needsGatePass ? 'warn' : 'ok'}
          hint="Active laptops, phones and tablets without a pass" to="/assets?alert=gate" />
        <StatCard icon={CalendarClock} label="Passes expiring or expired" value={s.expiringBadges + s.expiredBadges}
          tone={s.expiredBadges ? 'danger' : s.expiringBadges ? 'warn' : 'ok'}
          hint={`${s.expiredBadges} expired · ${s.expiringBadges} within 14 days`} to="/badges?validity=attention" />
        <StatCard icon={ClipboardSignature} label="Forms to print & sign" value={s.employeesUnsigned} tone={s.employeesUnsigned ? 'warn' : 'ok'}
          hint="New items since the last signed form" to="/employees?form=attention" />
        <StatCard icon={TriangleAlert} label="Assets with alerts" value={s.assetsWithAlerts} tone={s.assetsWithAlerts ? 'warn' : 'ok'} to="/assets?alert=any" />
        <StatCard icon={BadgeAlert} label="Active gate passes" value={s.activeBadges} tone="primary" to="/badges?status=Active" />
        <StatCard icon={LogOut} label="Exit clearances pending" value={s.employeesNotCleared} tone={s.employeesNotCleared ? 'danger' : 'ok'}
          hint="Separated staff still holding items" to="/employees?clearance=pending" />
        <StatCard icon={Smartphone} label="Personal devices" value={s.byodActive} tone="info" hint={`${s.accessoriesOut} accessories out`} to="/byod" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card className="xl:col-span-3" title="To-do" description="Every ⚠ warning across the register. Click one to open the record." padded={false}>
          {todo.length === 0 ? <EmptyState title="Nothing to fix">All checks are OK.</EmptyState> : (
            <ul className="divide-y divide-line/70 max-h-[420px] overflow-y-auto">
              {todo.slice(0, 60).map((t) => (
                <li key={t.key}>
                  <Link to={t.to} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 hover:bg-surface-2">
                    <span className="code text-ink-2 w-48 shrink-0 truncate">{t.what}</span>
                    <CheckText text={t.text} />
                  </Link>
                </li>
              ))}
              {todo.length > 60 && <li className="px-5 py-2.5 text-muted text-[13px]">…and {todo.length - 60} more on the register pages.</li>}
            </ul>
          )}
        </Card>

        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card title="Devices by type" description="Registered company assets, excluding void (Type Codes sheet).">
            {byType.length === 0 ? <p className="text-muted">No assets yet.</p> : (
              <Suspense fallback={<div className="h-56" />}><TypeChart data={byType} /></Suspense>
            )}
          </Card>
          <Card title="Recent activity" actions={<Link to="/activity" className="text-[13px] text-primary hover:underline">View all</Link>} padded={false}>
            {!recent ? <p className="p-5 text-muted">Loading…</p> : recent.length === 0 ? <p className="p-5 text-muted">Nothing recorded yet.</p> : (
              <ul className="divide-y divide-line/70">
                {recent.map((r) => (
                  <li key={r.id} className="px-5 py-2.5 text-[13px]">
                    <div className="flex items-center gap-2">
                      <Pill tone={r.action === 'DELETE' ? 'danger' : r.action === 'CREATE' ? 'ok' : 'neutral'}>{actionLabel(r.action)}</Pill>
                      <span className="text-ink truncate">{tableLabel(r.table_name)} {r.record_label}</span>
                    </div>
                    <div className="text-muted mt-0.5">{r.user_email} · {formatDateTime(r.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
