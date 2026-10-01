import { InvesteeApiError, type InvesteeActionKey, type InvesteeApi } from './api';
import type {
  FinancialReportDraftRequest,
  FinancialStatementKind,
  InvesteeCompany,
  InvesteeLivePayload,
  TermSheet,
  UpdateCompanyRequest,
  UpdateLetterheadRequest,
  UpdateProfileRequest,
} from './types';

/** The bridge the runtime exposes on `window.MatanhoInvesteeUI`. */
export interface InvesteeRuntimeUI {
  hydrate?: (payload: unknown) => void;
  setLivePages?: (pages: string[] | null) => void;
  openSignature?: (id: string) => void;
  showReportDetail?: (report: unknown) => void;
  notify?: (title: string, message?: string, type?: 'success' | 'error' | 'danger' | 'info') => void;
  closeOverlays?: () => void;
}

declare global {
  interface Window {
    MatanhoInvesteeUI?: InvesteeRuntimeUI;
  }
}

/**
 * Runtime page -> loader keys it renders from. A page is live only when every key is allowlisted;
 * every other page keeps its fixture and the "Demo data" ribbon.
 */
export const LIVE_PAGE_LOADERS: Record<string, InvesteeActionKey[]> = {
  dashboard: ['dashboard'],
  kpis: ['company'],
  reports: ['reports.schedule', 'reports.history'],
  forecasts: ['forecast'],
  terms: ['termSheets.list'],
  'cap-table': ['capTable'],
  governance: ['governance'],
  signatures: ['termSheets.list'],
  requests: ['requests.list'],
  'data-room': ['vault'],
  messages: ['threads.list'],
  team: ['team.list'],
  settings: ['profile', 'company'],
};

export function livePagesFor(api: InvesteeApi): string[] {
  return Object.entries(LIVE_PAGE_LOADERS)
    .filter(([, keys]) => keys.every((k) => api.isLive(k)))
    .map(([page]) => page);
}

export interface ActionDetail {
  action?: string;
  dataset?: Record<string, string>;
  report?: {
    type?: string;
    period?: number;
    owner?: string;
    values?: Record<string, unknown>;
    notes?: Record<string, unknown>;
  };
  request?: {
    title?: string;
    description?: string;
    type?: string;
    category?: string;
    currency?: string;
    amount?: number;
    needBy?: string;
    priority?: string;
  };
}

export interface ActionResult {
  message?: string;
  detail?: string;
  error?: string;
}

const LOADERS = [
  'dashboard',
  'profile',
  'company',
  'reports.schedule',
  'reports.history',
  'termSheets.list',
  'forecast',
  'capTable',
  'governance',
  'requests.list',
  'vault',
  'application',
  'threads.list',
  'team.list',
] as const;

function errorText(e: unknown): string {
  if (e instanceof InvesteeApiError) return e.describe();
  return e instanceof Error ? e.message : String(e);
}

/**
 * GET /term-sheets/my nests signatures under `applicantSignature`/`investorSignature`; the runtime
 * reads flat `applicantSignedAt`/`applicantSignatureUrl`. Flatten both shapes.
 */
function normalizeTermSheet(ts: TermSheet): TermSheet {
  const a = ts.applicantSignature;
  const i = ts.investorSignature;
  return {
    ...ts,
    applicantSignatureUrl: ts.applicantSignatureUrl ?? a?.signatureUrl ?? null,
    applicantSignedAt: ts.applicantSignedAt ?? a?.signedAt ?? null,
    investorSignatureUrl: ts.investorSignatureUrl ?? i?.signatureUrl ?? null,
    investorSignedAt: ts.investorSignedAt ?? i?.signedAt ?? null,
  };
}

/**
 * `financialKpis.kpiValues[period]` mixes flat metrics with nested buckets (`derived`,
 * `manualEntries`, `AUTO_KPI_FLAT`) that would render as "[object Object]". Drop `derived` and
 * `manualEntries`; lift other nested buckets' entries one level.
 */
