import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, PencilLine, Printer, Trash2 } from 'lucide-react';
import { logEvent, useData } from '../lib/data';
import { useAuth } from '../lib/auth';
import { friendlyError, supabase } from '../lib/supabase';
import { assetActiveBadge, byodActiveBadge, departmentName, deviceTypeName, employeeStats, signedMark, type Index } from '../lib/rules';
import { formatDate, todayISO } from '../lib/dates';
import type { Employee } from '../lib/types';
import { EmployeeFormModal, FormSignedModal } from '../components/employeeModals';
import { FormModal } from '../components/Modal';
import { Button, Card, CheckList, CheckText, Details, EmptyState, Pill, StatusPill } from '../components/ui';
import { useToast } from '../components/toast';

/** Everything for the Employee IT Accountability Form (workbook "Employee Summary"). */
function formData(ix: Index, e: Employee) {
  const devices = ix.ds.assets
    .filter((a) => a.custodian_id === e.id && (a.status === 'Active' || a.status === 'Under Repair'))
    .map((a) => {
      const open = (ix.assignmentsByAsset.get(a.id) ?? []).filter((h) => h.custodian_id === e.id && !h.date_returned).at(-1);
      const badge = assetActiveBadge(ix, a);
      return { a, dateIssued: open?.date_issued ?? null, badge: badge.startsWith('PASTI') ? badge : '' };
    })
    .sort((x, y) => x.a.asset_code.localeCompare(y.a.asset_code));
  const accessories = ix.ds.accessories.filter((x) => x.employee_id === e.id && !x.date_returned)
    .sort((x, y) => x.date_issued.localeCompare(y.date_issued));
  const byod = ix.ds.byod.filter((d) => d.owner_id === e.id && d.status === 'Active');
  return { devices, accessories, byod };
}

const SignedCell = ({ mark }: { mark: string }) =>
  mark === 'NEW' ? <Pill tone="warn">NEW</Pill> : mark === 'Yes' ? <span className="text-ok">Yes</span> : <span className="text-muted">—</span>;

