import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { cx, EmptyState } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sort?: (row: T) => string | number | null | undefined;
  align?: 'right' | 'center';
  className?: string;
  /** Hide on small screens to keep the table readable on phones. */
  minWidth?: 'sm' | 'md' | 'lg';
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

export function DataTable<T>({ rows, columns, rowKey, onRowClick, initialSort, pageSize = 25, empty, rowClassName }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  pageSize?: number;
  empty: { title: string; body?: ReactNode };
  rowClassName?: (row: T) => string | undefined;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    const dir = sort!.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null || x === '') return 1;
      if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
    });
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => { if (page >= pages) setPage(0); }, [page, pages]);
  const visible = sorted.slice(page * pageSize, page * pageSize + pageSize);

  function toggle(key: string) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  if (!rows.length) return <EmptyState icon={Inbox} title={empty.title}>{empty.body}</EmptyState>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px] border-collapse">
          <thead>
            <tr className="bg-surface-2/70 text-left">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cx('px-3 py-2.5 font-semibold text-[12px] uppercase tracking-wide text-muted border-b border-line whitespace-nowrap',
                      c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.minWidth && HIDE[c.minWidth])}>
                    {c.sort ? (
                      <button onClick={() => toggle(c.key)} className={cx('inline-flex items-center gap-1 hover:text-ink uppercase', active && 'text-ink')}>
                        {c.header}
                        {active && (sort!.dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cx('border-b border-line/70 last:border-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-surface-2 focus:bg-surface-2 focus:outline-none', rowClassName?.(r))}>
                {columns.map((c) => (
                  <td key={c.key} className={cx('px-3 py-2.5 align-middle', c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center', c.minWidth && HIDE[c.minWidth], c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-line text-[13px] text-muted">
        <span>Showing {page * pageSize + 1}–{Math.min(sorted.length, (page + 1) * pageSize)} of {sorted.length}</span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded hover:bg-surface-2 disabled:opacity-40" onClick={() => setPage((p) => p - 1)}
              disabled={page === 0} aria-label="Previous page"><ChevronLeft className="size-4" /></button>
            <span className="px-1">Page {page + 1} of {pages}</span>
            <button className="p-1.5 rounded hover:bg-surface-2 disabled:opacity-40" onClick={() => setPage((p) => p + 1)}
              disabled={page >= pages - 1} aria-label="Next page"><ChevronRight className="size-4" /></button>
          </div>
        )}
      </div>
    </div>
  );
}
