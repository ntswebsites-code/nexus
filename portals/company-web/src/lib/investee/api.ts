import { createApiClient, type PlatformFlags } from '@matanho/shared';
import type {
  DeclineTermSheetRequest,
  FinancialReport,
  FinancialReportDraft,
  FinancialReportDraftRequest,
  FinancialReportPage,
  FinancialReportType,
  FinancialStatementKind,
  CapTableView,
  ForecastCells,
  ForecastVersionDetail,
  ForecastWorkingView,
  ForecastView,
  GovernanceFullView,
  GovernanceView,
  TrancheLedger,
  VaultDownloadUrl,
  VaultVersions,
  InvesteeApplication,
  InvesteeCompany,
  InvesteeConversation,
  InvesteeDashboard,
  InvesteeLivePayload,
  InvesteeProfile,
  InvesteeSettings,
  KpiCentre,
  InvesteeRequisition,
  InvesteeTeamMember,
  InvesteeThread,
  WorkspaceDocument,
  Letterhead,
  PeriodKpis,
  ReportingRequest,
  SignTermSheetRequest,
  StartThreadRequest,
  SubmitPeriodKpisRequest,
  TermSheet,
  TermSheetList,
  UpdateCompanyRequest,
  UpdateLetterheadRequest,
  UpdateProfileRequest,
} from './types';

/**
 * Investee API adapter for `/api/v1/investee-portal`.
 *
 * Every loader and action has a key. A call reaches the API only when its key is in
 * `GET /api/v1/platform/flags` -> `investee.liveActions` (or that list contains `all`); otherwise
 * the adapter refuses with `not_live` and the page keeps its demo fixture behind the
 * "Demo data" ribbon. Ops set the list with the API env `INVESTEE_LIVE_ACTIONS`
 * (comma-separated keys from the table below, or `all`).
 *
 * | key                 | method | path (under /api/v1/investee-portal)          | request -> response                         |
 * | ------------------- | ------ | --------------------------------------------- | ------------------------------------------- |
 * | dashboard           | GET    | /dashboard                                    | - -> InvesteeDashboard                      |
 * | profile             | GET    | /profile                                      | - -> InvesteeProfile                        |
 * | company             | GET    | /company                                      | - -> InvesteeCompany (incl. financialKpis)  |
 * | reports.schedule    | GET    | /reporting/requests                           | - -> ReportingRequest[]                     |
 * | reports.history     | GET    | /financial-reports                            | - -> FinancialReport[] or FinancialReportPage |
 * | reports.detail      | GET    | /financial-reports/:id                        | - -> FinancialReport                        |
 * | reports.template    | GET    | /financial-reports/template/:reportType       | - -> file (xlsx/csv)                        |
 * | reports.draft       | POST   | /financial-reports/{income-statement,balance-sheet,cash-flow}/draft | FinancialReportDraftRequest -> FinancialReportDraft |
 * | reports.upload      | POST   | /financial-reports/:id/file                   | multipart `file` -> FinancialReport         |
 * | reports.submit      | POST   | /financial-reports/submit/:id                 | - -> { submitted: true } (any)              |
 * | kpis.submit         | POST   | /financial-reports/period-kpis                | SubmitPeriodKpisRequest -> PeriodKpis       |
 * | termSheets.list     | GET    | /term-sheets/my                               | - -> TermSheetList                          |
 * | termSheets.view     | GET    | /term-sheets/:id                              | - -> TermSheet (with consentText, documentHash) |
 * | termSheets.sign     | POST   | /term-sheets/:id/sign  (step-up MFA)          | multipart signature,name,consent,consentTextVersion -> TermSheet |
 * | termSheets.decline  | POST   | /term-sheets/:id/decline                      | DeclineTermSheetRequest -> TermSheet        |
 * | settings.profile    | PUT    | /profile                                      | UpdateProfileRequest -> InvesteeProfile     |
 * | settings.company    | PUT    | /company                                      | UpdateCompanyRequest -> InvesteeCompany     |
 * | settings.letterhead | PUT    | /letterhead ; POST /letterhead/logo (multipart `logo`) | UpdateLetterheadRequest -> Letterhead |
 * | threads.start       | POST   | /threads                                      | StartThreadRequest -> InvesteeThread        |
 * | threads.start       | POST   | /threads/:id/messages                         | { text } -> InvesteeConversation            |
 * | threads.list        | GET    | /threads                                      | - -> InvesteeConversation[]                 |
 * | team.list           | GET    | /team                                         | - -> InvesteeTeamMember[]                   |
 * | team.invite         | POST   | /team                                         | invite -> { id, email, status }             |
 * | application         | GET    | /application                                  | - -> InvesteeApplication                    |
 * | requests.list       | GET    | /procurement                                  | - -> { requisitions }                       |
 * | requests.create      | POST   | /procurement                                  | requisition -> InvesteeRequisition          |
 * | capTable            | GET    | /cap-table                                    | - -> CapTableView                           |
 * | capTable.save       | PUT    | /cap-table                                    | shareholders -> CapTableView                |
 * | governance          | GET    | /governance                                   | - -> GovernanceView                         |
 * | governance.consent  | POST   | /governance/consents                          | consent -> GovernanceView                   |
 * | forecast            | GET    | /forecast                                     | - -> ForecastView                           |
 * | forecast.save       | PUT    | /forecast                                     | cells -> ForecastView                       |
 * | vault               | GET    | /vault                                        | - -> { documents }                          |
 * | vault.upload        | POST   | /vault                                        | multipart file -> WorkspaceDocument         |
 * | workspace           | any    | /cap-table/{transactions,certificates,waterfall,classes}, /forecast/{lock,unlock}, /governance/{meetings,actions}, /signature-requests, /share-links, /search, /kpis/{history,export}, /access | the /workspace tools page (one key for the whole family) |
 *
 * POSTs carry an `Idempotency-Key`. Errors are the Nexus `{ error: { code, message } }` body
 * (NVCCZ-style `{ success:false, message }` is also understood). `401 step_up_required` opens
 * the step-up prompt and the call is retried once with the same idempotency key.
 */
