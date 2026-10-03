import { HIGH_RISK_COUNTRIES, STUB_WATCHLIST } from '../../modules/kyc/constants';
import type { ScreeningAdapter, ScreeningInput, ScreeningOutput } from './types';

export const FAKE_SCREENING_PROVIDER = 'stub-screening-v1';

/** The former `kyc/screening.ts` stub logic, moved here unchanged so fake mode behaves as before. */
export class FakeScreening implements ScreeningAdapter {
  async screen(i: ScreeningInput): Promise<ScreeningOutput> {
    const names = [i.legalName, ...i.ownerNames].map((n) => n.toLowerCase());
    const sanctionsHit = i.declaredSanctions || names.some((n) => STUB_WATCHLIST.some((w) => n.includes(w)));
    const country = `${i.country} ${i.taxResidence}`.toLowerCase();
    const highRiskCountry = HIGH_RISK_COUNTRIES.some((c) => country.includes(c));
    const adverse = highRiskCountry || i.declaredAdverseMedia;
    const results: ScreeningOutput['results'] = [
      { type: 'sanctions', outcome: sanctionsHit ? 'Match' : 'Clear', score: sanctionsHit ? 92 : 0 },
      { type: 'pep', outcome: i.pep ? 'Review' : 'Clear', score: i.pep ? 70 : 0 },
      { type: 'adverse_media', outcome: adverse ? 'Review' : 'Clear', score: adverse ? 55 : 0 },
      { type: 'document', outcome: i.documentsPresent >= 3 ? 'Clear' : 'Review', score: i.documentsPresent >= 3 ? 0 : 40 },
    ];
    const risk = sanctionsHit || i.pep || highRiskCountry || i.declaredAdverseMedia ? 'High' : i.expectedInvestment >= 5_000_000 ? 'Medium' : 'Low';
    const rawRef = `SCR-${i.caseRef.replace(/\D/g, '')}-${Date.now().toString().slice(-4)}`;
    return { provider: FAKE_SCREENING_PROVIDER, rawRef, risk, results };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter: local watch list and country list (stub-screening-v1)' };
  }
}
