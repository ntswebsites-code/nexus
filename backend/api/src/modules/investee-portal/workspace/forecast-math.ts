/**
 * Forecast arithmetic (BR-263, BR-209). Pure functions: the same code serves the working view, the submitted
 * snapshot and the tests. Amounts are plain numbers rounded to 2 decimals at the output boundary only.
 *
 *   total revenue   = merchant + enterprise + other (when any component is given, else the stored `revenue` total)
 *   gross profit    = total revenue - processing costs - support/fraud losses
 *   EBITDA          = gross profit - sales & marketing - product & engineering - general & admin
 *   EBITDA margin   = EBITDA / max(total revenue, 1) as a percentage
 *   operating cash  = the stated figure, else EBITDA
 *   closing cash    = opening + operating cash - capex + financing
 *   opening cash    = the seed for the first forecast month, then the previous month's closing cash (BR-209)
 *   liquidity room  = closing cash - minimum cash
 *   annual column   = sum for flows, opening of the first month and closing of the last month for balances
 */
export const FORECAST_METRICS = [
  'revenue',
  'merchantRevenue',
  'enterpriseRevenue',
  'otherRevenue',
  'processingCosts',
  'supportLosses',
  'salesMarketing',
  'productEngineering',
  'generalAdmin',
  'operatingCash',
  'capex',
  'financing',
  'openingCash',
  'minimumCash',
] as const;
export type ForecastMetric = (typeof FORECAST_METRICS)[number];

/** Metrics that may legitimately be negative (cash movements and balances). */
export const SIGNED_METRICS: ReadonlySet<ForecastMetric> = new Set(['operatingCash', 'financing', 'openingCash']);

export type ForecastCells = Partial<Record<ForecastMetric, Record<string, number>>>;

export interface ForecastMonth {
  totalRevenue: number;
  grossProfit: number;
  ebitda: number;
  ebitdaMargin: number;
  openingCash: number;
  operatingCash: number;
  capex: number;
  financing: number;
  closingCash: number;
  minimumCash: number;
  liquidityHeadroom: number;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function computeForecast(months: string[], cells: ForecastCells, openingSeed = 0) {
  const get = (metric: ForecastMetric, period: string) => cells[metric]?.[period];
  const rows: Record<string, ForecastMonth> = {};
  let carry = openingSeed;
  let first = true;
  for (const period of [...months].sort()) {
    const parts = (['merchantRevenue', 'enterpriseRevenue', 'otherRevenue'] as const).map((m) => get(m, period));
    const totalRevenue = parts.some((v) => v !== undefined) ? parts.reduce<number>((s, v) => s + (v ?? 0), 0) : (get('revenue', period) ?? 0);
    const grossProfit = totalRevenue - (get('processingCosts', period) ?? 0) - (get('supportLosses', period) ?? 0);
    const ebitda = grossProfit - (get('salesMarketing', period) ?? 0) - (get('productEngineering', period) ?? 0) - (get('generalAdmin', period) ?? 0);
    const openingCash = first ? (get('openingCash', period) ?? openingSeed) : carry;
    const operatingCash = get('operatingCash', period) ?? ebitda;
    const capex = get('capex', period) ?? 0;
    const financing = get('financing', period) ?? 0;
    const closingCash = openingCash + operatingCash - capex + financing;
    const minimumCash = get('minimumCash', period) ?? 0;
    rows[period] = {
      totalRevenue: r2(totalRevenue),
      grossProfit: r2(grossProfit),
      ebitda: r2(ebitda),
      ebitdaMargin: r2((ebitda / Math.max(totalRevenue, 1)) * 100),
      openingCash: r2(openingCash),
      operatingCash: r2(operatingCash),
      capex: r2(capex),
      financing: r2(financing),
      closingCash: r2(closingCash),
      minimumCash: r2(minimumCash),
      liquidityHeadroom: r2(closingCash - minimumCash),
    };
    carry = closingCash;
    first = false;
  }
  const periods = Object.keys(rows).sort();
  const sum = (key: keyof ForecastMonth) => r2(periods.reduce((s, p) => s + rows[p]![key], 0));
  const lastRow = periods.length ? rows[periods[periods.length - 1]!]! : undefined;
  const totalRevenue = sum('totalRevenue');
  const ebitda = sum('ebitda');
  const annual: ForecastMonth = {
    totalRevenue,
    grossProfit: sum('grossProfit'),
    ebitda,
    ebitdaMargin: r2((ebitda / Math.max(totalRevenue, 1)) * 100),
    openingCash: periods.length ? rows[periods[0]!]!.openingCash : r2(openingSeed),
    operatingCash: sum('operatingCash'),
    capex: sum('capex'),
    financing: sum('financing'),
    closingCash: lastRow?.closingCash ?? r2(openingSeed),
    minimumCash: lastRow?.minimumCash ?? 0,
    liquidityHeadroom: lastRow?.liquidityHeadroom ?? r2(openingSeed),
  };
  return { rows, annual };
}
