import { HIGH_RISK_COUNTRIES } from '../../modules/kyc/constants';
import type { ScreeningCheck, ScreeningInput, ScreeningOutput } from './types';

/** In-house screening engine: fuzzy name matching against lists the fund imports (sanctions, PEP, adverse media). Pure, no I/O. */
export interface ListEntry {
  name: string;
  aliases?: string[];
  kind: 'sanctions' | 'pep' | 'adverse_media';
  country?: string;
  source?: string;
}

export const normaliseName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(mr|mrs|ms|dr|prof|the|ltd|limited|llc|inc|plc|pvt|co|company|sa)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j <= Math.min(b.length - 1, i + range); j++) {
      if (!bm[j] && a[i] === b[j]) {
        am[i] = bm[j] = true;
        m++;
        break;
      }
    }
  }
  if (!m) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (m / a.length + m / b.length + (m - t / 2) / m) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

/** 0..1 similarity; token order does not matter ("Smith John" matches "John Smith"). */
export function nameScore(x: string, y: string): number {
  const a = normaliseName(x);
  const b = normaliseName(y);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(' ').sort();
  const tb = b.split(' ').sort();
  const sorted = jaroWinkler(ta.join(' '), tb.join(' '));
  // every token of the shorter name must have a close partner in the longer one (guards against one shared first name)
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const tokenFit = small.reduce((s, t) => s + Math.max(...large.map((u) => jaroWinkler(t, u))), 0) / small.length;
  return Math.min(sorted, small.length === 1 && large.length > 1 ? tokenFit * 0.85 : tokenFit);
}

export const REVIEW_AT = 0.88;
export const MATCH_AT = 0.95;

export function bestHit(name: string, list: ListEntry[], kind: ListEntry['kind']) {
  let best: { entry: ListEntry; score: number } | null = null;
  for (const e of list) {
    if (e.kind !== kind) continue;
    for (const n of [e.name, ...(e.aliases ?? [])]) {
      const score = nameScore(name, n);
      if (!best || score > best.score) best = { entry: e, score };
    }
  }
  return best && best.score >= REVIEW_AT ? best : null;
}

export function screenAgainst(i: ScreeningInput, list: ListEntry[], provider: string): ScreeningOutput {
  const names = [i.legalName, ...i.ownerNames].filter(Boolean);
  const hits = (kind: ListEntry['kind']) =>
    names.flatMap((n) => {
      const h = bestHit(n, list, kind);
      return h ? [{ n, ...h }] : [];
    });
  const sanctions = hits('sanctions');
  const peps = hits('pep');
  const media = hits('adverse_media');
  const top = (h: { score: number }[]) => Math.round(Math.max(0, ...h.map((x) => x.score)) * 100);
  const country = `${i.country} ${i.taxResidence}`.toLowerCase();
  const highRiskCountry = HIGH_RISK_COUNTRIES.some((c) => country.includes(c));
  const sanctionsHit = i.declaredSanctions || sanctions.length > 0;
  const pepHit = i.pep || peps.length > 0;
  const adverse = highRiskCountry || i.declaredAdverseMedia || media.length > 0;
  const strong = sanctions.some((h) => h.score >= MATCH_AT) || i.declaredSanctions;
  const results: ScreeningCheck[] = [
    { type: 'sanctions', outcome: strong ? 'Match' : sanctionsHit ? 'Review' : 'Clear', score: sanctionsHit ? Math.max(top(sanctions), i.declaredSanctions ? 92 : 0) : 0 },
    { type: 'pep', outcome: pepHit ? 'Review' : 'Clear', score: pepHit ? Math.max(top(peps), i.pep ? 70 : 0) : 0 },
    { type: 'adverse_media', outcome: adverse ? 'Review' : 'Clear', score: adverse ? Math.max(top(media), 55) : 0 },
    { type: 'document', outcome: i.documentsPresent >= 3 ? 'Clear' : 'Review', score: i.documentsPresent >= 3 ? 0 : 40 },
  ];
  const risk = sanctionsHit || pepHit || highRiskCountry || i.declaredAdverseMedia ? 'High' : media.length || i.expectedInvestment >= 5_000_000 ? 'Medium' : 'Low';
  return { provider, rawRef: `SCR-${i.caseRef.replace(/\D/g, '')}-${Date.now().toString().slice(-4)}`, risk, results };
}

/** Validates a list file: array of entries; bad rows are dropped and counted. */
export function parseList(json: unknown): { entries: ListEntry[]; dropped: number } {
  const rows = Array.isArray(json) ? json : [];
  const entries: ListEntry[] = [];
  for (const r of rows as any[]) {
    if (r && typeof r.name === 'string' && r.name.trim() && ['sanctions', 'pep', 'adverse_media'].includes(r.kind)) {
      entries.push({
        name: r.name.trim(),
        kind: r.kind,
        aliases: Array.isArray(r.aliases) ? r.aliases.filter((a: unknown) => typeof a === 'string') : undefined,
        country: typeof r.country === 'string' ? r.country : undefined,
        source: typeof r.source === 'string' ? r.source : undefined,
      });
    }
  }
  return { entries, dropped: rows.length - entries.length };
}