export const INVESTEE_ACTION_KEYS = [
  'dashboard',
  'profile',
  'company',
  'reports.schedule',
  'reports.history',
  'reports.detail',
  'reports.template',
  'reports.draft',
  'reports.upload',
  'reports.submit',
  'kpis.submit',
  'termSheets.list',
  'termSheets.view',
  'termSheets.sign',
  'termSheets.decline',
  'settings.profile',
  'settings.company',
  'settings.letterhead',
  'threads.start',
  'threads.list',
  'team.list',
  'team.invite',
  'application',
  'requests.list',
  'requests.create',
  'capTable',
  'capTable.save',
  'governance',
  'governance.consent',
  'forecast',
  'forecast.save',
  'vault',
  'vault.upload',
  'workspace',
] as const;

export type InvesteeActionKey = (typeof INVESTEE_ACTION_KEYS)[number];

export const INVESTEE_API_PREFIX = '/api/v1/investee-portal';

const COMPANY_KEY = 'matanho.investee.company';

/** The workspace (company ref) the user picked in the company switcher; sent as `?company=` on every call (INO-006). */
export function selectedCompany(): string | null {
  try {
    return window.sessionStorage.getItem(COMPANY_KEY);
  } catch {
    return null;
  }
}

export function setSelectedCompany(ref: string | null): void {
  try {
    if (ref) window.sessionStorage.setItem(COMPANY_KEY, ref);
    else window.sessionStorage.removeItem(COMPANY_KEY);
  } catch {
    /* storage unavailable: the API falls back to the first workspace */
  }
}

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
}

