/**
 * Data Fabric & Studio engine (SRD 5.A page `data`): the dataset registry and the data-quality check compiler.
 * Rules are stored as data (dataset, check type, column, params) and compiled to parameterised SQL here. Every
 * identifier comes from the registry below, never from user input, and is re-validated at run time, so a stored
 * rule cannot be turned into arbitrary SQL.
 */

export type ColType = 'text' | 'num' | 'date';
export interface Relation {
  col: string;
  refTable: string;
  refCol: string;
}
export interface Dataset {
  key: string;
  label: string;
  table: string;
  /// Business key shown against a failing record.
  keyCol: string;
  /// Extra row filter, always applied (alias `t`).
  base?: string;
  cols: Record<string, ColType>;
  relations: Record<string, Relation>;
  /// Freshness column (must be in `cols` as a date).
  freshCol: string;
}

export const DATASETS: Dataset[] = [
  { key: 'securities', label: 'Securities master', table: 'securities', keyCol: 'ticker', cols: { ticker: 'text', isin: 'text', name: 'text', market: 'text', asset_class: 'text', currency: 'text', sector: 'text', status: 'text', board_lot: 'num', average_daily_volume: 'num', updated_at: 'date' }, relations: {}, freshCol: 'updated_at' },
  { key: 'security_prices', label: 'Security prices', table: 'security_prices', keyCol: 'id', cols: { price: 'num', source: 'text', price_date: 'date', security_id: 'text' }, relations: { security: { col: 'security_id', refTable: 'securities', refCol: 'id' } }, freshCol: 'price_date' },
  { key: 'fx_rates', label: 'FX rates', table: 'fx_rates', keyCol: 'id', cols: { rate: 'num', rate_date: 'date', from_currency: 'text', to_currency: 'text', source: 'text' }, relations: {}, freshCol: 'rate_date' },
  { key: 'portfolio_positions', label: 'Portfolio positions', table: 'positions', keyCol: 'id', cols: { quantity: 'num', avg_cost: 'num', as_of: 'date', security_id: 'text', portfolio_id: 'text' }, relations: { security: { col: 'security_id', refTable: 'securities', refCol: 'id' }, portfolio: { col: 'portfolio_id', refTable: 'portfolios', refCol: 'id' } }, freshCol: 'as_of' },
  { key: 'portfolio_cash', label: 'Portfolio cash', table: 'portfolio_cash', keyCol: 'id', cols: { available: 'num', currency: 'text', as_of: 'date', portfolio_id: 'text' }, relations: { portfolio: { col: 'portfolio_id', refTable: 'portfolios', refCol: 'id' } }, freshCol: 'as_of' },
  { key: 'clients', label: 'Client register', table: 'clients', keyCol: 'ref', base: 't.archived_at IS NULL', cols: { name: 'text', email: 'text', phone: 'text', address: 'text', country: 'text', registration_ref: 'text', risk_rating: 'text', kyc_status: 'text', next_review_date: 'date', updated_at: 'date' }, relations: {}, freshCol: 'updated_at' },
  { key: 'orders', label: 'Orders', table: 'orders', keyCol: 'ref', cols: { quantity: 'num', limit_price: 'num', decision_price: 'num', avg_price: 'num', filled_qty: 'num', status: 'text', created_at: 'date', portfolio_id: 'text', security_id: 'text' }, relations: { security: { col: 'security_id', refTable: 'securities', refCol: 'id' }, portfolio: { col: 'portfolio_id', refTable: 'portfolios', refCol: 'id' } }, freshCol: 'created_at' },
  { key: 'nav_runs', label: 'NAV runs', table: 'nav_runs', keyCol: 'ref', cols: { nav: 'num', units: 'num', nav_per_unit: 'num', market_value: 'num', price_coverage: 'num', nav_date: 'date', portfolio_id: 'text' }, relations: { portfolio: { col: 'portfolio_id', refTable: 'portfolios', refCol: 'id' } }, freshCol: 'nav_date' },
  { key: 'funds', label: 'Funds', table: 'funds', keyCol: 'ref', cols: { name: 'text', currency: 'text', nav_per_unit: 'num', total_nav: 'num', as_of_date: 'date', status: 'text' }, relations: {}, freshCol: 'as_of_date' },
  { key: 'cash_journals', label: 'Cash journals', table: 'cash_journals', keyCol: 'ref', cols: { description: 'text', total_debit: 'num', total_credit: 'num', currency: 'text', entry_date: 'date', status: 'text', portfolio_id: 'text' }, relations: { portfolio: { col: 'portfolio_id', refTable: 'portfolios', refCol: 'id' } }, freshCol: 'entry_date' },
];
export const DATASET_MAP = new Map(DATASETS.map((d) => [d.key, d]));

