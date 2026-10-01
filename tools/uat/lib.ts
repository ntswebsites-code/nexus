/**
 * Shared helpers for the UAT harness and smoke suite: a cookie-jar HTTP client (one per signed-in
 * persona), persona lookup in the users file, and sign-in with optional TOTP. No dependencies
 * beyond Node 22. Credentials are read from the users file and are never printed.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface PersonaCredentials {
  persona: string;
  email: string;
  password: string;
  /** Base32 TOTP secret, only needed when MFA is enforced for the persona's portal. */
  totpSecret?: string;
}

export function loadPersonas(file: string | undefined): Map<string, PersonaCredentials> {
  if (!file) throw new Error('users file not set (persona credentials, delivered out of band)');
  const entries = JSON.parse(readFileSync(file, 'utf8')) as PersonaCredentials[];
  return new Map(entries.filter((e) => e.persona).map((e) => [e.persona, e]));
}

export interface ApiResponse {
  status: number;
  body: any;
  headers: Headers;
  bytes?: number;
}

export class ApiClient {
  private cookie = new Map<string, string>();

  constructor(
    readonly base: string,
    readonly origin: string,
  ) {}

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw = false): Promise<ApiResponse> {
    const h: Record<string, string> = { Origin: this.origin, Accept: 'application/json', ...headers };
    if (this.cookie.size) h.Cookie = [...this.cookie].map(([k, v]) => `${k}=${v}`).join('; ');
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) h['Content-Type'] = 'application/json';
    const payload = body === undefined ? undefined : multipart ? body : JSON.stringify(body);
    const res = await fetch(`${this.base}${path}`, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      if (/max-age=0/i.test(c) || /expires=thu, 01 jan 1970/i.test(c)) this.cookie.delete(name);
      else this.cookie.set(name, pair!.slice(eq + 1));
    }
    if (raw && !(res.status >= 400 && res.headers.get('content-type')?.includes('application/json'))) {
      const buf = await res.arrayBuffer();
      return { status: res.status, body: null, headers: res.headers, bytes: buf.byteLength };
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get = (path: string) => this.request('GET', path);
  upload = (path: string, form: FormData, headers: Record<string, string> = {}) => this.request('POST', path, form, headers);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), matching the API's src/lib/totp. */
export function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('invalid base32 TOTP secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

export interface LoginResult {
  ok: boolean;
  status: number;
  /** Why sign-in did not complete (never contains credentials). */
  reason?: string;
}

/** `portal` undefined = no portal gate at sign-in (how company-web signs in: access follows CompanyUser). */
export async function login(client: ApiClient, cred: PersonaCredentials, portal: string | undefined): Promise<LoginResult> {
  const res = await client.request('POST', '/api/auth/login', { email: cred.email, password: cred.password, ...(portal ? { portal } : {}) });
  if (res.status !== 200) return { ok: false, status: res.status, reason: `HTTP ${res.status} ${errorCode(res)}`.trim() };
  const mfa = res.body?.mfa ?? res.body?.data?.mfa;
  if (!mfa) return { ok: true, status: 200 };
  if (mfa === 'enroll') return { ok: false, status: 200, reason: 'MFA enrolment required - enrol the persona once in the portal and add totpSecret to the users file' };
  if (!cred.totpSecret) return { ok: false, status: 200, reason: 'MFA required - add totpSecret for this persona to the users file' };
  const v = await client.request('POST', '/api/auth/mfa/verify', { code: totp(cred.totpSecret) });
  return v.status === 200 ? { ok: true, status: 200 } : { ok: false, status: v.status, reason: `MFA verify failed (${v.body?.code ?? v.status})` };
}

/** Error code from either envelope: LP `{code}` or platform `{error: {code, message}}` / `{error: "code"}`. */
export function errorCode(r: ApiResponse): string {
  const b = r.body;
  if (!b || typeof b !== 'object') return '';
  if (typeof b.code === 'string') return b.code;
  if (typeof b.error === 'string') return b.error;
  if (b.error && typeof b.error === 'object') return String(b.error.code ?? b.error.message ?? '');
  return '';
}

export const isNotLive = (r: ApiResponse) => r.status === 503 && r.body?.code === 'LP_DOMAIN_NOT_LIVE';
export const isNotBuilt = (r: ApiResponse) => r.status === 501 || errorCode(r) === 'not_implemented';
