import { useMemo, useState, type ChangeEvent } from 'react';
import { CircleCheck, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react';
import { useData } from '../lib/data';
import { friendlyError, supabase } from '../lib/supabase';
import { planImport, readWorkbook, SHEETS, type Mapping, type SheetKey, type SheetReport, type WorkbookFile } from '../lib/workbook';
import { Button, Card, cx, Notice, PageHeader, Pill, Select } from '../components/ui';
import { useToast } from '../components/toast';

const MAX_BYTES = 15 * 1024 * 1024;

export function Import() {
  const { ds, reload } = useData();
  const toast = useToast();
  const [file, setFile] = useState<WorkbookFile | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Partial<Record<SheetKey, Mapping>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [open, setOpen] = useState<SheetKey | null>(null);

  const registerEmpty = ds.employees.length === 0 && ds.assets.length === 0 && ds.byod.length === 0 && ds.badges.length === 0
    && ds.accessories.length === 0 && ds.gateMovements.length === 0;
  const mode: 'full' | 'employees' = registerEmpty ? 'full' : 'employees';

  const plan = useMemo(() => (file ? planImport(file, mappings) : null), [file, mappings]);
  const reports = plan ? (mode === 'full' ? plan.reports : plan.reports.filter((r) => r.key === 'employees')) : [];
  const newEmployees = plan ? plan.payload.employees.filter((e) => !ds.employees.some((x) => x.full_name.trim().toLowerCase() === String(e.full_name).trim().toLowerCase())) : [];

  async function onFile(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    setFile(null); setReadError(null); setResult(null); setImportError(null); setConfirmed(false); setMappings({});
    if (!f) return;
    if (!/\.(xlsx|xlsm|xls)$/i.test(f.name)) { setReadError('Choose an Excel file (.xlsx, .xlsm or .xls).'); return; }
    if (f.size > MAX_BYTES) { setReadError('That file is larger than 15 MB. Is it the right workbook?'); return; }
    try {
      setFile(readWorkbook(await f.arrayBuffer(), f.name));
    } catch {
      setReadError('That file could not be read as an Excel workbook. If it is password-protected, save an unprotected copy first.');
    }
  }

  function remap(key: SheetKey, field: string, idx: number, report: SheetReport) {
    setMappings((m) => ({ ...m, [key]: { ...(m[key] ?? report.mapping), [field]: idx } }));
    setConfirmed(false);
  }

  async function runImport() {
    if (!plan) return;
    setBusy(true); setImportError(null);
    const { data, error } = mode === 'full'
      ? await supabase.rpc('import_workbook', { p: plan.payload })
      : await supabase.rpc('import_employees', { p: { file_name: plan.payload.file_name, employees: newEmployees } });
    setBusy(false);
    if (error) { setImportError(friendlyError(error)); return; }
    setResult(data as Record<string, unknown>);
    toast('ok', 'Import finished.');
    await reload();
  }

  const invalidTotal = reports.reduce((s, r) => s + r.invalid.length, 0);
  const missing = reports.filter((r) => r.missingColumns.length);
  const canRun = plan && !missing.length && (mode === 'full' ? plan.canImport : newEmployees.length > 0) && confirmed && !busy && !result;

  return (
    <>
      <PageHeader title="Import from Excel" description={result ? 'The import finished. The summary is below.' : mode === 'full'
        ? 'Bring the existing PASTI Asset Code Register workbook into the system. Nothing is saved until you confirm, and the import is all-or-nothing.'
        : 'The register already has records, so the full workbook import is closed (it never overwrites data). You can still add new employees from a spreadsheet.'} />

      {!result && <Card className="mb-4" title="1. Choose the workbook">
        <label className={cx('flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-line',
          'hover:border-primary/60 hover:bg-primary-soft cursor-pointer py-8 px-4 text-center transition-colors')}>
          <Upload className="size-6 text-muted" aria-hidden />
          <span className="font-medium">{file ? file.fileName : 'Click to choose an .xlsx file'}</span>
          <span className="text-[12.5px] text-muted">{mode === 'full' ? 'PASTI_Asset_Code_Register*.xlsx — every sheet is read.' : 'Any sheet with an "Employee Name" column.'}</span>
          <input type="file" accept=".xlsx,.xlsm,.xls" className="sr-only" onChange={(e) => void onFile(e)} />
        </label>
        {readError && <div className="mt-3"><Notice tone="danger">{readError}</Notice></div>}
      </Card>}

      {plan && !result && (
        <Card className="mb-4" title="2. Check the preview" description="Rows with problems are skipped and listed with their Excel row number. Fix them in Excel and choose the file again, or import without them." padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead><tr className="bg-surface-2/70 text-left text-[12px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Sheet</th><th className="px-4 py-2.5 text-right">Rows found</th><th className="px-4 py-2.5 text-right">Will import</th>
                <th className="px-4 py-2.5 text-right">Skipped</th><th className="px-4 py-2.5 text-right">Warnings</th><th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.key} className="border-t border-line/70 align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.label}</div>
                      {!r.sheetName && <div className="text-[12px] text-muted">Sheet not in this file — nothing to import</div>}
                      {r.missingColumns.length > 0 && <div className="text-[12px] text-danger">Missing columns: {r.missingColumns.join(', ')}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right">{r.total}</td>
                    <td className="px-4 py-2.5 text-right text-ok font-semibold">{mode === 'employees' ? newEmployees.length : r.valid}</td>
                    <td className={cx('px-4 py-2.5 text-right', r.invalid.length ? 'text-danger font-semibold' : 'text-muted')}>{r.invalid.length + (mode === 'employees' ? r.valid - newEmployees.length : 0)}</td>
                    <td className={cx('px-4 py-2.5 text-right', r.warnings.length ? 'text-warn' : 'text-muted')}>{r.warnings.length}</td>
                    <td className="px-4 py-2.5 text-right">
                      {r.sheetName && <button className="text-primary text-[13px] hover:underline" onClick={() => setOpen(open === r.key ? null : r.key)}>
                        {open === r.key ? 'Hide' : 'Columns & details'}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reports.filter((r) => r.key === open).map((r) => (
            <div key={r.key} className="border-t border-line p-5 grid lg:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-2">Column mapping — sheet “{r.sheetName}”</h3>
                <p className="text-[12.5px] text-muted mb-3">Matched by header name. Change one if your column is called something else.</p>
                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2.5">
                  {SHEETS.find((s) => s.key === r.key)!.fields.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1 text-[13px]">
                      <span className="text-ink-2">{f.label}{f.required && <span className="text-danger"> *</span>}</span>
                      <Select value={r.mapping[f.key] ?? -1} onChange={(e) => remap(r.key, f.key, Number(e.target.value), r)}
                        invalid={f.required && (r.mapping[f.key] ?? -1) < 0}>
                        <option value={-1}>— not in file —</option>
                        {r.headers.map((h, i) => h && <option key={i} value={i}>{h}</option>)}
                      </Select>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Row details</h3>
                {!r.invalid.length && !r.warnings.length ? <p className="text-muted text-[13px]">Every row is fine.</p> : (
                  <ul className="flex flex-col gap-1.5 text-[13px] max-h-80 overflow-y-auto pr-2">
                    {r.invalid.map((i) => <li key={'i' + i.row} className="flex gap-2"><Pill tone="danger">Row {i.row}</Pill><span>{i.message}</span></li>)}
                    {r.warnings.map((w, n) => <li key={'w' + n} className="flex gap-2"><Pill tone="warn">Row {w.row}</Pill><span className="text-ink-2">{w.message}</span></li>)}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {plan && !result && (
        <Card title="3. Import" className="mb-4">
          <div className="flex flex-col gap-3">
            {missing.length > 0 && <Notice tone="danger">Map the missing columns above before importing.</Notice>}
            {invalidTotal > 0 && <Notice tone="warn">{invalidTotal} row(s) will be skipped. Rows that depend on a skipped row (for example an asset whose custodian was skipped) are skipped too.</Notice>}
            {mode === 'full' ? (
              <p className="text-ink-2 text-[13.5px]">Asset Codes, BYOD codes and Badge IDs are kept exactly as they are in the workbook, and new codes continue after the highest
                number already used. Calculated columns (alerts, validity, form status, clearance) are recalculated by the system.</p>
            ) : (
              <p className="text-ink-2 text-[13.5px]">{newEmployees.length} new employee(s) will be added. Names already on the list are skipped, never overwritten.</p>
            )}
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 accent-[var(--color-primary)] size-4" />
              I have checked the preview and want to import these records.
            </label>
            {importError && <Notice tone="danger">Nothing was imported. {importError}</Notice>}
            <div><Button variant="primary" icon={FileSpreadsheet} onClick={() => void runImport()} disabled={!canRun} loading={busy}>
              {mode === 'full' ? 'Import workbook' : `Add ${newEmployees.length} employee(s)`}</Button></div>
          </div>
        </Card>
      )}

      {result && (
        <Card title="Import complete">
          <div className="flex items-start gap-3">
            <CircleCheck className="size-6 text-ok shrink-0" aria-hidden />
            <div className="text-[13.5px]">
              <p className="mb-2">These records are now in the system:</p>
              <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
                {Object.entries(result).filter(([k]) => k !== 'skipped').map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-4"><span className="text-muted capitalize">{k.replace(/_/g, ' ')}</span><b>{String(v)}</b></li>
                ))}
              </ul>
              <p className="mt-3 text-muted">Open the Dashboard to see what needs attention. The import is recorded in the Activity Log.</p>
            </div>
          </div>
        </Card>
      )}

      {!plan && mode === 'full' && (
        <Notice tone="info"><span className="inline-flex items-center gap-1.5"><TriangleAlert className="size-4 text-warn" /> Do this once, before anyone starts encoding in the web app.</span>
          {' '}After the first import, this page only adds employees.</Notice>
      )}
    </>
  );
}
