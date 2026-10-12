/* Scrub production credentials from the committed audit configs. */
import { readFileSync, writeFileSync } from 'node:fs';

for (const name of ['admin', 'company', 'custodian', 'investor', 'onboarding']) {
  const p = `tools/uat/probes/prod-audit-${name}.json`;
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  if (cfg.password) cfg.password = '<from /opt/matanho-nexus/secrets/users.json on the production host - never committed>';
  writeFileSync(p, JSON.stringify(cfg, null, 1) + '\n');
  console.log('scrubbed', p);
}
