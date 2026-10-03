import type { AdapterBase } from '../core/types';
import type { AvScanAdapter, ScanRequest, ScanResult } from './types';

/** The industry-standard harmless EICAR test string. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export class FakeAvScan implements AvScanAdapter, AdapterBase {
  async scan({ data }: ScanRequest): Promise<ScanResult> {
    const infected = data.includes(Buffer.from(EICAR, 'latin1'));
    return { verdict: infected ? 'infected' : 'clean', signature: infected ? 'Eicar-Test-Signature' : null, engine: 'fake-av-1' };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter: flags files containing the EICAR test string' };
  }
}
