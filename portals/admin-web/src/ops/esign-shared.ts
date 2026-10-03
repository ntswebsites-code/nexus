import { apiBase, OpsError, v1 } from './api';

/** Shared types and helpers of the e-signature console (screen, field editor, flows). */

export interface Signer {
  id: string;
  orderNo: number;
  kind: string;
  userId: string | null;
  name: string;
  email: string;
  roleLabel: string | null;
  status: string;
  identityMethod: string | null;
  notifiedAt: string | null;
  reminderCount: number;
  fieldCount: number;
  nextReminderAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  signatureMode: string | null;
  ip: string | null;
  chainHash: string | null;
}
export interface PlacedField {
  id: string;
  signerId: string;
  kind: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string | null;
}
export interface EsignRequest {
  id: string;
  ref: string;
  title: string;
  message: string | null;
  status: string;
  signingOrder: string;
  subjectType: string | null;
  subjectId: string | null;
  documentId: string | null;
  originalSha256: string;
  sealedSha256: string | null;
  chainHead: string | null;
  hasSealed: boolean;
  hasCertificate: boolean;
  expiresAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  voidReason: string | null;
  declineReason: string | null;
  createdAt: string;
  progress: { signed: number; total: number };
  reminder: { intervalDays: number; max: number; custom: boolean };
  bulkBatchId: string | null;
  fields: PlacedField[];
  signers: Signer[];
  events?: { id: string; type: string; at: string; who: string | null; ip: string | null; hash: string }[];
}
export interface ListResponse {
  data: EsignRequest[];
  counts: Record<string, number>;
}
export interface DirEntry {
  userId: string;
  name: string;
  email: string;
  kind: string;
  org?: string;
  role?: string;
  clientId?: string;
  companyId?: string;
}
export interface DocEntry {
  id: string;
  ref: string;
  name: string;
  type: string;
  version: number;
}
export interface LookupRow {
  id: string;
  label: string;
  sub: string;
  status?: string;
}
export interface IntegrityReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}

export const KIND: Record<string, string> = { STAFF: 'Staff', LP: 'LP signatory', INVESTEE: 'Investee', EXTERNAL: 'External (e-mail link)' };
export const esign = (p: string) => v1(`/esign${p}`);

export async function uploadPdf(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/v1/uploads`, { method: 'POST', body: fd, credentials: 'include' });
  } catch {
    throw new OpsError(0, 'network_error', 'The API could not be reached.');
  }
  const json = (await res.json().catch(() => ({}))) as { files?: { id: string }[]; error?: { message?: string } };
  if (!res.ok || !json.files?.[0]) throw new Error(json.error?.message ?? `Upload failed (${res.status})`);
  return json.files[0].id;
}
