# Frontend tests (no browser)

Vitest + jsdom + Testing Library. No real browser, no real network.

## Run

```
npm run test:frontend            # everything, dot reporter, failures only
npm run test:frontend:admin      # also: investor, onboarding, company, custodian, portal-kit, shared
npx vitest run --project admin-web tests/frontend/admin-web/foo.test.tsx   # one file
```

Config: `vitest.config.mts` (one project per portal/package, aliases `@/*` to that portal's `src`, plus `@matanho/portal-kit`, `@matanho/shared`, `@matanho/legacy-runtime`). Tests live in `tests/frontend/<project>/**/*.test.{ts,tsx}`.

## Setup (`setup.ts`, automatic)

- `next/navigation`, `next/link`, `next/image`, `next/headers` are mocked. Assert navigation with `router.push` / `router.replace`; set the URL with `setRoute('/ops/funds', 'tab=x')`; `redirect()` throws `NEXT_REDIRECT:<url>`.
- `fetch` throws on any request unless you install `mockApi(...)`. CSS is ignored.
- Reset between tests (router, fetch, DOM).

## Helpers (`import ... from '../_helpers'`)

- `mockApi(routes)`: routes keyed `'METHOD /path/:param'`; reply is `ok(data)`, `fail(status, code, message, details)`, `raw(body)`, or `(req, params) => result`. Returns `{ requests, calls(key), on(key, reply) }`. Each request records `method, path, query, body, headers, idempotencyKey, ifMatch`.
- Assertions: `expectCalled(api, key, times=1)`, `expectNotCalled`, `expectBody(req, partial)`, `expectIdempotencyKey(req)`, `expectIfMatch(req, value?)`, `expectNoUnmocked()`.
- `loginAs('admin'|'ops'|'investor'|'company'|'custodian'|'applicant'|null, { user, mfa })`: route for `GET /api/auth/me`; spread into `mockApi`. `makeUser(persona, overrides)` builds an `AuthUser`.
- `renderWithProviders(ui, { providers: [SessionProvider] })`: returns RTL result plus `user` (userEvent).
- Re-exports `screen, waitFor, within, fireEvent, router, setRoute`.

## Example

```tsx
const api = mockApi({ ...loginAs('admin'), 'POST /api/v1/ops/funds': ok({ id: 'f1' }, 201) });
const { user } = renderWithProviders(<Page />, { providers: [SessionProvider] });
await user.click(await screen.findByRole('button', { name: 'Create' }));
const [req] = expectCalled(api, 'POST /api/v1/ops/funds');
expectIdempotencyKey(req);
```

## Legacy admin harness (`tests/frontend/legacy/`)

W0+ page wiring tests load prototype fragments in jsdom without a browser:

```ts
import { loadLegacyHarness, expectNoOpsConsoleLink } from '../legacy/_harness';

loadLegacyHarness({ fragment: '06-page-command.html', scripts: ['01-inline.js'], routes: { ... } });
expectNoOpsConsoleLink();
```

`loadLegacyHarness` runs `mx-core.js`, portal bridge scripts (from `public/legacy/js/bridge/`), then the listed prototype scripts with `mockApi` fetch. Run `node tools/legacy-bridge.mjs` before legacy tests if bridge sources changed.

## Conventions

- One file per flow, named after the flow (`create-fund.test.tsx`); put the QA issue id in the `describe`/`it` name where one exists (`QA-123: ...`).
- Query by role/label/text like a user; assert on requests (method, path, body, headers) and visible outcomes.
- No snapshot tests. No real network. No fake product code: mock only the boundary (fetch, next/*).
- Do not edit product source from tests; add stubs in `setup.ts` if an import cannot load under jsdom.
- jsdom limits: no layout, no real focus/scroll geometry, no canvas/charts rendering, no CSS-driven visibility; those need a real browser and are out of scope here.