export class InvesteeApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly action?: InvesteeActionKey;

  constructor(status: number, code: string, message: string, details?: unknown, action?: InvesteeActionKey) {
    super(message);
    this.name = 'InvesteeApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.action = action;
  }

  /** First few field-level problems from the error envelope, e.g. "contactEmail: Invalid email". */
  fieldProblems(): string[] {
    const d = this.details;
    const out: string[] = [];
    if (Array.isArray(d)) {
      for (const item of d) {
        if (item && typeof item === 'object') {
          const o = item as { path?: unknown; field?: unknown; message?: unknown };
          const path = Array.isArray(o.path) ? o.path.join('.') : String(o.path ?? o.field ?? '');
          if (typeof o.message === 'string') out.push(path ? `${path}: ${o.message}` : o.message);
        }
      }
    } else if (d && typeof d === 'object') {
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) if (typeof v === 'string') out.push(`${k}: ${v}`);
    }
    return out.slice(0, 3);
  }

  /** One line for toasts and error panels. Names the offending fields; never shows the raw status/code pair. */
  describe(): string {
    const fields = this.fieldProblems();
    const base = this.code === 'register_locked' ? 'The register already has transactions. Record a new transaction in Workspace tools > Cap table instead.' : this.message;
    // The server (errorHandler) already appends field reasons to "Validation failed"; do not repeat them.
    const covered = (f: string) => base.includes(f) || base.includes(f.includes(': ') ? f.slice(f.indexOf(': ') + 2) : f);
    return fields.length && !fields.some(covered) ? `${base} - ${fields.join('; ')}` : base;
  }
}

export function isLiveAction(key: InvesteeActionKey, liveActions: readonly string[]): boolean {
  return liveActions.includes('all') || liveActions.includes('*') || liveActions.includes(key);
}

/** Returns true when the user confirmed a fresh step-up code; false when they cancelled. */
export type StepUpHandler = (error: InvesteeApiError) => Promise<boolean>;

let stepUpHandler: StepUpHandler | null = null;

export function setStepUpHandler(handler: StepUpHandler | null): void {
  stepUpHandler = handler;
}

/** POST /api/auth/mfa/step-up */
export async function confirmStepUp(code: string): Promise<void> {
  try {
    await createApiClient({ baseUrl: apiBaseUrl() }).mfaStepUp(code);
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    throw new InvesteeApiError(err.status ?? 0, err.code ?? 'step_up_failed', err.message ?? 'Step-up failed');
  }
}

/** POST /api/auth/mfa/enroll — the factor stays inactive until `confirmEnrolment`. */
export async function startEnrolment(): Promise<{ secret: string; otpauthUri: string }> {
  try {
    return await createApiClient({ baseUrl: apiBaseUrl() }).mfaEnroll();
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    throw new InvesteeApiError(err.status ?? 0, err.code ?? 'enrol_failed', err.message ?? 'Could not start two-factor setup');
  }
}

/** POST /api/auth/mfa/verify — confirms the first code and counts as a fresh step-up. */
export async function confirmEnrolment(code: string): Promise<void> {
  try {
    await createApiClient({ baseUrl: apiBaseUrl() }).mfaVerify(code);
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    throw new InvesteeApiError(err.status ?? 0, err.code ?? 'enrol_failed', err.message ?? 'That code could not be confirmed');
  }
}