export const CHECK_TYPES = ['NOT_NULL', 'UNIQUE', 'RANGE', 'FRESHNESS', 'ORPHAN'] as const;
export type CheckType = (typeof CHECK_TYPES)[number];
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const SOURCE_KINDS = ['TABLE', 'FILE_FEED', 'API', 'MANUAL'] as const;
export const CADENCES = ['MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'REALTIME'] as const;
export const EXCEPTION_LIMIT = 200;

export interface RuleSpec {
  dataset: string;
  checkType: string;
  col: string;
  params?: unknown;
}

/** Returns the problems with a rule definition (empty when it is valid). */
export function validateRule(r: RuleSpec): { path: string; message: string }[] {
  const errs: { path: string; message: string }[] = [];
  const ds = DATASET_MAP.get(r.dataset);
  if (!ds) return [{ path: 'dataset', message: 'Unknown dataset' }];
  if (!(CHECK_TYPES as readonly string[]).includes(r.checkType)) return [{ path: 'checkType', message: 'Unknown check type' }];
  const p = (r.params ?? {}) as Record<string, unknown>;
  if (r.checkType === 'ORPHAN') {
    const rel = ds.relations[String(p.relation ?? '')];
    if (!rel) errs.push({ path: 'params.relation', message: `Choose one of: ${Object.keys(ds.relations).join(', ') || 'none for this dataset'}` });
    else if (r.col !== rel.col) errs.push({ path: 'col', message: `This relation checks column ${rel.col}` });
    return errs;
  }
  const t = ds.cols[r.col];
  if (!t) return [{ path: 'col', message: `Unknown column; choose one of: ${Object.keys(ds.cols).join(', ')}` }];
  if (r.checkType === 'RANGE') {
    if (t !== 'num') errs.push({ path: 'col', message: 'A range check needs a numeric column' });
    const min = p.min === undefined || p.min === null || p.min === '' ? null : Number(p.min);
    const max = p.max === undefined || p.max === null || p.max === '' ? null : Number(p.max);
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) errs.push({ path: 'params', message: 'min and max must be numbers' });
    else if (min === null && max === null) errs.push({ path: 'params', message: 'Give a min, a max or both' });
    else if (min !== null && max !== null && min > max) errs.push({ path: 'params', message: 'min must not exceed max' });
  }
  if (r.checkType === 'FRESHNESS') {
    if (t !== 'date') errs.push({ path: 'col', message: 'A freshness check needs a date column' });
    const d = Number(p.maxAgeDays);
    if (!Number.isInteger(d) || d < 0 || d > 3650) errs.push({ path: 'params.maxAgeDays', message: 'Give a whole number of days (0 to 3650)' });
  }
  return errs;
}

export interface Compiled {
  /// Rows examined.
  countSql: string;
  /// Total failing rows.
  failCountSql: string;
  /// Up to EXCEPTION_LIMIT failing records: columns `k` (record key) and `d` (detail).
  failSql: string;
  params: unknown[];
  /// FRESHNESS is evaluated in code from MAX(col).
  freshness?: { sql: string; maxAgeDays: number };
}

const q = (id: string) => `\`${id}\``;

