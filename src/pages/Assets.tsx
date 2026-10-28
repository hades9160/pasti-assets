import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { useData, logEvent } from '../lib/data';
import { useAuth } from '../lib/auth';
import {
  assetActiveBadge, assetAlerts, assetAlertsText, assetAlsoInByod, assetInHistory, departmentName, deviceTypeName, employeeName, lastHolder,
} from '../lib/rules';
import { exportRows } from '../lib/export';
import { ASSET_STATUSES, type Asset } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';
import { AssetFormModal } from '../components/assetModals';
import { Button, Card, CheckList, PageHeader, SearchInput, Select, StatusPill, Toolbar } from '../components/ui';

export function Assets() {
  const { ix, ds } = useData();
  const { canEdit } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? 'live';
  const type = params.get('type') ?? '';
  const dept = params.get('dept') ?? '';
  const alert = params.get('alert') ?? '';
  const [creating, setCreating] = useState(params.get('new') === '1' && canEdit);

  const setParam = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); p.delete('new'); return p; }, { replace: true });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ds.assets.filter((a) => {
      if (status === 'live') { if (a.status === 'Void') return false; } else if (status !== 'all' && a.status !== status) return false;
      if (type && String(a.device_type_id) !== type) return false;
      if (dept && String(a.department_id ?? '') !== dept) return false;
      if (alert) {
        const list = assetAlerts(ix, a);
        if (alert === 'gate' ? !list.includes('⚠ Needs gate pass') : !list.length) return false;
      }
      if (!needle) return true;
      return [a.asset_code, a.brand_model, a.serial_number, employeeName(ix, a.custodian_id), deviceTypeName(ix, a.device_type_id), a.remarks]
        .some((x) => x?.toLowerCase().includes(needle));
    });
  }, [ds.assets, ix, q, status, type, dept, alert]);

  const holder = (a: Asset) => {
    if (a.custodian_id) return employeeName(ix, a.custodian_id);
    const last = lastHolder(ix, a);
    return last ? `— (last: ${employeeName(ix, last.custodian_id)})` : '—';
  };

  const columns: Column<Asset>[] = [
    { key: 'code', header: 'Asset code', sort: (a) => a.asset_code, cell: (a) => <span className="code text-ink font-medium">{a.asset_code}</span> },
    { key: 'device', header: 'Device', sort: (a) => deviceTypeName(ix, a.device_type_id), cell: (a) => (
      <div className="min-w-40"><div className="text-ink">{a.brand_model || <span className="text-muted">No brand/model</span>}</div>
        <div className="text-[12px] text-muted">{deviceTypeName(ix, a.device_type_id)}</div></div>) },
    { key: 'serial', header: 'Serial number', minWidth: 'md', sort: (a) => a.serial_number, cell: (a) => <span className="code">{a.serial_number ?? '—'}</span> },
    { key: 'holder', header: 'Holder', sort: (a) => employeeName(ix, a.custodian_id), cell: (a) =>
      <span className={a.custodian_id ? 'text-ink' : 'text-muted'}>{holder(a)}</span> },
    { key: 'dept', header: 'Department / Location', minWidth: 'lg', sort: (a) => departmentName(ix, a.department_id), cell: (a) => departmentName(ix, a.department_id) || '—' },
    { key: 'status', header: 'Status', sort: (a) => a.status, cell: (a) => <StatusPill status={a.status} /> },
    { key: 'badge', header: 'Gate pass', minWidth: 'lg', sort: (a) => assetActiveBadge(ix, a), cell: (a) => {
      const b = assetActiveBadge(ix, a);
      return b.startsWith('PASTI') ? <span className="code">{b}</span> : <span className="text-muted">{b === '—' ? '—' : 'None'}</span>;
    } },
    { key: 'alerts', header: 'Alerts', sort: (a) => assetAlerts(ix, a).length, cell: (a) =>
      a.status === 'Void' ? <span className="text-muted">Void – not counted</span> : <CheckList items={assetAlerts(ix, a)} /> },
  ];

  async function doExport() {
    await exportRows(`asset-register-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Asset Register', [
      { header: 'Date Encoded', value: (a: Asset) => a.date_encoded, width: 13 },
      { header: 'Device Type', value: (a) => deviceTypeName(ix, a.device_type_id), width: 20 },
      { header: 'Type Code', value: (a) => a.type_code },
      { header: 'Year', value: (a) => a.code_year },
      { header: 'Sequence No.', value: (a) => a.sequence_no },
      { header: 'Asset Code', value: (a) => a.asset_code, width: 20 },
      { header: 'Brand / Model', value: (a) => a.brand_model, width: 24 },
      { header: 'Serial Number', value: (a) => a.serial_number, width: 18 },
      { header: 'Custodian / Keeper', value: (a) => employeeName(ix, a.custodian_id), width: 24 },
      { header: 'Department / Location', value: (a) => departmentName(ix, a.department_id), width: 24 },
      { header: 'Status', value: (a) => a.status, width: 14 },
      { header: 'Remarks', value: (a) => a.remarks, width: 30 },
      { header: 'Active Badge ID', value: (a) => assetActiveBadge(ix, a), width: 22 },
      { header: 'Also in BYOD Sheet?', value: (a) => assetAlsoInByod(ix, a) },
      { header: 'In Assignment History?', value: (a) => assetInHistory(ix, a) },
      { header: 'Alerts', value: (a) => assetAlertsText(ix, a).trim(), width: 40 },
    ], rows);
    await logEvent('EXPORT', 'Asset Register', { rows: rows.length, filters: Object.fromEntries(params) });
  }

  return (
    <>
      <PageHeader title="Asset Register" description="Every company-issued IT device and its permanent asset code. Click a row to issue, return or update it."
        actions={<>
          <Button icon={Download} onClick={() => void doExport()} disabled={!rows.length}>Export to Excel</Button>
          {canEdit && <Button icon={Plus} variant="primary" onClick={() => setCreating(true)}>Register asset</Button>}
        </>} />
      <Card padded={false}>
        <div className="p-3 pb-0">
          <Toolbar>
            <SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Search code, serial, brand, holder…" />
            <Select aria-label="Status" value={status} onChange={(e) => setParam('status', e.target.value === 'live' ? '' : e.target.value)} className="w-auto">
              <option value="live">All except Void</option>
              <option value="all">All statuses</option>
              {ASSET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select aria-label="Device type" value={type} onChange={(e) => setParam('type', e.target.value)} className="w-auto">
              <option value="">All device types</option>
              {ds.deviceTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Select aria-label="Department" value={dept} onChange={(e) => setParam('dept', e.target.value)} className="w-auto">
              <option value="">All departments</option>
              {ds.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select aria-label="Alerts" value={alert} onChange={(e) => setParam('alert', e.target.value)} className="w-auto">
              <option value="">Any alerts</option>
              <option value="any">With ⚠ alerts only</option>
              <option value="gate">Needs a gate pass</option>
            </Select>
          </Toolbar>
        </div>
        <DataTable rows={rows} columns={columns} rowKey={(a) => a.id} onRowClick={(a) => nav(`/assets/${a.id}`)}
          initialSort={{ key: 'code', dir: 'asc' }} rowClassName={(a) => (a.status === 'Void' ? 'opacity-60' : undefined)}
          empty={ds.assets.length ? { title: 'No assets match these filters', body: 'Clear the search or choose different filters.' }
            : { title: 'No assets registered yet', body: canEdit ? 'Click "Register asset" to add the first one.' : 'IT has not registered any assets yet.' }} />
      </Card>
      <p className="text-[12px] text-muted mt-3">Asset codes never change. Records entered by mistake are set to Void, never deleted.</p>
      <AssetFormModal open={creating} onClose={() => setCreating(false)} onSaved={(id) => nav(`/assets/${id}`)} />
    </>
  );
}