/** GET /api/v1/notifications: the signed-in user's own notifications (INO-027). */
export async function loadNotifications(): Promise<NonNullable<InvesteeLivePayload['notifications']>> {
  const res = await fetch(`${apiBaseUrl()}/api/v1/notifications?pageSize=20`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw await toError(res);
  const body = (await res.json()) as { items?: NonNullable<InvesteeLivePayload['notifications']> };
  return Array.isArray(body.items) ? body.items : [];
}

/** GET /api/v1/investee-portal/health: reachable and signed in. */
export async function loadHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${apiBaseUrl()}${INVESTEE_API_PREFIX}/health`, { credentials: 'include', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/** GET /api/v1/platform/flags */
export async function loadPlatformFlags(): Promise<PlatformFlags> {
  const res = await fetch(`${apiBaseUrl()}/api/v1/platform/flags`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as PlatformFlags;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface CallOptions {
  body?: unknown;
  raw?: boolean;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function toError(res: Response, action?: InvesteeActionKey): Promise<InvesteeApiError> {
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }
  const p = (payload ?? {}) as {
    error?: { code?: string; message?: string; details?: unknown } | string;
    message?: string;
    code?: string;
  };
  const errObj = typeof p.error === 'object' && p.error ? p.error : undefined;
  const code = errObj?.code ?? p.code ?? (res.status === 501 ? 'not_implemented' : 'http_error');
  const message =
    errObj?.message ??
    (typeof p.error === 'string' ? p.error : undefined) ??
    p.message ??
    (res.status === 501 ? 'This Investee endpoint is not available yet' : `Request failed with status ${res.status}`);
  return new InvesteeApiError(res.status, code, message, errObj?.details, action);
}

/** Accepts bare payloads and `{ success, data }` envelopes. */
function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

/**
 * The adapter is bound to one allowlist. Each method checks its key before any network call, so a
 * key missing from the allowlist can never reach the API.
 */
export function createInvesteeApi(liveActions: readonly string[]) {
  const base = `${apiBaseUrl()}${INVESTEE_API_PREFIX}`;

  async function call<T>(action: InvesteeActionKey, method: Method, path: string, opts: CallOptions = {}): Promise<T> {
    if (!isLiveAction(action, liveActions)) {
      throw new InvesteeApiError(0, 'not_live', `"${action}" is not enabled for live use`, undefined, action);
    }
    const idempotencyKey = method === 'POST' ? newIdempotencyKey() : undefined;
    const send = async (): Promise<Response> => {
      const headers = new Headers({ Accept: opts.raw ? '*/*' : 'application/json' });
      const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
      if (opts.body !== undefined && !isForm) headers.set('Content-Type', 'application/json');
      if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
      try {
        const company = selectedCompany();
        const url = company ? `${base}${path}${path.includes('?') ? '&' : '?'}company=${encodeURIComponent(company)}` : `${base}${path}`;
        return await fetch(url, {
          method,
          headers,
          credentials: 'include',
          cache: 'no-store',
          body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
        });
      } catch {
        throw new InvesteeApiError(0, 'network_error', 'Could not reach the Matanho API. Check your connection and try again.', undefined, action);
      }
    };

    let res = await send();
    if (!res.ok) {
      let err = await toError(res, action);
      if (err.status === 401 && (err.code === 'step_up_required' || err.code === 'mfa_enrolment_required') && stepUpHandler) {
        const confirmed = await stepUpHandler(err);
        if (!confirmed) throw new InvesteeApiError(401, 'step_up_cancelled', 'Signing was cancelled: the authentication code was not confirmed.', undefined, action);
        res = await send();
        if (!res.ok) err = await toError(res, action);
      }
      if (!res.ok) throw err;
    }
    if (opts.raw) return res as unknown as T;
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return unwrap<T>(text ? JSON.parse(text) : undefined);
  }

  const id = (v: string) => encodeURIComponent(v);

  return {
    liveActions,
    isLive: (key: InvesteeActionKey) => isLiveAction(key, liveActions),

    getDashboard: () => call<InvesteeDashboard>('dashboard', 'GET', '/dashboard'),
    getProfile: () => call<InvesteeProfile>('profile', 'GET', '/profile'),
    getCompany: () => call<InvesteeCompany>('company', 'GET', '/company'),

    getReportingRequests: () => call<ReportingRequest[]>('reports.schedule', 'GET', '/reporting/requests'),
    getFinancialReports: async (): Promise<FinancialReport[]> => {
      const data = await call<FinancialReport[] | FinancialReportPage>('reports.history', 'GET', '/financial-reports');
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    },
    getFinancialReport: (reportId: string) => call<FinancialReport>('reports.detail', 'GET', `/financial-reports/${id(reportId)}`),
    downloadReportTemplate: (reportType: FinancialReportType) =>
      call<Response>('reports.template', 'GET', `/financial-reports/template/${id(reportType)}`, { raw: true }),
    createReportDraft: (kind: FinancialStatementKind, body: FinancialReportDraftRequest) =>
      call<FinancialReportDraft>('reports.draft', 'POST', `/financial-reports/${kind}/draft`, { body }),
    uploadReportFile: (reportId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return call<FinancialReport>('reports.upload', 'POST', `/financial-reports/${id(reportId)}/file`, { body: form });
    },
    submitReport: (reportId: string, notes?: string) =>
      call<unknown>('reports.submit', 'POST', `/financial-reports/submit/${id(reportId)}`, {
        body: notes ? { notes } : {},
      }),
    submitPeriodKpis: (body: SubmitPeriodKpisRequest) => call<PeriodKpis>('kpis.submit', 'POST', '/financial-reports/period-kpis', { body }),

    getTermSheets: async (): Promise<TermSheet[]> => {
      const data = await call<TermSheetList | TermSheet[]>('termSheets.list', 'GET', '/term-sheets/my');
      return Array.isArray(data) ? data : Array.isArray(data?.termSheets) ? data.termSheets : [];
    },
    getTermSheet: (termSheetId: string) => call<TermSheet>('termSheets.view', 'GET', `/term-sheets/${id(termSheetId)}`),
    signTermSheet: (termSheetId: string, req: SignTermSheetRequest) => {
      const form = new FormData();
      form.append('signature', req.signature, 'signature.png');
      form.append('name', req.name);
      form.append('consent', 'true');
      form.append('consentTextVersion', req.consentTextVersion);
      return call<TermSheet>('termSheets.sign', 'POST', `/term-sheets/${id(termSheetId)}/sign`, { body: form });
    },
    declineTermSheet: (termSheetId: string, body: DeclineTermSheetRequest) =>
      call<TermSheet>('termSheets.decline', 'POST', `/term-sheets/${id(termSheetId)}/decline`, { body }),

    updateProfile: (body: UpdateProfileRequest) => call<InvesteeProfile>('settings.profile', 'PUT', '/profile', { body }),
    updateCompany: (body: UpdateCompanyRequest) => call<InvesteeCompany>('settings.company', 'PUT', '/company', { body }),
    updateLetterhead: (body: UpdateLetterheadRequest) => call<Letterhead>('settings.letterhead', 'PUT', '/letterhead', { body }),
    uploadLetterheadLogo: (file: File) => {
      const form = new FormData();
      form.append('logo', file);
      return call<Letterhead>('settings.letterhead', 'POST', '/letterhead/logo', { body: form });
    },

    startThread: (body: StartThreadRequest) =>
      call<InvesteeThread>('threads.start', 'POST', '/threads', {
        body: {
          title: body.subject,
          text: body.recipientTeam ? `${body.body}\n\nFor: ${body.recipientTeam}` : body.body,
        },
      }),
    replyToThread: (threadId: string, text: string) =>
      call<InvesteeConversation>('threads.start', 'POST', `/threads/${id(threadId)}/messages`, { body: { text } }),

    inviteTeamMember: (body: { name?: string; email: string; profile: string; title?: string }) =>
      call<{ id: string; email: string; status: string }>('team.invite', 'POST', '/team', { body }),

    getThreads: () => call<InvesteeConversation[]>('threads.list', 'GET', '/threads'),
    getLetterhead: () => call<Letterhead>('settings.letterhead', 'GET', '/letterhead'),
    getSettings: () => call<InvesteeSettings>('profile', 'GET', '/settings'),
    getKpis: () => call<KpiCentre>('company', 'GET', '/kpis'),
    getWorkspaceSignatures: async () => (await call<{ requests: NonNullable<InvesteeLivePayload['workspaceSignatures']> }>('workspace', 'GET', '/signature-requests')).requests,
    getTeam: () => call<InvesteeTeamMember[]>('team.list', 'GET', '/team'),
    getApplication: () => call<InvesteeApplication>('application', 'GET', '/application'),
    getRequests: () => call<{ requisitions: InvesteeRequisition[] }>('requests.list', 'GET', '/procurement'),
    getRequestsWithTranche: () =>
      call<{ requisitions: InvesteeRequisition[]; tranche: TrancheLedger }>('requests.list', 'GET', '/procurement'),
    submitDraftRequest: (ref: string) => call<InvesteeRequisition>('requests.create', 'POST', `/procurement/${id(ref)}/submit`),
    resubmitRequest: (
      ref: string,
      body: {
        title?: string;
        description?: string;
        type?: string;
        category?: string;
        currency?: string;
        amount?: number;
        needBy?: string;
        priority?: string;
      },
    ) => call<InvesteeRequisition>('requests.create', 'POST', `/procurement/${id(ref)}/resubmit`, { body }),
    createRequest: (body: {
      title: string;
      description?: string;
      type?: string;
      category?: string;
      currency?: string;
      amount?: number;
      needBy?: string;
      priority?: string;
      draft?: boolean;
    }) => call<InvesteeRequisition>('requests.create', 'POST', '/procurement', { body }),
    getCapTable: () => call<CapTableView>('capTable', 'GET', '/cap-table'),
    saveCapTable: (shareholders: { id?: string; name: string; type: string; shares: number }[]) =>
      call<CapTableView>('capTable.save', 'PUT', '/cap-table', { body: { shareholders } }),
    simulateRound: (body: { amount: number; preMoney: number }) =>
      call<{ pricePerShare: number; issued: number; postMoney: number; shareholders: { name: string; type: string; shares: number; pct: number }[] }>('capTable.save', 'POST', '/cap-table/simulate', { body }),
    getGovernance: () => call<GovernanceView>('governance', 'GET', '/governance'),
    getGovernanceFull: () => call<GovernanceFullView>('governance', 'GET', '/governance'),
    requestConsent: (body: { title: string; basis: string; due?: string; note?: string }) =>
      call<GovernanceView>('governance.consent', 'POST', '/governance/consents', { body }),
    getForecast: () => call<ForecastView>('forecast', 'GET', '/forecast'),
    getForecastWorking: () => call<ForecastWorkingView>('forecast', 'GET', '/forecast'),
    saveForecast: (body: { scenario?: string; revenue?: Record<string, number> }) =>
      call<ForecastView>('forecast.save', 'PUT', '/forecast', { body }),
    saveForecastCells: (body: { scenario?: string; cells: ForecastCells; baseVersion: number }) =>
      call<ForecastWorkingView>('forecast.save', 'PUT', '/forecast', { body }),
    submitForecastVersion: () => call<ForecastWorkingView>('forecast.save', 'POST', '/forecast/submit'),
    getForecastVersion: (versionNo: number) => call<ForecastVersionDetail>('forecast', 'GET', `/forecast/versions/${versionNo}`),
    /** Workspace tools (cap-table transactions, board, signature requests, share links, search, access). */
    workspace: <T>(method: Method, path: string, body?: unknown) => call<T>('workspace', method, path, body === undefined ? {} : { body }),
    /** Authenticated file download for the workspace tools (KPI export). */
    workspaceFile: async (path: string): Promise<Blob> => {
      const res = await call<Response>('workspace', 'GET', path, { raw: true });
      return res.blob();
    },
    getVault: () => call<{ documents: WorkspaceDocument[] }>('vault', 'GET', '/vault'),
    uploadVaultFile: (file: File, name?: string) => {
      const form = new FormData();
      form.append('file', file);
      if (name) form.append('name', name);
      form.append('type', 'company');
      return call<WorkspaceDocument>('vault.upload', 'POST', '/vault', { body: form });
    },
    getVaultDownloadUrl: (documentId: string, opts: { version?: number; inline?: boolean } = {}) => {
      const q = new URLSearchParams();
      if (opts.version !== undefined) q.set('version', String(opts.version));
      if (opts.inline) q.set('inline', '1');
      const suffix = q.size ? `?${q}` : '';
      return call<VaultDownloadUrl>('vault', 'GET', `/vault/${id(documentId)}/download-url${suffix}`);
    },
    getVaultVersions: (documentId: string) => call<VaultVersions>('vault', 'GET', `/vault/${id(documentId)}/versions`),
    addVaultVersion: (documentId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return call<VaultVersions>('vault.upload', 'POST', `/vault/${id(documentId)}/versions`, { body: form });
    },
    withdrawVaultDocument: (documentId: string, reason: string) =>
      call<{ id: string; status: string }>('vault.upload', 'POST', `/vault/${id(documentId)}/withdraw`, { body: { reason } }),
  };
}

export type InvesteeApi = ReturnType<typeof createInvesteeApi>;
