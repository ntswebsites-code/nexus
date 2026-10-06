import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLegacyHarness } from './_harness';
import { ok, raw } from '../_helpers/mockApi';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W7 clients, investor-services, onboarding, vault bridges', () => {
  it('extended bridge files reference client-ops API paths', () => {
    const clients = readFileSync(path.join(bridgeDir, 'admin-20-clients.js'), 'utf8');
    expect(clients).toMatch(/\/clients\/summary/);
    expect(clients).toMatch(/\+ '\/360'/);
    expect(clients).toMatch(/change-requests/);
    expect(clients).toMatch(/reveal-identifier/);
    expect(clients).toMatch(/investor-users/);
    expect(clients).toMatch(/openInvestorUsersModal/);
    expect(clients).toMatch(/clearClientsKpis/);
    expect(clients).toMatch(/updatePendingChangesBadge/);
    expect(clients).toMatch(/hydrate\('clients'/);
    expect(clients).toMatch(/\/api\/v1\/reports\/runs/);

    const services = readFileSync(path.join(bridgeDir, 'admin-30-investor-services.js'), 'utf8');
    expect(services).toMatch(/\+ '\/services\/summary'/);
    expect(services).toMatch(/\+ '\/services\/sla-policies'/);
    expect(services).toMatch(/\/services\/requests\//);
    expect(services).toMatch(/coRequestWrite/);
    expect(services).toMatch(/patchServiceKpis/);
    expect(services).toMatch(/serviceMoneyKpis/);
    expect(services).toMatch(/hydrate\('investor-services'/);
    expect(services).toMatch(/clearServiceChrome/);
    expect(services).toMatch(/renderV14LiveTable/);
    expect(services).toMatch(/toggleServiceDemoPanels/);
    expect(services).toMatch(/private-markets\/clients/);
    expect(services).toMatch(/pmClientsByRef/);
    expect(services).toMatch(/formatPmMoney/);
    expect(services).toMatch(/openPortalAccessOverview/);
    expect(services).toMatch(/pmExposureTotals/);

    const kyc = readFileSync(path.join(bridgeDir, 'admin-10-kyc.js'), 'utf8');
    expect(kyc).toMatch(/\+ '\/onboarding\/queue'/);
    expect(kyc).toMatch(/\+ '\/workup'/);
    expect(kyc).toMatch(/\+ '\/approve'/);
    expect(kyc).toMatch(/\+ '\/triage'/);
    expect(kyc).toMatch(/clearOnboardingKpis/);
    expect(kyc).toMatch(/risk-factors/);
    expect(kyc).toMatch(/hydrate\('onboarding'/);

    const vault = readFileSync(path.join(bridgeDir, 'admin-40-documents.js'), 'utf8');
    expect(vault).toMatch(/\+ '\/vault\/summary'/);
    expect(vault).toMatch(/\/hold'/);
    expect(vault).toMatch(/retention-schedules\/apply/);
    expect(vault).toMatch(/\+ '\/vault\/changes'/);
    expect(vault).toMatch(/\+ '\/vault\/pm-evidence'/);
    expect(vault).toMatch(/pm-evidence\/.*\/file/);
    expect(vault).toMatch(/openPmEvidenceModal/);
    expect(vault).toMatch(/clearVaultKpis/);
    expect(vault).toMatch(/hydrate\('vault'/);
  });

  it('clients bridge approves a pending change request', async () => {
    const api = loadLegacyHarness({
      fragment: '14-page-clients.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-20-clients.js'],
      user: {
        name: 'Client Ops',
        email: 'clients@test.local',
        permissions: ['clients.view', 'clients.edit'],
      },
      routes: {
        'GET /api/v1/client-ops/change-requests': raw({
          data: { data: [{ id: 'cr1', kind: 'BANK_ACCOUNT', clientName: 'Test Client', makerName: 'Maker' }] },
        }),
        'POST /api/v1/client-ops/change-requests/cr1/approve': raw({ applied: true }),
        'GET /api/v1/clients': raw({ data: { data: [] } }),
        'GET /api/v1/cash-accounts': raw({ data: { data: [] } }),
        'GET /api/v1/client-ops/clients/summary': raw({ data: { data: [] } }),
        'GET /api/v1/client-ops/staff': raw({ data: [] }),
      },
    });
    const w = window as unknown as {
      mx: { live: boolean; user: { permissions: string[] }; showChangeRequests: () => Promise<void> };
    };
    w.mx.live = true;
    w.mx.user = { permissions: ['clients.view', 'clients.edit'] };
    window.prompt = () => 'Approved for test';
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await w.mx.showChangeRequests();
    await new Promise((r) => setTimeout(r, 40));
    document.querySelector('[data-mx-cr-approve="cr1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    expect(api.calls('POST /api/v1/client-ops/change-requests/cr1/approve').length).toBe(1);
  });

  it('vault bridge uploads PM evidence file via multipart POST', async () => {
    const origCreate = document.createElement.bind(document);
    document.createElement = function (tag: string) {
      const el = origCreate(tag);
      if (tag === 'input') {
        Object.defineProperty(el, 'click', {
          value: function () {
            const file = new File(['evidence'], 'mark.pdf', { type: 'application/pdf' });
            Object.defineProperty(el, 'files', { value: [file] });
            el.onchange?.({} as Event);
          },
        });
      }
      return el;
    };

    const api = loadLegacyHarness({
      fragment: '18-page-vault.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-40-documents.js'],
      user: {
        name: 'Vault Ops',
        email: 'vault@test.local',
        permissions: ['documents.view', 'documents.edit'],
      },
      routes: {
        'GET /api/v1/documents': raw({ data: { data: [] } }),
        'GET /api/v1/client-ops/vault/summary': raw({ total: 0, held: 0, pendingChanges: 0 }),
        'GET /api/v1/client-ops/vault/documents': raw({ data: [] }),
        'GET /api/v1/client-ops/vault/pm-evidence': raw({
          data: {
            data: [{ id: 'ev-1', title: 'Q1 mark support', fund: 'Fund A', mark: 'MK-1', markStatus: 'DRAFT', document: null }],
          },
        }),
        'POST /api/v1/client-ops/vault/pm-evidence/ev-1/file': raw({ document: { ref: 'DOC-1' } }),
      },
    });
    const w = window as unknown as { mx: { live: boolean; user: { permissions: string[] } } };
    w.mx.live = true;
    w.mx.user = { permissions: ['documents.view', 'documents.edit'] };
    const pmBtn = document.createElement('button');
    pmBtn.id = 'v33PmEvidence';
    document.body.appendChild(pmBtn);
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    pmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    document.querySelector('[data-mx-pm-upload]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    document.createElement = origCreate;
    expect(api.calls('POST /api/v1/client-ops/vault/pm-evidence/ev-1/file').length).toBe(1);
  });

  it('w7 DATA_HOOKS patch vault and onboarding scripts', () => {
    expect(existsSync(path.join(repoRoot, 'tools/hooks/w7.mjs'))).toBe(true);

    const v33 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(v33).toMatch(/__mxData\._vaultDocs33/);

    const v35 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v35-enhancements.js'), 'utf8');
    expect(v35).toMatch(/onboardingQueue/);
    expect(v35).toMatch(/renderKycKpis35/);
  });
});
