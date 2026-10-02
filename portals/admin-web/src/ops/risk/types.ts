/** Wire types for `/api/v1/risk/*` (see backend/api/src/modules/risk). Decimals are strings. */

export type RiskMetric = 'SINGLE_NAME_PCT' | 'SECTOR_PCT' | 'CASH_FLOOR_PCT' | 'TOP5_PCT';

export const METRICS: { key: RiskMetric; label: string; short: string; floor: boolean }[] = [
  { key: 'SINGLE_NAME_PCT', label: 'Single-name concentration (max weight of any security)', short: 'Single name', floor: false },
  { key: 'SECTOR_PCT', label: 'Sector concentration (max weight of any sector)', short: 'Sector', floor: false },
  { key: 'CASH_FLOOR_PCT', label: 'Cash floor (minimum cash weight)', short: 'Cash floor', floor: true },
  { key: 'TOP5_PCT', label: 'Top-5 concentration (five largest securities combined)', short: 'Top 5', floor: false },
];
export const metricShort = (m: string) => METRICS.find((x) => x.key === m)?.short ?? m;
export const isFloor = (m: string) => m === 'CASH_FLOOR_PCT';

export interface RiskLimit {
  id: string;
  ref: string;
  metric: RiskMetric;
  scopeType: 'PORTFOLIO' | 'FIRM';
  scopeId: string | null;
  scopeName: string | null;
  scopeRef: string | null;
  threshold: string;
  breachAction: 'ALERT' | 'ESCALATE' | 'BLOCK';
  description: string | null;
  ownerUserId: string;
  ownerName: string | null;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'RETIRED';
  makerId: string;
  makerName: string | null;
  checkerId: string | null;
  checkerName: string | null;
  approvedAt: string | null;
  version: number;
}

export interface RiskBreach {
  id: string;
  limitId: string;
  limitRef: string;
  metric: RiskMetric;
  portfolioId: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  detectedOn: string;
  value: string;
  threshold: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  caseId: string | null;
  caseRef: string | null;
  caseStatus: string | null;
  ackByName: string | null;
  ackAt: string | null;
  ackNote: string | null;
}

export interface Shocks {
  equityPct: number;
  fxPct: number;
  ratePctPoints: number;
  durationYears: number;
  redemptionPct: number;
}

export interface Preset {
  key: 'liquidity' | 'equity' | 'fx';
  name: string;
  description: string;
  shocks: Shocks;
}

export interface RiskScenario {
  id: string;
  name: string;
  shocks: Shocks;
  preset: string | null;
  createdByName: string | null;
  runCount: number;
}

export type ScenarioStatus = 'Escalate' | 'Review' | 'Within';

export interface ScenarioResult {
  asOf: string;
  baseCurrency: string;
  shocks: Shocks;
  nav: string;
  postShockValue: string;
  loss: string;
  lossPct: string;
  impacts: { equity: string; rate: string; fx: string };
  notes: string[];
  liquidity: { liquidAssets: string; redemptionAmount: string; coverage: string | null; status: ScenarioStatus };
  limitChecks: { ref: string; metric: RiskMetric; threshold: string; value: string; state: 'BREACH' | 'WARNING' | 'OK'; breachAction: string }[];
  status: ScenarioStatus;
  reasons: string[];
  warnings: string[];
}

export interface RiskRun {
  id: string;
  scenarioId: string;
  scenarioName: string;
  portfolioId: string;
  portfolioName: string | null;
  asOf: string;
  results: ScenarioResult;
  runByName: string | null;
  createdAt: string;
}

export interface RiskCase {
  id: string;
  ref: string;
  type: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED';
  ownerUserId: string | null;
  ownerName: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  sourceBreachId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  version: number;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string;
}

export interface MonitorSummary {
  detectedOn: string;
  portfoliosChecked: number;
  limitsEvaluated: number;
  newBreaches: { caseRef: string; limitRef: string; portfolioRef: string; severity: string }[];
  alreadyRecorded: number;
  warnings: number;
}
