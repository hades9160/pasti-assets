import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BadgePlus, PencilLine, RotateCcw, UserRoundPlus, Wrench } from 'lucide-react';
import { useData } from '../lib/data';
import { useAuth } from '../lib/auth';
import {
  accessoryStatus, assetActiveBadge, assetAlerts, assetAlsoInByod, assetInHistory, assignmentCheck, badgeValidity,
  daysHeld, departmentName, deviceTypeName, employeeName, lastHolder, recordStatus,
} from '../lib/rules';
import { formatDate, formatDateTime } from '../lib/dates';
import type { Accessory, Assignment, Badge } from '../lib/types';
import { DataTable } from '../components/DataTable';
import { AssetFormModal, IssueAssetModal, ReturnAssetModal, StatusModal } from '../components/assetModals';
import { IssueBadgeModal } from '../components/badgeModals';
import { Button, Card, CheckList, CheckText, Details, EmptyState, Notice, StatusPill } from '../components/ui';

export function AssetDetail() {
  const { id } = useParams();
  const { ix, today } = useData();
  const { canEdit, isAdmin } = useAuth();
  const [modal, setModal] = useState<null | 'edit' | 'issue' | 'return' | 'repair' | 'active' | 'badge'>(null);
  const a = id ? ix.asset.get(id) : undefined;

  if (!a) return <Card><EmptyState title="Asset not found">It may have been removed from the list. <Link className="text-primary hover:underline" to="/assets">Back to the register</Link></EmptyState></Card>;

  const history = [...(ix.assignmentsByAsset.get(a.id) ?? [])].sort((x, y) => y.date_issued.localeCompare(x.date_issued));
  const badges = ix.ds.badges.filter((b) => b.asset_id === a.id).sort((x, y) => y.row_no - x.row_no);
  const accessories = ix.ds.accessories.filter((x) => x.for_asset_id === a.id);
  const alerts = assetAlerts(ix, a);
  const activeBadge = assetActiveBadge(ix, a);
  const retired = ['Lost/Stolen', 'Decommissioned', 'Void'].includes(a.status);
  const needsBadge = a.status === 'Active' && a.custodian_id && !activeBadge.startsWith('PASTI');
  const last = lastHolder(ix, a);
  const close = () => setModal(null);

  return (
    <>
      <Link to="/assets" className="no-print inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft className="size-4" />Asset Register</Link>
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="code !text-xl font-bold text-ink">{a.asset_code}</h1>
            <StatusPill status={a.status} />
          </div>
          <p className="text-ink-2 mt-1">{a.brand_model || 'No brand/model'} · {deviceTypeName(ix, a.device_type_id)}
            {a.custodian_id && <> · held by <Link className="text-primary hover:underline" to={`/employees/${a.custodian_id}`}>{employeeName(ix, a.custodian_id)}</Link></>}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {!retired && <Button icon={UserRoundPlus} variant="primary" onClick={() => setModal('issue')}>{a.custodian_id ? 'Hand over' : 'Issue to employee'}</Button>}
            {needsBadge && <Button icon={BadgePlus} onClick={() => setModal('badge')}>Issue gate pass</Button>}
            {a.status === 'Active' && <Button icon={Wrench} onClick={() => setModal('repair')}>Under repair</Button>}
            {(a.status === 'Under Repair' || a.status === 'Returned to IT' || a.status === 'Lost/Stolen' || (isAdmin && a.status === 'Decommissioned')) &&
              <Button icon={Wrench} onClick={() => setModal('active')}>Back in service</Button>}
            {a.status !== 'Void' && <Button icon={RotateCcw} onClick={() => setModal('return')}>Return / retire</Button>}
            <Button icon={PencilLine} variant="ghost" onClick={() => setModal('edit')}>Edit details</Button>
          </div>
        )}
      </div>

      {alerts.length > 0 && <div className="mb-4"><Notice tone="warn"><div className="flex flex-wrap gap-1.5 items-center">To fix: <CheckList items={alerts} /></div></Notice></div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card title="Details" className="xl:col-span-2">
          <Details items={[
            ['Date encoded', formatDate(a.date_encoded)], ['Device type', `${deviceTypeName(ix, a.device_type_id)} (${a.type_code})`],
            ['Brand / Model', a.brand_model], ['Serial number', a.serial_number && <span key="serial" className="code">{a.serial_number}</span>],
            ['Holder', a.custodian_id ? employeeName(ix, a.custodian_id) : last ? `Nobody — last held by ${employeeName(ix, last.custodian_id)}` : 'Nobody (with IT)'],
            ['Department / Location', departmentName(ix, a.department_id)],
            ['Remarks', a.remarks], ['Last updated', formatDateTime(a.updated_at)],
          ]} />
        </Card>
        <Card title="Checks" description="The workbook's automatic columns for this row.">
          <dl className="flex flex-col gap-3 text-[13.5px]">
            <div><dt className="text-muted text-[12px] uppercase tracking-wide">Active gate pass</dt>
              <dd className="mt-0.5">{activeBadge.startsWith('PASTI') ? <Link className="code text-primary hover:underline" to={`/badges?q=${activeBadge}`}>{activeBadge}</Link> : <span className="text-muted">{activeBadge}</span>}</dd></div>
            <div><dt className="text-muted text-[12px] uppercase tracking-wide">In Assignment History?</dt><dd className="mt-0.5"><CheckText text={assetInHistory(ix, a) || '—'} /></dd></div>
            <div><dt className="text-muted text-[12px] uppercase tracking-wide">Also on Personal Devices?</dt><dd className="mt-0.5"><CheckText text={assetAlsoInByod(ix, a) || '—'} /></dd></div>
            <div><dt className="text-muted text-[12px] uppercase tracking-wide">Alerts</dt><dd className="mt-0.5">{a.status === 'Void' ? <span className="text-muted">Void – not counted</span> : <CheckList items={alerts} />}</dd></div>
          </dl>
        </Card>
      </div>

      <Card title="Assignment history" description="Who held this unit, from when to when." padded={false} className="mb-4">
        <DataTable<Assignment> rows={history} rowKey={(h) => h.id} pageSize={10} empty={{ title: 'Never issued', body: 'Use "Issue to employee" to hand it to someone.' }}
          columns={[
            { key: 'who', header: 'Holder', cell: (h) => <Link className="text-primary hover:underline" to={`/employees/${h.custodian_id}`}>{employeeName(ix, h.custodian_id)}</Link> },
            { key: 'dept', header: 'Department', minWidth: 'md', cell: (h) => departmentName(ix, h.department_id) || '—' },
            { key: 'issued', header: 'Issued', cell: (h) => formatDate(h.date_issued) },
            { key: 'returned', header: 'Returned', cell: (h) => formatDate(h.date_returned) },
            { key: 'days', header: 'Days held', align: 'right', cell: (h) => daysHeld(h, today) },
            { key: 'cond', header: 'Condition on return', minWidth: 'lg', cell: (h) => h.return_condition ?? '—' },
            { key: 'status', header: 'Record', cell: (h) => <StatusPill status={recordStatus(h)} /> },
            { key: 'check', header: 'Check', minWidth: 'md', cell: (h) => <CheckText text={assignmentCheck(ix, h)} /> },
          ]} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Gate passes for this device" padded={false}>
          <DataTable<Badge> rows={badges} rowKey={(b) => b.id} pageSize={10} empty={{ title: 'No gate pass issued' }}
            columns={[
              { key: 'code', header: 'Badge ID', cell: (b) => <Link className="code text-primary hover:underline" to={`/badges?q=${b.badge_code}`}>{b.badge_code}</Link> },
              { key: 'holder', header: 'Holder', cell: (b) => employeeName(ix, b.holder_id) },
              { key: 'issued', header: 'Issued', minWidth: 'sm', cell: (b) => formatDate(b.date_issued) },
              { key: 'validity', header: 'Validity', cell: (b) => <CheckText text={badgeValidity(b, today)} /> },
            ]} />
        </Card>
        <Card title="Accessories issued with this device" padded={false}>
          <DataTable<Accessory> rows={accessories} rowKey={(x) => x.id} pageSize={10} empty={{ title: 'None recorded' }}
            columns={[
              { key: 'what', header: 'Accessory', cell: (x) => `${x.accessory_type}${x.qty > 1 ? ` × ${x.qty}` : ''}` },
              { key: 'who', header: 'Employee', cell: (x) => employeeName(ix, x.employee_id) },
              { key: 'issued', header: 'Issued', minWidth: 'sm', cell: (x) => formatDate(x.date_issued) },
              { key: 'status', header: 'Status', cell: (x) => <StatusPill status={accessoryStatus(x)} /> },
            ]} />
        </Card>
      </div>

      <AssetFormModal open={modal === 'edit'} onClose={close} asset={a} />
      <IssueAssetModal open={modal === 'issue'} onClose={close} asset={a} />
      <ReturnAssetModal open={modal === 'return'} onClose={close} asset={a} />
      <StatusModal open={modal === 'repair'} onClose={close} asset={a} to="Under Repair" />
      <StatusModal open={modal === 'active'} onClose={close} asset={a} to="Active" />
      <IssueBadgeModal open={modal === 'badge'} onClose={close} ownership="Company-Owned" deviceId={a.id} />
    </>
  );
}