export function EmployeeDetail() {
  const { id } = useParams();
  const { ix, reload } = useData();
  const { canEdit, isAdmin } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [modal, setModal] = useState<null | 'edit' | 'signed' | 'delete'>(null);
  const e = id ? ix.employee.get(id) : undefined;
  if (!e) return <Card><EmptyState title="Employee not found"><Link className="text-primary hover:underline" to="/employees">Back to Employees</Link></EmptyState></Card>;

  const st = employeeStats(ix, e);
  const { devices, accessories, byod } = formData(ix, e);
  const history = ix.ds.assignments.filter((h) => h.custodian_id === e.id).sort((x, y) => y.date_issued.localeCompare(x.date_issued));
  const referenced = history.length > 0 || ix.ds.accessories.some((x) => x.employee_id === e.id) || ix.ds.byod.some((d) => d.owner_id === e.id)
    || ix.ds.badges.some((b) => b.holder_id === e.id);

  async function print() {
    await logEvent('PRINT', `Accountability form – ${e!.full_name}`, { devices: devices.length, accessories: accessories.length, byod: byod.length });
    window.print();
  }

  async function remove(): Promise<string | null> {
    const { error } = await supabase.from('employees').delete().eq('id', e!.id);
    if (error) return friendlyError(error);
    toast('ok', `${e!.full_name} was removed. A copy is kept in the recycle bin.`);
    await reload();
    nav('/employees');
    return null;
  }

  return (
    <>
      <div className="no-print">
        <Link to="/employees" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft className="size-4" />Employees</Link>
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-bold">{e.full_name}</h1><StatusPill status={e.employment_status} /></div>
            <p className="text-ink-2 mt-1">{[e.position, departmentName(ix, e.department_id), e.employee_no && `ID ${e.employee_no}`].filter(Boolean).join(' · ') || 'No position or department yet'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={Printer} variant="primary" onClick={() => void print()}>Print accountability form</Button>
            {canEdit && <Button icon={ClipboardCheck} onClick={() => setModal('signed')}>Record signed form</Button>}
            {canEdit && <Button icon={PencilLine} variant="ghost" onClick={() => setModal('edit')}>Edit</Button>}
            {isAdmin && !referenced && <Button icon={Trash2} variant="ghost" onClick={() => setModal('delete')}>Delete</Button>}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <Card title="Status" className="lg:col-span-1">
            <dl className="flex flex-col gap-3 text-[13.5px]">
              <div className="flex justify-between gap-3"><dt className="text-muted">Devices held</dt><dd className="font-semibold">{st.devicesHeld}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Accessories held</dt><dd className="font-semibold">{st.accessoriesHeld}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Active gate passes</dt><dd className="font-semibold">{st.activeBadges}</dd></div>
              <div><dt className="text-muted mb-1">Form status</dt><dd><CheckText text={st.formStatus} /></dd></div>
              {e.employment_status === 'Resigned/Separated' && <div><dt className="text-muted mb-1">Exit clearance</dt><dd><CheckText text={st.exitClearance} /></dd></div>}
              {st.checks.length > 0 && <div><dt className="text-muted mb-1">Check</dt><dd><CheckList items={st.checks} /></dd></div>}
            </dl>
          </Card>
          <Card title="Details" className="lg:col-span-2">
            <Details items={[['Employee ID', e.employee_no], ['Department', departmentName(ix, e.department_id)], ['Position', e.position],
              ['Employment status', e.employment_status], ['Date separated', e.date_separated && formatDate(e.date_separated)],
              ['Last form signed', e.last_form_signed ? formatDate(e.last_form_signed) : 'Never'], ['Remarks', e.remarks]]} />
          </Card>
        </div>

        <p className="text-[13px] text-muted mb-2">Signing workflow: print this form, have {e.full_name} sign it, then click “Record signed form”.
          Items issued after the last signed date show <Pill tone="warn">NEW</Pill>.</p>
      </div>

      <AccountabilityForm e={e} ix={ix} devices={devices} accessories={accessories} byod={byod} />

      {history.length > 0 && (
        <Card title="Assignment history" description="Every asset this person has held." className="no-print mt-4" padded={false}>
          <ul className="divide-y divide-line/70">
            {history.map((h) => {
              const a = ix.asset.get(h.asset_id);
              return (
                <li key={h.id} className="px-5 py-2.5 flex flex-wrap gap-x-4 gap-y-1 items-center text-[13.5px]">
                  <Link to={`/assets/${h.asset_id}`} className="code text-primary hover:underline w-44">{a?.asset_code}</Link>
                  <span className="text-ink-2 flex-1 min-w-40">{a?.brand_model}</span>
                  <span className="text-muted">{formatDate(h.date_issued)} → {h.date_returned ? formatDate(h.date_returned) : 'now'}</span>
                  <StatusPill status={h.date_returned ? 'Returned' : 'Current Holder'} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <EmployeeFormModal open={modal === 'edit'} onClose={() => setModal(null)} employee={e} />
      <FormSignedModal open={modal === 'signed'} onClose={() => setModal(null)} employee={e} />
      <FormModal open={modal === 'delete'} onClose={() => setModal(null)} onSubmit={remove} danger submitLabel="Delete employee"
        title={`Delete ${e.full_name}?`} description="Only possible for someone who never held anything. A copy is kept in the recycle bin.">
        <p className="text-ink-2">If this person left the company, set their status to Resigned/Separated instead — that keeps their history.</p>
      </FormModal>
    </>
  );
}

/** Screen view in the app theme; prints on white A4 with signature lines. */
function AccountabilityForm({ e, ix, devices, accessories, byod }: {
  e: Employee; ix: Index; devices: ReturnType<typeof formData>['devices'];
  accessories: ReturnType<typeof formData>['accessories']; byod: ReturnType<typeof formData>['byod'];
}) {
  const th = 'text-left font-semibold text-[11.5px] uppercase tracking-wide text-muted print:text-black px-2 py-1.5 border-b border-line print:border-black';
  const td = 'px-2 py-1.5 border-b border-line/70 print:border-gray-400 align-top';
  const section = (title: string) => <h3 className="font-bold text-[13px] mt-5 mb-1.5 print:text-black">{title}</h3>;
  const none = (cols: number, text: string) => <tr><td colSpan={cols} className={`${td} text-muted print:text-gray-600`}>{text}</td></tr>;
  return (
    <section className="card p-6 print:!p-0 print:!border-0 print:!shadow-none print:!bg-white print:text-black text-[13px]" aria-label="Accountability form">
      <header className="text-center mb-4">
        <h2 className="text-[16px] font-extrabold tracking-wide">EMPLOYEE IT ACCOUNTABILITY FORM</h2>
        <p className="text-muted print:text-black text-[12px]">Philippine Aurion Solar Technologies, Inc. — IT, HR and Admin Department</p>
      </header>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1">
        <div><span className="text-muted print:text-black">Employee:</span> <b>{e.full_name}</b></div>
        <div><span className="text-muted print:text-black">Date:</span> {formatDate(todayISO())}</div>
        <div><span className="text-muted print:text-black">Employee ID:</span> {e.employee_no ?? ''}</div>
        <div><span className="text-muted print:text-black">Status:</span> {e.employment_status}</div>
        <div><span className="text-muted print:text-black">Department:</span> {departmentName(ix, e.department_id)}</div>
        <div><span className="text-muted print:text-black">Position:</span> {e.position ?? ''}</div>
      </div>

      {section('A.  COMPANY DEVICES HELD')}
      <div className="overflow-x-auto"><table className="w-full border-collapse">
        <thead><tr><th className={th}>#</th><th className={th}>Asset Code</th><th className={th}>Device Type</th><th className={th}>Brand / Model</th>
          <th className={th}>Serial Number</th><th className={th}>Date Issued</th><th className={th}>Gate Pass (Badge ID)</th><th className={th}>Signed?</th></tr></thead>
        <tbody>{devices.length ? devices.map(({ a, dateIssued, badge }, i) => (
          <tr key={a.id}><td className={td}>{i + 1}</td><td className={`${td} code`}>{a.asset_code}</td><td className={td}>{deviceTypeName(ix, a.device_type_id)}</td>
            <td className={td}>{a.brand_model}</td><td className={`${td} code`}>{a.serial_number}</td><td className={td}>{formatDate(dateIssued)}</td>
            <td className={`${td} code`}>{badge}</td><td className={td}><SignedCell mark={signedMark(e, dateIssued)} /></td></tr>
        )) : none(8, 'No company devices held.')}</tbody>
      </table></div>

      {section('B.  ACCESSORIES HELD')}
      <div className="overflow-x-auto"><table className="w-full border-collapse">
        <thead><tr><th className={th}>#</th><th className={th}>Accessory</th><th className={th}>Brand / Model</th><th className={th}>Serial / Tag</th>
          <th className={th}>For Device</th><th className={th}>Date Issued</th><th className={th}>Qty</th><th className={th}>Signed?</th></tr></thead>
        <tbody>{accessories.length ? accessories.map((x, i) => (
          <tr key={x.id}><td className={td}>{i + 1}</td><td className={td}>{x.accessory_type}</td><td className={td}>{x.brand_model}</td>
            <td className={td}>{x.serial_tag}</td><td className={`${td} code`}>{x.for_asset_id ? ix.asset.get(x.for_asset_id)?.asset_code : ''}</td>
            <td className={td}>{formatDate(x.date_issued)}</td><td className={td}>{x.qty}</td><td className={td}><SignedCell mark={signedMark(e, x.date_issued)} /></td></tr>
        )) : none(8, 'No accessories held.')}</tbody>
      </table></div>

      {section('C.  PERSONAL DEVICES REGISTERED (BYOD)')}
      <div className="overflow-x-auto"><table className="w-full border-collapse">
        <thead><tr><th className={th}>#</th><th className={th}>BYOD Code</th><th className={th}>Device Type</th><th className={th}>Brand / Model</th>
          <th className={th}>Serial Number</th><th className={th}>Date Registered</th><th className={th}>Gate Pass (Badge ID)</th><th className={th}>Consent Signed?</th></tr></thead>
        <tbody>{byod.length ? byod.map((d, i) => {
          const b = byodActiveBadge(ix, d);
          return (
            <tr key={d.id}><td className={td}>{i + 1}</td><td className={`${td} code`}>{d.byod_code}</td><td className={td}>{deviceTypeName(ix, d.device_type_id)}</td>
              <td className={td}>{d.brand_model}</td><td className={`${td} code`}>{d.serial_number}</td><td className={td}>{formatDate(d.date_registered)}</td>
              <td className={`${td} code`}>{b.startsWith('PASTI') ? b : ''}</td><td className={td}>{d.consent_signed == null ? '' : d.consent_signed ? 'Yes' : 'No'}</td></tr>
          );
        }) : none(8, 'No personal devices registered.')}</tbody>
      </table></div>

      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-2 print:text-black">
        I acknowledge that I have received the company IT equipment and accessories listed above in good working condition. I will use them for company
        purposes, keep them safe, report any loss or damage to IT immediately, and return all items to IT upon request, transfer, or separation from the company.
      </p>
      <div className="grid grid-cols-2 gap-12 mt-12 text-[12.5px]">
        <div><div className="border-t border-line-strong print:border-black pt-1"><b>{e.full_name}</b></div><div className="text-muted print:text-black">Signature over printed name / Date</div></div>
        <div><div className="border-t border-line-strong print:border-black pt-1"><b>Issued by: IT Department</b></div><div className="text-muted print:text-black">Signature over printed name / Date</div></div>
      </div>
      <div className="mt-10 text-[12.5px] w-1/2"><div className="border-t border-line-strong print:border-black pt-1"><b>Noted by: HR and Admin Department</b></div>
        <div className="text-muted print:text-black">Signature over printed name / Date</div></div>
    </section>
  );
}