/** Compiles a validated rule to SQL. Throws if the rule is not valid against the registry. */
export function compile(r: RuleSpec): Compiled {
  const errs = validateRule(r);
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  const ds = DATASET_MAP.get(r.dataset)!;
  const p = (r.params ?? {}) as Record<string, unknown>;
  const from = `${q(ds.table)} t`;
  const where = ds.base ? `WHERE ${ds.base}` : '';
  const and = (c: string) => (ds.base ? `WHERE ${ds.base} AND ${c}` : `WHERE ${c}`);
  const key = `CAST(t.${q(ds.keyCol)} AS CHAR)`;
  const col = `t.${q(r.col)}`;
  const countSql = `SELECT COUNT(*) AS n FROM ${from} ${where}`;
  switch (r.checkType as CheckType) {
    case 'NOT_NULL': {
      const text = ds.cols[r.col] === 'text';
      const cond = text ? `(${col} IS NULL OR TRIM(${col}) = '')` : `${col} IS NULL`;
      return { countSql, failCountSql: `SELECT COUNT(*) AS n FROM ${from} ${and(cond)}`, failSql: `SELECT ${key} AS k, 'Missing ${r.col}' AS d FROM ${from} ${and(cond)} ORDER BY t.${q(ds.keyCol)} LIMIT ${EXCEPTION_LIMIT}`, params: [] };
    }
    case 'UNIQUE': {
      const nn = `${col} IS NOT NULL`;
      return {
        countSql,
        failCountSql: `SELECT COALESCE(SUM(c), 0) AS n FROM (SELECT COUNT(*) AS c FROM ${from} ${and(nn)} GROUP BY ${col} HAVING COUNT(*) > 1) x`,
        failSql: `SELECT CAST(${col} AS CHAR) AS k, CONCAT('Value appears ', COUNT(*), ' times') AS d FROM ${from} ${and(nn)} GROUP BY ${col} HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC LIMIT ${EXCEPTION_LIMIT}`,
        params: [],
      };
    }
    case 'RANGE': {
      const parts: string[] = [];
      const params: unknown[] = [];
      const min = p.min === undefined || p.min === null || p.min === '' ? null : Number(p.min);
      const max = p.max === undefined || p.max === null || p.max === '' ? null : Number(p.max);
      if (min !== null) {
        parts.push(`${col} < ?`);
        params.push(min);
      }
      if (max !== null) {
        parts.push(`${col} > ?`);
        params.push(max);
      }
      const cond = `${col} IS NOT NULL AND (${parts.join(' OR ')})`;
      return { countSql, failCountSql: `SELECT COUNT(*) AS n FROM ${from} ${and(cond)}`, failSql: `SELECT ${key} AS k, CONCAT('${r.col} = ', CAST(${col} AS CHAR), ' outside ${min ?? '-inf'}..${max ?? 'inf'}') AS d FROM ${from} ${and(cond)} ORDER BY t.${q(ds.keyCol)} LIMIT ${EXCEPTION_LIMIT}`, params };
    }
    case 'FRESHNESS':
      return { countSql, failCountSql: '', failSql: '', params: [], freshness: { sql: `SELECT MAX(${col}) AS m FROM ${from} ${where}`, maxAgeDays: Number(p.maxAgeDays) } };
    case 'ORPHAN': {
      const rel = ds.relations[String(p.relation)]!;
      const join = `FROM ${from} LEFT JOIN ${q(rel.refTable)} r ON r.${q(rel.refCol)} = ${col}`;
      const cond = `${col} IS NOT NULL AND r.${q(rel.refCol)} IS NULL`;
      return { countSql, failCountSql: `SELECT COUNT(*) AS n ${join} ${and(cond)}`, failSql: `SELECT ${key} AS k, CONCAT('${r.col} ', CAST(${col} AS CHAR), ' has no matching ${rel.refTable} row') AS d ${join} ${and(cond)} ORDER BY t.${q(ds.keyCol)} LIMIT ${EXCEPTION_LIMIT}`, params: [] };
    }
  }
}

export const ageDays = (latest: Date, now: Date) => Math.floor((now.getTime() - latest.getTime()) / 86_400_000);
