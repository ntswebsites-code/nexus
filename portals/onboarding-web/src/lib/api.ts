/** Typed client for the public onboarding API (/api/v1/public). The draft token authorises one application. */

const base = () => `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100').replace(/\/+$/, '')}/api/v1/public`;

export class OnboardingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface Owner {
  name: string;
  nationality: string;
  id: string;
  pct: string;
}
export interface Person {
  name: string;
  role: string;
  email: string;
}
export interface EvidenceRow {
  slot: string;
  label: string;
  status: string;
  name: string | null;
  size: number | null;
  mime: string | null;
  sha256: string | null;
  scanStatus: string | null;
}
export interface ApplicationView {
  id: string;
  ref: string | null;
  status: string;
  email: string;
  form: Record<string, string>;
  taxIdOnFile: boolean;
  bankAccountOnFile: boolean;
  ownerDetails: Owner[];
  signatories: Person[];
  directors: Person[];
  evidence: EvidenceRow[];
  requiredSlots: string[];
  requestedSlots: string[];
  caseStage: string | null;
}
export interface Meta {
  investorTypes: { value: string; entity: boolean; requiredSlots: string[] }[];
  slots: { key: string; label: string }[];
  maxUploadMb: number;
  acceptedFileTypes: string[];
}
export interface ReadinessCheck {
  name: string;
  state: 'good' | 'warn' | 'neutral';
  detail: string;
  right: string;
}

export interface ReadinessView {
  score: number;
  checks: ReadinessCheck[];
  riskBand: 'Pending' | 'LOW' | 'MEDIUM' | 'HIGH';
  triageRun: boolean;
  triage: {
    riskBand: string;
    summary: string;
    flags: string[];
    nextSteps: string[];
    model: string;
    at: string;
    advisory: true;
  } | null;
}

export interface TrackerStatus {
  ref: string | null;
  submitted: boolean;
  submittedAt?: string | null;
  stage: { key: string; label: string };
  steps: { key: string; label: string; done: boolean; current: boolean }[];
  updates: { at: string; title: string; detail: string | null }[];
  requested: { slots: { key: string; label: string; received: boolean }[]; message: string | null; dueAt: string | null } | null;
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('X-Draft-Token', token);
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { ...init, headers });
  } catch {
    throw new OnboardingApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new OnboardingApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return body as T;
}

const json = (v: unknown): RequestInit => ({ body: JSON.stringify(v) });

export interface SavePayload {
  form: Record<string, string>;
  owners: Owner[];
  signatories: Person[];
  directors: Person[];
}

export const api = {
  meta: () => call<Meta>('/onboarding/meta'),
  create: (b: { email: string; applicantType: string; name?: string }) =>
    call<{ id: string; token: string }>('/applications', { method: 'POST', ...json({ ...b, sendLink: true }) }),
  get: (id: string, token: string) => call<{ application: ApplicationView }>(`/applications/${id}`, {}, token).then((r) => r.application),
  save: (id: string, token: string, p: SavePayload) => call<{ ok: true; savedAt: string }>(`/applications/${id}`, { method: 'PATCH', ...json(p) }, token),
  upload: (id: string, token: string, slot: string, file: File) => {
    const fd = new FormData();
    fd.set('slot', slot);
    fd.set('file', file);
    return call<{ slot: string; name: string; size: number; scanStatus: string }>(`/applications/${id}/evidence`, { method: 'POST', body: fd }, token);
  },
  submit: (id: string, token: string, p: SavePayload) =>
    call<{ ref: string; status: string; readiness?: { score: number; riskBand: string } }>(`/applications/${id}/submit`, { method: 'POST', ...json({ consent: true, ...p }) }, token),
  readiness: (id: string, token: string) => call<{ readiness: ReadinessView }>(`/applications/${id}/readiness`, {}, token).then((r) => r.readiness),
  triage: (id: string, token: string) => call<{ data: NonNullable<ReadinessView['triage']> }>(`/applications/${id}/triage`, { method: 'POST', ...json({}) }, token).then((r) => r.data),
  status: (id: string, token: string) => call<{ status: TrackerStatus }>(`/applications/${id}/status`, {}, token).then((r) => r.status),
  reply: (id: string, token: string, message: string) => call<{ ok: true; duplicate: boolean }>(`/applications/${id}/reply`, { method: 'POST', ...json({ message }) }, token),
  requestResumeLink: (email: string) => call<{ ok: true }>('/onboarding/resume-link', { method: 'POST', ...json({ email }) }),
  exchangeLink: (link: string) => call<{ id: string; token: string }>('/onboarding/resume', { method: 'POST', ...json({ link }) }),
};

// ------------------------------------------------------------------ session (this browser only)

const KEY = 'matanho-onboarding-session-v1';
export interface Session {
  id: string;
  token: string;
}
export function loadSession(): Session | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null;
    return v && typeof v.id === 'string' && typeof v.token === 'string' ? v : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: the emailed link still works */
  }
}
export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Test hook: jsdom cannot spy on `location.replace`; production uses it for status redirects. */
let navigateHandler: (href: string) => void = (href) => {
  window.location.replace(href);
};
export function setNavigateHandler(fn: (href: string) => void) {
  navigateHandler = fn;
}
export function resetNavigateHandler() {
  navigateHandler = (href) => window.location.replace(href);
}
export function navigateTo(href: string) {
  navigateHandler(href);
}
