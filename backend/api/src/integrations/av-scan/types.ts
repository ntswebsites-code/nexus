import type { AdapterBase, AdapterMeta } from '../core/types';

export interface ScanRequest {
  name: string;
  mime: string;
  data: Buffer;
}
export interface ScanResult {
  verdict: 'clean' | 'infected';
  signature: string | null;
  engine: string;
}

export interface AvScanAdapter extends AdapterBase {
  scan(request: ScanRequest): Promise<ScanResult>;
}

export const meta: AdapterMeta = {
  name: 'av-scan',
  label: 'Antivirus scan',
  gap: 'GAP-A08',
  description: 'Malware scan of every uploaded file before it is stored.',
  requiredEnv: ['AV_SCAN_HOST'],
  vendorCalls: { scan: 'clamd INSTREAM to AV_SCAN_HOST:3310 (or a vendor scan API); reject the upload on FOUND' },
};
