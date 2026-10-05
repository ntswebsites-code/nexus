import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W7 clients, investor-services, onboarding, vault bridges', () => {
  it('extended bridge files reference client-ops API paths', () => {
    const clients = readFileSync(path.join(bridgeDir, 'admin-20-clients.js'), 'utf8');
    expect(clients).toMatch(/\/clients\/summary/);
    expect(clients).toMatch(/\+ '\/360'/);
    expect(clients).toMatch(/change-requests/);
    expect(clients).toMatch(/reveal-identifier/);
    expect(clients).toMatch(/\/api\/v1\/reports\/runs/);

    const services = readFileSync(path.join(bridgeDir, 'admin-30-investor-services.js'), 'utf8');
    expect(services).toMatch(/\+ '\/services\/summary'/);
    expect(services).toMatch(/\+ '\/services\/sla-policies'/);
    expect(services).toMatch(/\/services\/requests\//);
    expect(services).toMatch(/coRequestWrite/);

    const kyc = readFileSync(path.join(bridgeDir, 'admin-10-kyc.js'), 'utf8');
    expect(kyc).toMatch(/\+ '\/onboarding\/queue'/);
    expect(kyc).toMatch(/\+ '\/workup'/);
    expect(kyc).toMatch(/\+ '\/approve'/);
    expect(kyc).toMatch(/\+ '\/triage'/);

    const vault = readFileSync(path.join(bridgeDir, 'admin-40-documents.js'), 'utf8');
    expect(vault).toMatch(/\+ '\/vault\/summary'/);
    expect(vault).toMatch(/\/hold'/);
    expect(vault).toMatch(/retention-schedules\/apply/);
    expect(vault).toMatch(/\+ '\/vault\/changes'/);
    expect(vault).toMatch(/\+ '\/vault\/pm-evidence'/);
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
