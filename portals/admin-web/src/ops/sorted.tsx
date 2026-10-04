'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Empty } from './ui';

export type SortValue = string | number | null | undefined;
type Dir = 'asc' | 'desc';

/**
 * Search, column sort and the "No records" empty state for a table (FR-CASH-019). The children render the table from
 * the filtered and sorted rows and build each sortable header with `th(key, label, className?)`: a button with
 * `aria-sort` on the header cell, cycling ascending, descending, then the server order.
 * Sorting is done on the rows already loaded, so it never changes what a server filter returned.
 */
export function Sorted<T>({
  rows,
  getters,
  searchText,
  what,
  children,
}: {
  rows: T[];
  getters: Record<string, (r: T) => SortValue>;
  searchText?: (r: T) => string;
  what: string;
  children: (rows: T[], th: (key: string, label: string, className?: string) => ReactNode) => ReactNode;
}) {
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(needle)) : rows;
    const get = sort ? getters[sort.key] : undefined;
    if (sort && get) {
      const sign = sort.dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = get(a);
        const y = get(b);
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return typeof x === 'number' && typeof y === 'number' ? (x - y) * sign : String(x).localeCompare(String(y)) * sign;
      });
    }
    return out;
  }, [rows, q, sort, getters, searchText]);

  const th = (key: string, label: string, className?: string): ReactNode => {
    const active = sort?.key === key ? sort.dir : null;
    return (
      <th key={key} className={className} aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}>
        <button className="ops-sortbtn" type="button" onClick={() => setSort(active === null ? { key, dir: 'asc' } : active === 'asc' ? { key, dir: 'desc' } : null)}>
          {label}
          <span aria-hidden="true">{active === 'asc' ? ' ▲' : active === 'desc' ? ' ▼' : ''}</span>
        </button>
      </th>
    );
  };

  return (
    <>
      {searchText && (
        <div className="ops-filters">
          <label className="ops-field">
            <span className="ops-label">Search</span>
            <input className="ops-input" type="search" aria-label={`Search ${what}`} placeholder={`Search ${what}`} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      )}
      {shown.length === 0 ? <Empty>No records{q.trim() ? ` match "${q.trim()}"` : ''}.</Empty> : children(shown, th)}
    </>
  );
}
