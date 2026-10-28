// Excel export. SheetJS is loaded only when someone actually exports.

export interface ExportColumn<T> { header: string; value: (row: T) => string | number | null | undefined; width?: number }

// A cell starting with one of these could run as a formula when opened in Excel.
const FORMULA_START = /^[=+\-@\t\r]/;

export async function exportRows<T>(fileName: string, sheetName: string, columns: ExportColumn<T>[], rows: T[]): Promise<void> {
  const XLSX = await import('xlsx');
  const data = [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => {
    const v = c.value(r);
    return typeof v === 'string' && FORMULA_START.test(v) ? `'${v}` : v ?? '';
  }))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = columns.map((c) => ({ wch: c.width ?? Math.max(10, c.header.length + 2) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: columns.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName, { compression: true });
}
