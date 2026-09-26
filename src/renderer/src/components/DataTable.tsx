import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import { Button } from './ui/button';
import { Skeleton } from './ui/display';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  sortKey?: string;
  className?: string;
  headerClassName?: string;
  footer?: ReactNode;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  onRowClick,
  empty,
  sort,
  onSort,
  selectedKey,
  className,
  dense,
  showFooter,
  rowClassName,
  maxHeight,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  sort?: SortState;
  onSort?: (s: SortState) => void;
  selectedKey?: string | number | null;
  className?: string;
  dense?: boolean;
  showFooter?: boolean;
  rowClassName?: (row: T) => string | undefined;
  maxHeight?: string;
}) {
  const align = (a?: string) => (a === 'right' ? 'text-end' : a === 'center' ? 'text-center' : 'text-start');
  const cellPad = dense ? 'px-3 py-2' : 'px-4 py-[11px]';
  const showSkeleton = loading && (!rows || rows.length === 0);
  return (
    <div className={cn('relative overflow-auto', className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((c) => {
              const active = sort && c.sortKey && sort.key === c.sortKey;
              return (
                <th
                  key={c.key}
                  style={{ width: c.width }}
                  className={cn(
                    'whitespace-nowrap border-b border-border bg-subtle/95 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground backdrop-blur',
                    dense && 'px-3',
                    align(c.align),
                    c.headerClassName,
                  )}
                >
                  {c.sortKey && onSort ? (
                    <button
                      type="button"
                      className={cn('inline-flex items-center gap-1 uppercase tracking-[0.06em] transition hover:text-foreground', active && 'text-foreground', c.align === 'right' && 'flex-row-reverse')}
                      onClick={() => onSort({ key: c.sortKey!, dir: active && sort!.dir === 'asc' ? 'desc' : 'asc' })}
                    >
                      {c.header}
                      {active ? sort!.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-50" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {showSkeleton &&
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={`sk${i}`}>
                {columns.map((c) => (
                  <td key={c.key} className={cn(cellPad, 'border-b border-border/70')}>
                    <Skeleton className={cn('h-3.5', c.align === 'right' ? 'ms-auto w-16' : 'w-3/4')} />
                  </td>
                ))}
              </tr>
            ))}
          {!showSkeleton &&
            rows?.map((row, i) => {
              const k = rowKey(row);
              return (
                <tr
                  key={k}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('group transition-colors', onRowClick && 'cursor-pointer', selectedKey === k ? 'bg-primary-soft/60' : 'hover:bg-subtle', rowClassName?.(row))}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn(cellPad, 'border-b border-border/70 align-middle', align(c.align), c.align === 'right' && 'num whitespace-nowrap', c.className)}>
                      {c.cell(row, i)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
        {showFooter && rows && rows.length > 0 && (
          <tfoot className="sticky bottom-0">
            <tr>
              {columns.map((c) => (
                <td key={c.key} className={cn(cellPad, 'num border-t border-border bg-subtle/95 font-semibold backdrop-blur', align(c.align))}>
                  {c.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {!loading && rows && rows.length === 0 && empty}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage, className }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; className?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={cn('flex items-center justify-between gap-4 border-t border-border px-4 py-2.5 text-[12.5px] text-muted-foreground', className)}>
      <span className="num">
        {total === 0 ? 'No records' : (
          <>
            Showing <b className="font-semibold text-foreground">{from.toLocaleString()}–{to.toLocaleString()}</b> of <b className="font-semibold text-foreground">{total.toLocaleString()}</b>
          </>
        )}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="num me-2">
          Page {page} of {pages}
        </span>
        <Button size="icon-sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
