'use client';

import { ImportPanel } from '@/ops/imports';
import { PageHeader } from '@/ops/ui';

export default function ImportsPage() {
  return (
    <>
      <PageHeader kicker="Operations" title="Data imports" subtitle="Upload a CSV, XLSX or JSON file, review the dry run with its row errors and control totals, then commit. Every preview and commit is audited." />
      <ImportPanel />
    </>
  );
}
