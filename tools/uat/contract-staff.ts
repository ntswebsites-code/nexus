/**
 * Staff-module contract test (GAP-025): signs in to a RUNNING API as one admin persona and one custodian
 * persona, calls the read endpoint of every module in STAFF_CONTRACTS and validates each returned row against
 * the zod schema in packages/shared/src/staff-contracts.ts. This is what keeps `ops/types.ts` honest.
 * Read-only (GETs only). A 403 (persona lacks the permission) or an empty list is reported as SKIP, never PASS.
 *
 *   CONTRACT_API=http://127.0.0.1:4100 CONTRACT_USERS_FILE=<users.json> npx tsx --tsconfig tools/uat/tsconfig.json tools/uat/contract-staff.ts
 *
 * Env: CONTRACT_API (required), CONTRACT_USERS_FILE (falls back to SEED_USERS_FILE),
 *      CONTRACT_ADMIN_PERSONA (default admin), CONTRACT_CUSTODIAN_PERSONA (default custodian_submitter),
 *      CONTRACT_ORIGIN_ADMIN / CONTRACT_ORIGIN_CUSTODIAN (default ADMIN_PORTAL_URL / CUSTODIAN_PORTAL_URL).
 * Exit code 1 when any module FAILs.
 */
import { STAFF_CONTRACTS } from '../../packages/shared/src/staff-contracts';
import { ApiClient, errorCode, loadPersonas, login } from './lib';

const API = (process.env.CONTRACT_API ?? '').replace(/\/$/, '');
if (!API) {
  console.error('CONTRACT_API is required');
  process.exit(2);
}

const origins = {
  admin: process.env.CONTRACT_ORIGIN_ADMIN ?? process.env.ADMIN_PORTAL_URL ?? 'http://localhost:3100',
  custodian: process.env.CONTRACT_ORIGIN_CUSTODIAN ?? process.env.CUSTODIAN_PORTAL_URL ?? 'http://localhost:3104',
  investor: process.env.INVESTOR_PORTAL_URL ?? 'http://localhost:3101',
} as const;

async function main() {
  const creds = loadPersonas(process.env.CONTRACT_USERS_FILE ?? process.env.SEED_USERS_FILE);
  const personaFor = { admin: process.env.CONTRACT_ADMIN_PERSONA ?? 'admin', custodian: process.env.CONTRACT_CUSTODIAN_PERSONA ?? 'custodian_submitter', investor: 'lp_a_manager' } as const;
  const clients = new Map<string, ApiClient | null>();
  const clientFor = async (portal: 'admin' | 'custodian' | 'investor') => {
    if (clients.has(portal)) return clients.get(portal)!;
    const cred = creds.get(personaFor[portal]);
    let client: ApiClient | null = null;
    if (cred) {
      const c = new ApiClient(API, origins[portal]);
      const r = await login(c, cred, portal);
      if (r.ok) client = c;
      else console.log(`  SKIP  sign-in as ${personaFor[portal]} (${portal}): ${r.reason}`);
    } else console.log(`  SKIP  no persona ${personaFor[portal]} in the users file`);
    clients.set(portal, client);
    return client;
  };

  let failed = 0;
  for (const c of STAFF_CONTRACTS) {
    const portal = c.portal ?? 'admin';
    const client = await clientFor(portal);
    if (!client) {
      console.log(`  SKIP  ${c.module}: no session`);
      continue;
    }
    const res = await client.get(c.path);
    if (res.status === 403) {
      console.log(`  SKIP  ${c.module}: persona lacks ${c.permission}`);
      continue;
    }
    if (res.status !== 200) {
      failed++;
      console.log(`  FAIL  ${c.module}: HTTP ${res.status} ${errorCode(res)}`);
      continue;
    }
    const list = res.body?.[c.listKey];
    if (!Array.isArray(list)) {
      failed++;
      console.log(`  FAIL  ${c.module}: response has no array at "${c.listKey}"`);
      continue;
    }
    if (!list.length) {
      console.log(`  SKIP  ${c.module}: list is empty, nothing to validate`);
      continue;
    }
    const bad = list.map((row, i) => ({ i, r: c.schema.safeParse(row) })).filter((x) => !x.r.success);
    if (bad.length) {
      failed++;
      const first = bad[0]!.r as { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
      const issue = first.error.issues[0]!;
      console.log(`  FAIL  ${c.module}: ${bad.length}/${list.length} rows break the contract, e.g. row ${bad[0]!.i} ${issue.path.join('.')}: ${issue.message}`);
    } else console.log(`  PASS  ${c.module}: ${list.length} rows match`);
  }
  console.log(failed ? `\n${failed} module(s) FAILED` : '\nAll staff contracts hold');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
