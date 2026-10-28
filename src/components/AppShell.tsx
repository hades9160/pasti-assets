import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BadgeCheck, Cable, DoorOpen, FileUp, History, LayoutDashboard, Laptop, LogOut, Menu, ScrollText, Settings,
  Smartphone, Users, X, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { cx, Notice, Spinner } from './ui';

interface NavItem { to: string; label: string; icon: LucideIcon; admin?: boolean; badge?: number }

export function AppShell() {
  const { profile, role, isAdmin, signOut } = useAuth();
  const { loading, error, reload, ix, today } = useData();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const needsPass = ix.ds.assets.filter((a) => a.status === 'Active' && ix.deviceTypeById.get(a.device_type_id)?.requires_gate_pass
    && !ix.ds.badges.some((b) => b.asset_id === a.id && b.status === 'Active')).length;
  const expired = ix.ds.badges.filter((b) => b.status === 'Active' && today > b.valid_until).length;

  const groups: [string, NavItem[]][] = [
    ['Daily work', [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/assets', label: 'Asset Register', icon: Laptop, badge: needsPass },
      { to: '/employees', label: 'Employees', icon: Users },
      { to: '/badges', label: 'Gate Passes', icon: BadgeCheck, badge: expired },
      { to: '/gate', label: 'Gate Log', icon: DoorOpen },
    ]],
    ['Records', [
      { to: '/byod', label: 'Personal Devices', icon: Smartphone },
      { to: '/accessories', label: 'Accessories', icon: Cable },
      { to: '/history', label: 'Assignment History', icon: History },
      { to: '/activity', label: 'Activity Log', icon: ScrollText },
    ]],
    ['Administration', [
      { to: '/import', label: 'Import from Excel', icon: FileUp, admin: true },
      { to: '/settings', label: 'Settings & Users', icon: Settings, admin: true },
    ]],
  ];

  return (
    <div className="min-h-dvh">
      {/* Sidebar — KLMS navy gradient */}
      <aside className={cx(
        'no-print fixed inset-y-0 left-0 z-40 w-64 flex flex-col text-white transition-transform duration-300',
        'bg-[linear-gradient(190deg,var(--color-navy-900)_0%,var(--color-navy-800)_100%)] border-r border-white/5',
        open ? 'translate-x-0 shadow-[8px_0_32px_#000a]' : '-translate-x-full lg:translate-x-0',
      )}>
        <div className="flex items-center gap-2.5 h-16 px-5 border-b border-white/[0.07] shrink-0">
          <div className="size-8 rounded-lg bg-accent/15 text-accent grid place-items-center"><Laptop className="size-[18px]" aria-hidden /></div>
          <div className="leading-tight">
            <div className="font-extrabold tracking-wide text-[15px]">PASTI Assets</div>
            <div className="text-[11px] text-white/55">IT Asset Register</div>
          </div>
          <button className="ml-auto lg:hidden p-1 text-white/70 hover:text-white" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main">
          {groups.map(([group, items]) => {
            const shown = items.filter((i) => !i.admin || isAdmin);
            if (!shown.length) return null;
            return (
              <div key={group} className="mb-3">
                <div className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/40">{group}</div>
                {shown.map(({ to, label, icon: Icon, badge }) => (
                  <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx(
                    'relative flex items-center gap-3 rounded-[9px] px-3 py-2 text-[13.5px] font-medium transition-all duration-150',
                    isActive ? 'bg-white/[0.13] text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-accent'
                      : 'text-white/70 hover:bg-white/[0.07] hover:text-white hover:translate-x-0.5',
                  )}>
                    <Icon className="size-[18px]" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {!!badge && <span className="min-w-5 h-5 px-1.5 rounded-full bg-warn text-[#1b1406] text-[11px] font-bold grid place-items-center"
                      title={`${badge} need attention`}>{badge}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/[0.07] p-3 shrink-0">
          <div className="px-2 pb-2 text-[12.5px] leading-tight">
            <div className="font-medium truncate">{profile?.full_name || profile?.email}</div>
            <div className="text-white/50 capitalize">{role}</div>
          </div>
          <button onClick={() => void signOut()} className="w-full flex items-center gap-3 rounded-[9px] px-3 py-2 text-[13.5px] text-white/70 hover:bg-white/[0.07] hover:text-white">
            <LogOut className="size-[18px]" aria-hidden />Sign out
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden no-print" onClick={() => setOpen(false)} aria-hidden />}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 h-14 flex items-center gap-3 px-4 sm:px-6 bg-bg/85 backdrop-blur border-b border-line lg:hidden">
          <button onClick={() => setOpen(true)} className="p-2 -ml-2 rounded-lg hover:bg-surface-2" aria-label="Open menu"><Menu className="size-5" /></button>
          <span className="font-bold">PASTI Assets</span>
        </header>
        <main className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
          {error && <div className="mb-4"><Notice tone="danger">{error} <button className="underline ml-1" onClick={() => void reload()}>Try again</button></Notice></div>}
          {loading ? <Spinner label="Loading the register…" /> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