function normalizeCompany(co: InvesteeCompany): InvesteeCompany {
  const kv = co.financialKpis?.kpiValues;
  if (!kv || typeof kv !== 'object') return co;
  const cleaned: Record<string, Record<string, unknown>> = {};
  for (const [period, values] of Object.entries(kv)) {
    if (!values || typeof values !== 'object') continue;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (key === 'manualEntries' || key === 'derived') continue;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!(k in out)) out[k] = v;
        continue;
      }
      out[key] = value;
    }
    cleaned[period] = out;
  }
  return { ...co, financialKpis: { ...co.financialKpis, kpiValues: cleaned } };
}

const el = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T | null;
const val = (id: string) => el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id)?.value?.trim() ?? '';
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Same month list as the runtime's `forecastPeriods`: 12 months starting three months ago. */
function periodFromIndex(index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 11) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 3 + index, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return {
    periodStart: iso(start),
    periodEnd: iso(end),
    label: start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
  };
}

const INCOME_FIELDS = ['merchantRevenue', 'enterpriseRevenue', 'otherRevenue', 'processingCosts', 'supportLosses', 'salesMarketing', 'productEngineering', 'generalAdmin'];
const BALANCE_FIELDS = ['cashAndEquivalents', 'tradeReceivables', 'otherCurrentAssets', 'fixedAssets', 'otherAssets', 'tradePayables', 'accruedExpenses', 'debt', 'otherLiabilities', 'shareCapital', 'retainedEarnings'];
const CASH_FIELDS = ['openingCash', 'operatingCash', 'capex', 'financing'];

const STATEMENTS_BY_REPORT_TYPE: Record<string, FinancialStatementKind[]> = {
  management: ['income-statement', 'balance-sheet', 'cash-flow'],
  quarterly: ['income-statement', 'cash-flow'],
  income: ['income-statement'],
  balance: ['balance-sheet'],
  cashflow: ['cash-flow'],
};
const REPORT_LABELS: Record<string, string> = {
  management: 'Monthly management accounts',
  quarterly: 'Quarterly investor report',
  income: 'Income statement',
  balance: 'Balance sheet',
  cashflow: 'Cash flow statement',
};
const STATEMENT_FIELDS: Record<FinancialStatementKind, string[]> = {
  'income-statement': INCOME_FIELDS,
  'balance-sheet': BALANCE_FIELDS,
  'cash-flow': CASH_FIELDS,
};

