import { InvesteeApiError, loadNotifications, setSelectedCompany, type InvesteeActionKey, type InvesteeApi } from './api';
import { pathToIp8Page } from '../nav';
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
  openDrawer?: (title: string, sub: string, bodyHtml: string, footHtml?: string) => void;
  openModal?: (title: string, sub: string, bodyHtml: string, footHtml?: string) => void;
  /** Shows a validation message at the top of the open modal or drawer. */
  inlineError?: (message: string) => boolean;
}

/** Things the host needs from the React shell. */
export interface InvesteeHostHooks {
  /** Opens the in-portal two-factor enrolment dialog; resolves true when a code was confirmed. */
  enrolMfa?: () => Promise<boolean>;
  /** Called after every load so the shell chrome (company card, role, footer) can follow the live records. */
  onLoaded?: (payload: InvesteeLivePayload) => void;
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
    /** YYYY-MM of the live reporting request (preferred over the rolling index). */
    periodKey?: string;
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

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] as string);
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

/** CSV of the recorded register. Quotes any field that contains a comma, quote, or newline. */
export function capTableCsv(rows: { name: string; type: string; shares: number; pct: number }[]) {
  const cell = (value: string | number) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = ['Name,Class,Shares,Percent', ...rows.map((row) => [cell(row.name), cell(row.type), cell(row.shares), cell(row.pct)].join(','))];
  return `${lines.join('\n')}\n`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createInvesteeHost(api: InvesteeApi, ui: () => InvesteeRuntimeUI | undefined, hooks: InvesteeHostHooks = {}) {
  const livePages = livePagesFor(api);
  let payload: InvesteeLivePayload | null = null;

  const pageLive = (page: string) => livePages.includes(page);

  async function load(): Promise<InvesteeLivePayload> {
    const errors: string[] = [];
    const failed = new Map<InvesteeActionKey, string>();
    let noCompany = false;
    const run = async <T>(key: InvesteeActionKey, fn: () => Promise<T>): Promise<T | null> => {
      if (!api.isLive(key)) return null;
      try {
        return await fn();
      } catch (e) {
        if (e instanceof InvesteeApiError && e.code === 'no_company_access') noCompany = true;
        const msg = errorText(e);
        failed.set(key, msg);
        errors.push(`${key}: ${msg}`);
        return null;
      }
    };
    const [dashboard, profile, company, reportingRequests, financialReports, termSheets, application, requests, capTable, governance, forecast, vault, threads, team, kpis, letterhead, settings, workspaceSignatures] =
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
        run('company', api.getKpis),
        run('settings.letterhead', api.getLetterhead),
        run('profile', api.getSettings),
        run('workspace', api.getWorkspaceSignatures),
      ]);
    // The bell reads the caller's own notifications; a failure just leaves it empty.
    const notifications = noCompany ? null : await loadNotifications().catch(() => null);
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
      kpis,
      letterhead,
      settings,
      workspaceSignatures,
      notifications,
      noCompany,
      errors,
      pageErrors,
    };
    return payload;
  }

  async function reload(): Promise<InvesteeLivePayload | null> {
    if (!LOADERS.some((k) => api.isLive(k))) return null;
    const p = await load();
    ui()?.hydrate?.(p);
    hooks.onLoaded?.(p);
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
      case 'model-round':
        return api.isLive('capTable.save');
      case 'export-cap-table':
        return pageLive('cap-table') && api.isLive('capTable');
      case 'complete-upload':
        return api.isLive('vault.upload');
      case 'notifications':
        return payload !== null;
      case 'company-menu':
      case 'switch-company':
        return payload?.profile != null;
      case 'profile':
        return payload?.profile != null;
      case 'setup-mfa':
        return true;
      case 'export-kpi-history':
        return api.isLive('workspace');
      default:
        return false;
    }
  }

  async function handle(detail: ActionDetail): Promise<ActionResult> {
    const a = detail.action ?? '';
    const ds = detail.dataset ?? {};
    try {
      switch (a) {
        case 'notifications': {
          const items = payload?.notifications ?? [];
          const rows = items.length
            ? items
                .map((n) => {
                  const page = n.link ? pathToIp8Page(n.link) : '';
                  const nav = page && page !== 'dashboard' ? ` data-action="navigate" data-page="${esc(page)}"` : '';
                  return `<div class="action-row"${nav}><span class="action-copy"><strong>${esc(n.title)}</strong><span>${esc(n.body ?? '')} ${esc(String(n.createdAt).slice(0, 10))}</span></span>${n.readAt ? '' : '<span class="status danger">New</span>'}</div>`;
                })
                .join('')
            : '<div class="empty"><strong>No notifications</strong><span>Alerts and reminders for you will appear here.</span></div>';
          ui()?.openDrawer?.('Notifications', 'Your alerts and reminders', `<div class="action-list">${rows}</div>`);
          return {};
        }

        case 'company-menu': {
          const list = payload?.profile?.companies ?? [];
          const fund = payload?.company?.fund?.name ?? payload?.profile?.company?.fundName ?? '';
          const rows = list
            .map(
              (c) =>
                `<div class="action-row" ${c.current ? '' : `data-action="switch-company" data-ref="${esc(c.id)}"`}><span class="action-copy"><strong>${esc(c.name)}</strong><span>${esc(c.id)} · ${esc(c.accessProfile.replace(/_/g, ' '))}${c.current && fund ? ` · ${esc(fund)}` : ''}</span></span>${c.current ? '<span class="status success">Current</span>' : '<span class="status neutral">Switch</span>'}</div>`,
            )
            .join('');
          ui()?.openDrawer?.(
            'Company workspace',
            list.length > 1 ? 'Choose the company you are working in' : 'The company you are signed in to',
            `<div class="action-list">${rows || '<div class="empty"><strong>No workspace</strong></div>'}</div>`,
          );
          return {};
        }

        case 'switch-company': {
          if (!ds.ref) return {};
          setSelectedCompany(ds.ref);
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Workspace switched', detail: payload?.profile?.company?.name ?? ds.ref };
        }

        case 'profile': {
          const p = payload?.profile;
          if (!p) return {};
          const name = p.name ?? `${p.firstName} ${p.lastName}`.trim();
          const role = (p.title || (p.accessProfile ?? p.roleCode ?? '').replace(/_/g, ' ') || 'Company user') as string;
          ui()?.openDrawer?.(
            'Your profile',
            `${name} · ${role}`,
            `<dl class="detail-list"><div class="detail-row"><dt>Email</dt><dd>${esc(p.email)}</dd></div><div class="detail-row"><dt>Company</dt><dd>${esc(p.company?.name ?? '')}</dd></div><div class="detail-row"><dt>Access profile</dt><dd>${esc((p.accessProfile ?? '').replace(/_/g, ' '))}</dd></div><div class="detail-row"><dt>Two-factor sign-in</dt><dd>${p.mfaEnabled ? 'On' : 'Not set up'}</dd></div></dl>`,
            `<button class="btn" data-action="sign-out">Sign out</button>${p.mfaEnabled ? '' : '<button class="btn" data-action="setup-mfa">Set up two-factor</button>'}<button class="btn primary" data-action="navigate" data-page="settings">Edit profile</button>`,
          );
          return {};
        }

        case 'setup-mfa': {
          if (!hooks.enrolMfa) return { error: 'Two-factor setup is not available here.' };
          const ok = await hooks.enrolMfa();
          if (!ok) return {};
          await reload();
          return { message: 'Two-factor sign-in is on', detail: 'You can now sign term sheets and approve transactions.' };
        }

        case 'export-kpi-history': {
          const blob = await api.workspaceFile('/kpis/export?format=csv');
          saveBlob(blob, 'kpi-history.csv');
          return { message: 'KPI history exported', detail: 'kpi-history.csv' };
        }

        case 'sign-document': {
          const tsId = ds.termSheetId || ds.id;
          if (tsId && payload?.termSheets && !payload.termSheets.some((t) => String(t.id) === tsId)) {
            return { error: 'Workspace signature requests are signed by each signer through the link e-mailed to them. Only term sheets are signed here.' };
          }
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
          if (!name) return { error: 'Type your full name to sign.' };
          if (!consent) return { error: 'Tick the box to confirm you consent to sign electronically.' };
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
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Enter a valid work e-mail address.' };
          await api.inviteTeamMember({ name, email, profile: profile || 'Report contributor', title });
          ui()?.closeOverlays?.();
          await reload();
          return { message: 'Invitation sent', detail: `${email} is listed under Team & Access as an invitation pending acceptance.` };
        }

        case 'create-request':
        case 'save-request-draft': {
          const req = detail.request;
          const title = req?.title || val('newRequestTitle');
          if (!title) return { error: 'Enter a request title.' };
          if (req?.amount !== undefined && req.amount < 0) return { error: 'The amount cannot be negative.' };
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
          if (!title) return { error: 'Enter the matter requiring approval.' };
          if (!basis) return { error: 'Choose an approval category.' };
          const dueBy = val('approvalDue');
          if (dueBy && dueBy < iso(new Date())) return { error: 'The decision date cannot be in the past.' };
          if (title.length < 3) return { error: 'The matter needs at least 3 characters.' };
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
          const negative = Object.entries(revenue).filter(([, v]) => v < 0).map(([m]) => m);
          if (negative.length) return { error: `Forecast revenue cannot be negative (${negative.join(', ')}).` };
          await api.saveForecast({ revenue });
          await reload();
          return { message: 'Forecast saved', detail: 'Forecast revenue was stored for the open months.' };
        }

        case 'export-cap-table': {
          const rows = payload?.capTable?.shareholders ?? [];
          if (!rows.length) return { error: 'There are no holders to export.' };
          saveBlob(new Blob([capTableCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'cap-table.csv');
          return { message: 'Register exported', detail: `${rows.length} holder${rows.length === 1 ? '' : 's'}.` };
        }

        case 'model-round': {
          const amount = num(val('roundAmount'));
          const preMoney = num(val('roundPreMoney'));
          if (amount <= 0 || preMoney <= 0) return { error: 'Enter the new money and a pre-money valuation.' };
          const round = await api.simulateRound({ amount, preMoney });
          const box = document.getElementById('roundResult');
          if (box) {
            box.innerHTML = round.shareholders
              .map((row) => `<div>${row.name}: ${row.pct}% · ${row.shares.toLocaleString('en-GB')} shares</div>`)
              .join('');
          }
          return { message: 'Round modelled', detail: `Price ${round.pricePerShare} per share. The cap table was not changed.` };
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
    const keyIn = String(report.periodKey ?? '');
    let period: { periodStart: string; periodEnd: string; label: string } | null;
    if (keyIn) {
      const row = payload?.reportingRequests?.find((r) => r.reportingPeriod === keyIn);
      if (!row) return { error: 'There is no open reporting request for the selected period.' };
      const [y, m] = keyIn.split('-').map(Number);
      const monthEnd = iso(new Date(y, m, 0));
      period = {
        periodStart: (row.periodStart ?? `${keyIn}-01`).slice(0, 10),
        periodEnd: (row.periodEnd ?? monthEnd).slice(0, 10),
        label: row.label ?? new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      };
    } else {
      period = periodFromIndex(Number(report.period));
    }
    if (!period) return { error: 'Choose a reporting period that has an open request.' };
    const values = report.values ?? {};
    // INO-003: check the balance sheet before anything is saved so the form stays open with a clear message.
    let balanceNote = '';
    if (statements.includes('balance-sheet')) {
      const sum = (keys: string[]) => keys.reduce((t, k) => t + num(values[k]), 0);
      const assets = sum(['cashAndEquivalents', 'tradeReceivables', 'otherCurrentAssets', 'fixedAssets', 'otherAssets']);
      const rhs = sum(['tradePayables', 'accruedExpenses', 'debt', 'otherLiabilities', 'shareCapital', 'retainedEarnings']);
      const diff = Math.round((assets - rhs) * 100) / 100;
      if (Math.abs(diff) > 0.5) {
        const text = `Balance sheet does not balance: total assets ${assets} and liabilities plus equity ${rhs} differ by ${diff} (USD 000).`;
        if (submit) {
          const box = el('reportValidation');
          const msg = el('reportValidationText');
          if (box && msg) {
            msg.textContent = text;
            box.classList.add('show');
          }
          return { error: text };
        }
        balanceNote = ` Note: ${text}`;
      }
    }
    if (submit) {
      const required = statements.flatMap((s) => (s === 'balance-sheet' ? [] : STATEMENT_FIELDS[s]));
      const missing = required.filter((k) => !Number.isFinite(Number(values[k])));
      if (missing.length) return { error: 'Complete the required financial statement fields before submission.' };
    }

    const label = REPORT_LABELS[type] ?? 'Investee report';
    const periodKey = period.periodEnd.slice(0, 7);
    const loaded = payload?.reportingRequests?.find((row) => row.reportingPeriod === periodKey);
    const version = loaded?.version;
    const draftIds: string[] = [];
    for (const kind of statements) {
      const data: Record<string, unknown> = Object.fromEntries(STATEMENT_FIELDS[kind].map((k) => [k, num(values[k])]));
      const noteSlice = Object.fromEntries(
        Object.entries(report.notes ?? {}).flatMap(([k, v]) =>
          STATEMENT_FIELDS[kind].includes(k) && typeof v === 'string' && v.trim() ? [[k, v.trim()]] : [],
        ),
      );
      if (Object.keys(noteSlice).length) data.notes = noteSlice;
      if (kind === statements[0]) {
        const narrative = Object.fromEntries(
          ['executiveSummary', 'keyWins', 'keyRisks', 'submissionNote', 'nextPeriodFocus'].flatMap((k) => {
            const text = values[k];
            return typeof text === 'string' && text.trim() ? [[k, text.trim()]] : [];
          }),
        );
        if (Object.keys(narrative).length) data.narrative = narrative;
      }
      if (submit && kind === 'balance-sheet') {
        const assets = ['cashAndEquivalents', 'tradeReceivables', 'otherCurrentAssets', 'fixedAssets', 'otherAssets'].reduce((s, k) => s + num(values[k]), 0);
        const liabilities = ['tradePayables', 'accruedExpenses', 'debt', 'otherLiabilities'].reduce((s, k) => s + num(values[k]), 0);
        const equity = num(values.shareCapital) + num(values.retainedEarnings);
        data.totalAssets = assets;
        data.totalLiabilities = liabilities;
        data.totalEquity = equity;
      }
      const body: FinancialReportDraftRequest = {
        reportingPeriod: period.periodEnd,
        periodType: 'MONTHLY',
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        title: `${label} · ${kind.replace('-', ' ')} · ${period.label}`,
        description: report.owner ? `Prepared by ${report.owner}` : undefined,
        templateVersion: 'v1',
        ...(version !== undefined && kind === statements[0] ? { version } : {}),
        data,
      };
      const draft = await api.createReportDraft(kind, body);
      if (draft?.id) draftIds.push(String(draft.id));
    }
    if (!draftIds.length) return { error: 'The API did not return a draft id.' };

    if (!submit) {
      ui()?.closeOverlays?.();
      await reload();
      return { message: 'Report draft saved', detail: `${label} for ${period.label} is saved as a draft.${balanceNote}` };
    }

    if (api.isLive('kpis.submit')) {
      const totalRevenue = num(values.merchantRevenue) + num(values.enterpriseRevenue) + num(values.otherRevenue);
      const costs = ['processingCosts', 'supportLosses', 'salesMarketing', 'productEngineering', 'generalAdmin'].reduce((s, k) => s + num(values[k]), 0);
      await api.submitPeriodKpis({
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        totalRevenue,
        netProfit: totalRevenue - costs,
        cashFlowNet: num(values.operatingCash) - num(values.capex) + num(values.financing),
      });
    }
    const noteParts = [
      ...Object.values(report.notes ?? {}).flatMap((v) => (typeof v === 'string' && v.trim() ? [v.trim()] : [])),
      ...['executiveSummary', 'keyWins', 'keyRisks', 'submissionNote', 'nextPeriodFocus'].flatMap((k) => {
        const text = values[k];
        return typeof text === 'string' && text.trim() ? [text.trim()] : [];
      }),
    ];
    await api.submitReport(draftIds[0], noteParts.join('\n').slice(0, 10_000) || undefined);
    ui()?.closeOverlays?.();
    await reload();
    return { message: 'Investor report submitted', detail: `${label} for ${period.label} was sent for review.` };
  }

  /** INO-019: validate every part first, then write only the parts that changed. */
  async function saveSettings(): Promise<ActionResult> {
    const problems: string[] = [];
    const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    const urlOk = (v: string) => /^https?:\/\/[^\s]+$/i.test(v);
    const profileBody: UpdateProfileRequest = { firstName: val('settingsFirstName') || undefined, lastName: val('settingsLastName') || undefined };
    const companyBody: UpdateCompanyRequest = Object.fromEntries(
      Object.entries({
        industry: val('settingsIndustry'),
        website: val('settingsWebsite'),
        description: val('settingsDescription'),
        contactEmail: val('settingsContactEmail'),
        contactPhone: val('settingsContactPhone'),
      }).filter(([, v]) => v !== ''),
    );
    if (companyBody.contactEmail && !emailOk(companyBody.contactEmail)) problems.push('Contact email is not a valid e-mail address.');
    if (companyBody.website && !urlOk(companyBody.website)) problems.push('Website must start with http:// or https://.');

    const loaded = payload?.letterhead ?? null;
    const lh = {
      legalName: val('settingsLetterheadLegalName'),
      registrationNumber: val('settingsLetterheadReg'),
      email: val('settingsLetterheadEmail'),
      phone: val('settingsLetterheadPhone'),
      website: val('settingsLetterheadWebsite'),
      line1: val('settingsLetterheadLine1'),
      city: val('settingsLetterheadCity'),
      country: val('settingsLetterheadCountry'),
    };
    const before = {
      legalName: loaded?.legalName ?? '',
      registrationNumber: loaded?.registrationNumber ?? '',
      email: loaded?.email ?? '',
      phone: loaded?.phone ?? '',
      website: loaded?.website ?? '',
      line1: loaded?.line1 ?? '',
      city: loaded?.city ?? '',
      country: loaded?.country ?? '',
    };
    const lhChanged = (Object.keys(lh) as (keyof typeof lh)[]).some((k) => lh[k] !== before[k]);
    const logo = el('settingsLetterheadLogo')?.files?.[0];
    if (api.isLive('settings.letterhead') && lhChanged && lh.legalName) {
      if (!lh.line1 || !lh.city || !lh.country) problems.push('Letterhead needs a street, city and country.');
      if (lh.email && !emailOk(lh.email)) problems.push('Letterhead email is not a valid e-mail address.');
      if (lh.website && !urlOk(lh.website)) problems.push('Letterhead website must start with http:// or https://.');
    }
    if (problems.length) return { error: problems.join(' ') };

    const saved: string[] = [];
    if (api.isLive('settings.profile') && (profileBody.firstName || profileBody.lastName)) {
      await api.updateProfile(profileBody);
      saved.push('profile');
    }
    if (api.isLive('settings.company') && Object.keys(companyBody).length) {
      await api.updateCompany(companyBody);
      saved.push('company profile');
    }
    if (api.isLive('settings.letterhead')) {
      if (lhChanged && lh.legalName) {
        const body: UpdateLetterheadRequest = {
          legalName: lh.legalName,
          registrationNumber: lh.registrationNumber || null,
          email: lh.email || null,
          phone: lh.phone || null,
          website: lh.website || null,
          line1: lh.line1,
          city: lh.city,
          country: lh.country,
        };
        await api.updateLetterhead(body);
        saved.push('letterhead');
      }
      if (logo) {
        await api.uploadLetterheadLogo(logo);
        saved.push('logo');
      }
    }
    await reload();
    if (!saved.length) return { error: 'Nothing to save: change at least one field.' };
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
