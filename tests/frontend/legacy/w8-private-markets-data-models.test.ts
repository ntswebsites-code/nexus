import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLegacyHarness } from './_harness';
import { raw } from '../_helpers/mockApi';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W8 private markets, data, model governance bridges', () => {
  it('bridge files reference the expected API paths', () => {
    const pm = readFileSync(path.join(bridgeDir, 'admin-83-private-markets.js'), 'utf8');
    expect(pm).toMatch(/\/api\/v1\/private-markets/);
    expect(pm).toMatch(/\/summary/);
    expect(pm).toMatch(/\+ '\/marks/);
    expect(pm).toMatch(/\+ '\/approve'/);
    expect(pm).toMatch(/\/pipeline/);
    expect(pm).toMatch(/\/lookthrough\/export/);
    expect(pm).toMatch(/streamDownload/);
    expect(pm).toMatch(/format=xlsx/);
    expect(pm).toMatch(/\/scenarios/);
    expect(pm).toMatch(/\/reject/);
    expect(pm).toMatch(/\/funds/);
    expect(pm).toMatch(/\/commitments/);
    expect(pm).toMatch(/clearPmChrome/);
    expect(pm).toMatch(/togglePmDemoPanels/);
    expect(pm).toMatch(/\/lookthrough/);
    expect(pm).toMatch(/\/stage/);
    expect(pm).toMatch(/diligence.*complete/);
    expect(pm).toMatch(/\/cashflows/);
    expect(pm).toMatch(/openCashflowNoticeModal/);
    expect(pm).toMatch(/openCommitmentDrawer/);
    expect(pm).toMatch(/mxPmPipeline/);
    expect(pm).toMatch(/mxPmScenario/);
    expect(pm).not.toMatch(/window\.prompt\('Investment \/ opportunity name'\)/);

    const lab = readFileSync(path.join(bridgeDir, 'admin-82-portfolio-lab.js'), 'utf8');
    expect(lab).toMatch(/clearLabKpis/);
    expect(lab).toMatch(/patchLabConstructionLive/);
    expect(lab).toMatch(/\/portfolio-lab\/models/);
    expect(lab).toMatch(/\/activate/);
    expect(lab).toMatch(/\/retire/);
    expect(lab).toMatch(/\/clone/);
    expect(lab).toMatch(/mx\.reasonModal/);
    expect(lab).not.toMatch(/window\.prompt\('Retirement reason/);

    const data = readFileSync(path.join(bridgeDir, 'admin-84-data.js'), 'utf8');
    expect(data).toMatch(/\/api\/v1\/data/);
    expect(data).toMatch(/\+ '\/sources'/);
    expect(data).toMatch(/\+ '\/datasets'/);
    expect(data).toMatch(/\+ '\/run'/);
    expect(data).toMatch(/\+ '\/acknowledge'/);
    expect(data).toMatch(/'resolve'/);
    expect(data).toMatch(/'waive'/);
    expect(data).toMatch(/mx\.renderData/);
    expect(data).toMatch(/clearDataKpis/);
    expect(data).toMatch(/\/exceptions\/.*\/assign/);
    expect(data).toMatch(/openSchedulesModal/);
    expect(data).toMatch(/\/schedules\/run-due/);
    expect(data).toMatch(/\/sources\/.*\/upload/);
    expect(data).toMatch(/mx\.reasonModal/);
    expect(data).not.toMatch(/window\.prompt\(act === 'resolve'/);

    const mg = readFileSync(path.join(bridgeDir, 'admin-85-model-governance.js'), 'utf8');
    expect(mg).toMatch(/\/api\/v1\/model-governance/);
    expect(mg).toMatch(/mxMgRegister/);
    expect(mg).not.toMatch(/window\.prompt\('Model name'\)/);
    expect(mg).toMatch(/mxMgReject/);
    expect(mg).not.toMatch(/window\.prompt\('Rejection reason'\)/);
    expect(mg).toMatch(/\/models/);
    expect(mg).toMatch(/\/summary/);
    expect(mg).toMatch(/clearModelKpis/);
    expect(mg).toMatch(/openBindingsModal/);
    expect(mg).toMatch(/openUsageModal/);
    expect(mg).toMatch(/\+ '\/approve'/);
    expect(mg).toMatch(/\+ '\/submit'/);
    expect(mg).toMatch(/\/reviews/);
  });

  it('data bridge resolves a quality exception', async () => {
    const api = loadLegacyHarness({
      fragment: '28-page-data.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-84-data.js'],
      user: {
        name: 'Data Ops',
        email: 'data@test.local',
        permissions: ['operations.view', 'operations.manage'],
      },
      routes: {
        'GET /api/v1/data/sources': raw({ data: [] }),
        'GET /api/v1/data/datasets': raw({ data: [] }),
        'GET /api/v1/data/jobs': raw({ data: [] }),
        'GET /api/v1/data/exceptions': raw({ data: [{ id: 'ex-1', ruleName: 'Null check', dataset: 'holdings', severity: 'HIGH' }] }),
        'GET /api/v1/data/rules': raw({ data: [] }),
        'GET /api/v1/data/summary': raw({ openExceptions: 1 }),
        'POST /api/v1/data/exceptions/ex-1/resolve': raw({ status: 'RESOLVED' }),
      },
    });
    const w = window as unknown as { mx: { live: boolean; user: { permissions: string[] }; renderData: () => void } };
    w.mx.live = true;
    w.mx.user = { permissions: ['operations.view', 'operations.manage'] };
    window.eval('var dataTab = "quality"');
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await (window as unknown as { mx: { refresh: (p: string) => Promise<void> } }).mx.refresh('data');
    w.mx.renderData();
    await new Promise((r) => setTimeout(r, 80));
    const resolveBtn = document.querySelector('[data-data-exc-act="resolve"]') as HTMLButtonElement | null;
    resolveBtn?.click();
    await new Promise((r) => setTimeout(r, 80));
    const modal = document.getElementById('v34Modal');
    const reason = modal?.querySelector('[name="reason"]') as HTMLTextAreaElement | null;
    if (reason) reason.value = 'Fixed upstream mapping issue';
    const confirmBtn = modal?.querySelector('[data-mx-action="1"]') as HTMLButtonElement | null;
    confirmBtn?.click();
    await new Promise((r) => setTimeout(r, 120));
    expect(api.calls('POST /api/v1/data/exceptions/ex-1/resolve').length).toBe(1);
  });

  it('w8 DATA_HOOKS patch prototype scripts', () => {
    expect(existsSync(path.join(repoRoot, 'tools/hooks/w8.mjs'))).toBe(true);

    const inline = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/06-inline.js'), 'utf8');
    expect(inline).toMatch(/__mxData\._privateAssets15/);

    const v33 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(v33).toMatch(/__mxData\._connections33/);
    expect(v33).toMatch(/__mxData\._models33/);
    expect(v33).toMatch(/mx\.renderData/);

    const v37 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v37-enhancements.js'), 'utf8');
    expect(v37).toMatch(/__mxData\._models37/);
    expect(v37).toMatch(/mx\.strict\('model-governance'\)/);
  });
});