function canvasBlob(): Promise<Blob> {
  const canvas = el<HTMLCanvasElement>('signatureCanvas');
  if (!canvas || canvas.dataset.signed !== '1') return Promise.reject(new Error('Draw your signature before signing.'));
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not capture the signature image.'))), 'image/png'),
  );
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createInvesteeHost(api: InvesteeApi, ui: () => InvesteeRuntimeUI | undefined) {
  const livePages = livePagesFor(api);
  let payload: InvesteeLivePayload | null = null;

  const pageLive = (page: string) => livePages.includes(page);

  async function load(): Promise<InvesteeLivePayload> {
    const errors: string[] = [];
    const failed = new Map<InvesteeActionKey, string>();
    const run = async <T>(key: InvesteeActionKey, fn: () => Promise<T>): Promise<T | null> => {
      if (!api.isLive(key)) return null;
      try {
        return await fn();
      } catch (e) {
        const msg = errorText(e);
        failed.set(key, msg);
        errors.push(`${key}: ${msg}`);
        return null;
      }
    };
    const [dashboard, profile, company, reportingRequests, financialReports, termSheets, application, requests, capTable, governance, forecast, vault, threads, team] =
      await Promise.all([
        run('dashboard', api.getDashboard),
        run('profile', api.getProfile),
        run('company', api.getCompany),
        run('reports.schedule', api.getReportingRequests),
        run('reports.history', api.getFinancialReports),
        run('termSheets.list', api.getTermSheets),
        run('application', api.getApplication),
        run('requests.list', api.getRequests),
        run('capTable', api.getCapTable),
        run('governance', api.getGovernance),
        run('forecast', api.getForecast),
        run('vault', api.getVault),
        run('threads.list', api.getThreads),
        run('team.list', api.getTeam),
      ]);
    const pageErrors: Record<string, string> = {};
    for (const page of livePages) {
      const msgs = LIVE_PAGE_LOADERS[page].filter((k) => failed.has(k)).map((k) => `${k}: ${failed.get(k)}`);
      if (msgs.length) pageErrors[page] = msgs.join(' · ');
    }
    payload = {
      dashboard,
      profile,
      company: company ? normalizeCompany(company) : null,
      reportingRequests: Array.isArray(reportingRequests) ? reportingRequests : reportingRequests ? [] : null,
      financialReports,
      termSheets: termSheets ? termSheets.map(normalizeTermSheet) : null,
      application: application ?? (vault ? { id: '', businessName: '', currentStage: '', requestedAmount: null, documents: vault.documents } : null),
      drawdown: requests ? { requisitions: requests.requisitions } : null,
      capTable,
      governance,
      forecast,
      threads,
      team,
      errors,
      pageErrors,
    };
    return payload;
  }

  async function reload(): Promise<InvesteeLivePayload | null> {
    if (!LOADERS.some((k) => api.isLive(k))) return null;
    const p = await load();
    ui()?.hydrate?.(p);
    return p;
  }

  const termSheetById = (tsId: string) => payload?.termSheets?.find((t) => String(t.id) === tsId);
  const termsLive = () => pageLive('terms') || pageLive('signatures');

  /** Synchronous: decides whether the runtime's own (demo) handler must be cancelled. */
  function intercepts(detail: ActionDetail): boolean {
    const a = detail.action ?? '';
    const ds = detail.dataset ?? {};
    switch (a) {
      case 'sign-document':
        return termsLive() && api.isLive('termSheets.view') && !!(ds.termSheetId || ds.id);
      case 'complete-signature':
        return termsLive() && api.isLive('termSheets.sign');
      case 'confirm-decline':
        return termsLive() && api.isLive('termSheets.decline');
      case 'complete-kpi-submit':
        return api.isLive('kpis.submit');
      case 'download-template':
        return api.isLive('reports.template');
      case 'save-structured-report':
        return api.isLive('reports.draft');
      case 'submit-structured-report':
        return api.isLive('reports.draft') && api.isLive('reports.submit');
      case 'live-report-detail':
        return pageLive('reports') && api.isLive('reports.detail');
      case 'submit-financial-report-bundle':
        return pageLive('reports') && api.isLive('reports.submit');
      case 'save-settings':
        return pageLive('settings') && (api.isLive('settings.profile') || api.isLive('settings.company') || api.isLive('settings.letterhead'));
      case 'send-conversation':
      case 'reply-thread':
        return api.isLive('threads.start');
      case 'send-invite':
        return api.isLive('team.invite');
      case 'create-request':
      case 'save-request-draft':
        return api.isLive('requests.create');
      case 'send-approval':
        return api.isLive('governance.consent');
      case 'forecast-save':
      case 'scenario':
        return pageLive('forecasts') && api.isLive('forecast.save');
      case 'save-cap-holder':
        return api.isLive('capTable.save');
      case 'complete-upload':
        return api.isLive('vault.upload');
      default:
        return false;
    }
  }

  async function handle(detail: ActionDetail): Promise<ActionResult> {
    const a = detail.action ?? '';
    const ds = detail.dataset ?? {};
    try {
      switch (a) {
        case 'sign-document': {
          const tsId = ds.termSheetId || ds.id;
          const fresh = normalizeTermSheet(await api.getTermSheet(tsId));
          if (payload?.termSheets) {
            payload = { ...payload, termSheets: payload.termSheets.map((t) => (String(t.id) === tsId ? { ...t, ...fresh } : t)) };
            ui()?.hydrate?.(payload);
          }
          ui()?.openSignature?.(tsId);
          return {};
        }

        case 'complete-signature': {
          const tsId = ds.termSheetId || ds.id;
          if (!tsId) return { error: 'This signature request has no term sheet id.' };
          const name = val('signatureName');
          const consent = el('signatureConsent')?.checked;
          if (!name || !consent) return { error: 'Enter your name, draw your signature and confirm consent before signing.' };
          const signature = await canvasBlob();
          const ts = termSheetById(tsId);
          const consentTextVersion = ts?.consent?.version;
          if (!consentTextVersion) return { error: 'Reload the term sheet before signing so the consent version is current.' };
          await api.signTermSheet(tsId, { signature, name, consent: true, consentTextVersion });
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Term sheet signed', detail: 'Your signature, consent and the document hash were recorded.' };
        }

        case 'confirm-decline': {
          const tsId = ds.termSheetId || ds.id;
          const reason = val('declineReason');
          if (!reason) return { error: 'Enter a reason for declining.' };
          await api.declineTermSheet(tsId, { reason });
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Term sheet declined', detail: 'The investor team has been notified.' };
        }

        case 'complete-kpi-submit': {
          const periodStart = val('kpiPeriodStart');
          const periodEnd = val('kpiPeriodEnd');
          if (!periodStart || !periodEnd) return { error: 'Period start and end are required.' };
          if (periodStart > periodEnd) return { error: 'Period start must be on or before period end.' };
          await api.submitPeriodKpis({
            periodStart,
            periodEnd,
            totalRevenue: num(val('kpiTotalRevenue')),
            netProfit: num(val('kpiNetProfit')),
            cashFlowNet: num(val('kpiCashFlowNet')),
          });
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Period KPIs submitted', detail: 'The portfolio team can now see these figures.' };
        }

        case 'download-template': {
          const hint = `${ds.template || ds.name || ''}`.toUpperCase();
          const type = hint.includes('BALANCE') ? 'BALANCE_SHEET' : hint.includes('CASH') ? 'CASHFLOW_STATEMENT' : hint.includes('KPI') ? 'OPERATIONAL_KPIS' : 'INCOME_STATEMENT';
          const res = await api.downloadReportTemplate(type);
          const cd = res.headers.get('Content-Disposition') ?? '';
          const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
          const ext = (res.headers.get('Content-Type') ?? '').includes('csv') ? 'csv' : 'xlsx';
          saveBlob(await res.blob(), match ? decodeURIComponent(match[1]) : `${type.toLowerCase()}-template.${ext}`);
          return { message: 'Template downloaded' };
        }

        case 'save-structured-report':
        case 'submit-structured-report':
          return await saveReport(detail, a === 'submit-structured-report');

        case 'live-report-detail': {
          const report = await api.getFinancialReport(ds.id);
          ui()?.showReportDetail?.(report);
          return {};
        }

        case 'submit-financial-report-bundle': {
          const reportId = ds.reportId || ds.id;
          await api.submitReport(reportId);
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Report submitted', detail: 'The report was sent to the Matanho portfolio team for review.' };
        }

        case 'save-settings':
          return await saveSettings();

        case 'send-invite': {
          const fields = [...document.querySelectorAll('#modalBody input, #modalBody select, #modalBody textarea')] as HTMLInputElement[];
          const name = fields[0]?.value.trim();
          const email = fields[1]?.value.trim();
          const profile = fields[2]?.value.trim();
          const title = fields[3]?.value.trim();
          if (!email) return { error: 'A work email is required.' };
          await api.inviteTeamMember({ name, email, profile: profile || 'Report contributor', title });
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Invitation sent', detail: 'They will set a password from the invitation email.' };
        }

        case 'create-request':
        case 'save-request-draft': {
          const req = detail.request;
          const title = req?.title || val('newRequestTitle');
          if (!title) return { error: 'Enter a request title.' };
          await api.createRequest({
            title,
            description: req?.description || val('newRequestDescription'),
            type: req?.type || val('newRequestType') || 'Capital request',
            category: req?.category || val('newRequestCategory'),
            currency: req?.currency || val('newRequestCurrency') || 'USD',
            amount: req?.amount ?? num(val('newRequestAmount')),
            needBy: req?.needBy || val('newRequestNeedBy') || undefined,
            priority: req?.priority || val('newRequestPriority') || 'Medium',
            draft: a === 'save-request-draft',
          });
          ui()?.closeOverlays?.();
          await reload();
          return { message: a === 'save-request-draft' ? 'Draft saved' : 'Request submitted', detail: 'The fund team can review it from the operations console.' };
        }

        case 'send-approval': {
          const title = val('approvalTitle');
          const basis = val('approvalBasis');
          if (!title || !basis) return { error: 'Enter the matter and the approval category.' };
          await api.requestConsent({ title, basis, due: val('approvalDue') || undefined, note: val('approvalNote') || undefined });
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Consent requested', detail: 'The matter is waiting for investor review.' };
        }

        case 'scenario': {
          const scenario = detail.dataset?.scenario;
          if (scenario !== 'Base case' && scenario !== 'Upside' && scenario !== 'Downside') return {};
          await api.saveForecast({ scenario });
          await reload();
          return { message: 'Scenario saved', detail: scenario };
        }

        case 'forecast-save': {
          const revenue: Record<string, number> = {};
          document.querySelectorAll<HTMLInputElement>('.forecast-live-input').forEach((input) => {
            const month = input.dataset.month;
            if (month) revenue[month] = num(input.value);
          });
          await api.saveForecast({ revenue });
          await reload();
          return { message: 'Forecast saved', detail: 'Forecast revenue was stored for the open months.' };
        }

        case 'save-cap-holder': {
          const name = val('capHolderName');
          const shares = num(val('capHolderShares'));
          if (!name || shares <= 0) return { error: 'Enter the holder name and a positive share count.' };
          const current = (payload?.capTable?.shareholders ?? []).map((row) => ({ id: row.id, name: row.name, type: row.type, shares: row.shares }));
          await api.saveCapTable([...current, { name, type: val('capHolderType') || 'Ordinary', shares: Math.round(shares) }]);
          await reload();
          return { message: 'Holder added', detail: 'Ownership percentages were recalculated.' };
        }

        case 'complete-upload': {
          const file = el<HTMLInputElement>('vaultFile')?.files?.[0];
          if (!file) return { error: 'Choose a file to upload.' };
          await api.uploadVaultFile(file, val('vaultFileName') || file.name);
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Document stored', detail: file.name };
        }

        case 'send-conversation': {
          const subject = val('newConversationSubject');
          const body = val('newConversationBody');
          if (!subject || !body) return { error: 'Enter a subject and a message.' };
          await api.startThread({ recipientTeam: val('newConversationTeam') || 'Matanho Portfolio Team', subject, body });
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Message sent', detail: 'A secure conversation was created with the fund team.' };
        }

        case 'reply-thread': {
          const threadId = ds.id;
          const text = val('liveReplyText');
          if (!threadId) return { error: 'Choose a conversation before replying.' };
          if (!text) return { error: 'Write a reply before sending.' };
          await api.replyToThread(threadId, text);
          await reload();
          return { message: 'Reply sent', detail: 'The portfolio team can see it on this thread.' };
        }
      }
      return {};
    } catch (e) {
      return { error: errorText(e) };
    }
  }

  async function saveReport(detail: ActionDetail, submit: boolean): Promise<ActionResult> {
    const report = detail.report ?? {};
    const type = String(report.type || 'management');
    const statements = STATEMENTS_BY_REPORT_TYPE[type];
    if (!statements) return { error: `${type} reports cannot be submitted to the live API yet.` };
    const period = periodFromIndex(Number(report.period));
    if (!period) return { error: 'Choose a monthly reporting period (the rolling 12-month view cannot be submitted).' };
    const values = report.values ?? {};
    if (submit) {
      const required = statements.flatMap((s) => (s === 'balance-sheet' ? [] : STATEMENT_FIELDS[s]));
      const missing = required.filter((k) => !Number.isFinite(Number(values[k])));
      if (missing.length) return { error: 'Complete the required financial statement fields before submission.' };
    }

    const label = REPORT_LABELS[type] ?? 'Investee report';
    const draftIds: string[] = [];
    for (const kind of statements) {
      const data: Record<string, unknown> = Object.fromEntries(STATEMENT_FIELDS[kind].map((k) => [k, num(values[k])]));
      data.notes = report.notes ?? {};
      const body: FinancialReportDraftRequest = {
        reportingPeriod: period.periodEnd,
        periodType: 'MONTHLY',
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        title: `${label} · ${kind.replace('-', ' ')} · ${period.label}`,
        description: report.owner ? `Prepared by ${report.owner}` : undefined,
        templateVersion: 'v1',
        data,
      };
      const draft = await api.createReportDraft(kind, body);
      if (draft?.id) draftIds.push(String(draft.id));
    }
    if (!draftIds.length) return { error: 'The API did not return a draft id.' };

    if (!submit) {
      ui()?.closeOverlays?.();
      await reload();
      return { message: 'Report draft saved', detail: `${label} for ${period.label} is saved as a draft.` };
    }

    if (api.isLive('kpis.submit')) {
      const totalRevenue = num(values.merchantRevenue) + num(values.enterpriseRevenue) + num(values.otherRevenue);
      const costs = ['processingCosts', 'supportLosses', 'salesMarketing', 'productEngineering', 'generalAdmin'].reduce((s, k) => s + num(values[k]), 0);
      await api.submitPeriodKpis({
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        totalRevenue,
        netProfit: totalRevenue - costs,
        cashFlowNet: num(values.operatingCash) + num(values.capex) + num(values.financing),
      });
    }
    await api.submitReport(draftIds[0]);
    ui()?.closeOverlays?.();
    await reload();
    return { message: 'Investor report submitted', detail: `${label} for ${period.label} was sent for review.` };
  }

  async function saveSettings(): Promise<ActionResult> {
    const saved: string[] = [];
    if (api.isLive('settings.profile')) {
      const body: UpdateProfileRequest = { firstName: val('settingsFirstName') || undefined, lastName: val('settingsLastName') || undefined };
      if (body.firstName || body.lastName) {
        await api.updateProfile(body);
        saved.push('profile');
      }
    }
    if (api.isLive('settings.company')) {
      const body: UpdateCompanyRequest = Object.fromEntries(
        Object.entries({
          industry: val('settingsIndustry'),
          website: val('settingsWebsite'),
          description: val('settingsDescription'),
          contactEmail: val('settingsContactEmail'),
          contactPhone: val('settingsContactPhone'),
        }).filter(([, v]) => v !== ''),
      );
      if (Object.keys(body).length) {
        await api.updateCompany(body);
        saved.push('company profile');
      }
    }
    if (api.isLive('settings.letterhead')) {
      const legalName = val('settingsLetterheadLegalName');
      if (legalName) {
        const line1 = val('settingsLetterheadLine1');
        const city = val('settingsLetterheadCity');
        const country = val('settingsLetterheadCountry');
        if (!line1 || !city || !country) return { error: 'Letterhead needs a street, city and country.' };
        const body: UpdateLetterheadRequest = {
          legalName,
          registrationNumber: val('settingsLetterheadReg') || null,
          email: val('settingsLetterheadEmail') || null,
          phone: val('settingsLetterheadPhone') || null,
          website: val('settingsLetterheadWebsite') || null,
          line1,
          city,
          country,
        };
        await api.updateLetterhead(body);
        saved.push('letterhead');
      }
      const logo = el('settingsLetterheadLogo')?.files?.[0];
      if (logo) {
        await api.uploadLetterheadLogo(logo);
        saved.push('logo');
      }
    }
    await reload();
    if (!saved.length) return { error: 'Nothing to save: fill in at least one field.' };
    return { message: 'Settings saved', detail: `Updated: ${saved.join(', ')}.` };
  }

  return {
    livePages,
    pageLive,
    reload,
    intercepts,
    handle,
    getPayload: () => payload,
  };
}

export type InvesteeHost = ReturnType<typeof createInvesteeHost>;
