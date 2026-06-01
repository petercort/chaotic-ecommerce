--- 
name: test-conventions
description: 'Use when adding tests for any service, adding E2E coverage, adding a chaos scenario, or asking "how should I test this?" in this monorepo. Covers unit tests (Jest + supertest), E2E tests (Playwright), and chaos scenarios (bash). Bundles a Jest config, supertest example, Eureka mock, E2E spec template, and chaos scenario template.'
--- 
# Test Conventions Skill

This skill enforces the project test conventions across three tiers: **unit/integration** (Jest + supertest), **E2E** (Playwright), and **chaos** (bash scenarios).

## When to use
The user asks to add tests for any service, add E2E coverage, add a chaos scenario, or asks "how should I test this?"

## Tier 1 — Unit / Integration Tests (Jest + supertest)

### Procedure

1. **Tests live next to the service** in `<service>/tests/`. Never put them at the repo root.
2. **Add Jest deps** (one-time per service):
   ```
   npm install -D jest ts-jest @types/jest supertest @types/supertest
   ```
3. **Drop the templates** from `assets/` into the service folder:
   - [`assets/jest.config.js.template`](./assets/jest.config.js.template) → `<service>/jest.config.js`
   - [`assets/eureka.mock.ts.template`](./assets/eureka.mock.ts.template) → `<service>/tests/__mocks__/eureka.ts`
   - [`assets/health.test.ts.template`](./assets/health.test.ts.template) → `<service>/tests/health.test.ts`
4. **Add a test script** to the service's `package.json`: `"test": "jest"`.
5. **Mock Eureka in every test file** with `jest.mock('../src/eureka')` — never start the real client.
6. **Use `supertest`** against the Express app, not real HTTP.
7. **Never test against a database**; use an in-memory store or mock `db.ts`.
8. **Call `resetStore()` in `beforeEach`** for services that export an in-memory store — prevents state leaking between tests.

### What good looks like
- Each route file has a matching `<route>.test.ts` covering: happy path (correct status + response shape), 1 validation error (400), 1 not-found (404 where applicable).
- Cross-field zod `.superRefine()` rules are exercised: e.g. `channel='email'` with non-email `to` → 400.
- No test imports `eureka-js-client` directly.
- Test run completes in under 5 seconds per service.

---

## Tier 2 — E2E Tests (Playwright)

E2E tests live in `e2e/tests/<service-name>.spec.ts` and run against the full stack via the api-gateway on `http://localhost:8080`.

### Procedure

1. **Use the template** [`assets/e2e.spec.ts.template`](./assets/e2e.spec.ts.template) — replace `{{SERVICE_NAME}}`, `{{ROUTE}}`, and `{{POST_PAYLOAD}}`.
2. **Wrap all tests** in `test.describe('<Service Label>', ...)`.
3. **Import `API_BASE`** from `../utils/test-data` — never hardcode `localhost:8080`.
4. **Required test coverage** for every new service:
   - `POST` happy path → asserts status 201 + response shape (`id`, relevant fields).
   - `POST` invalid body → asserts status 400 + response has `errors` key.
   - `POST` cross-field validation failure (e.g. `channel='email'` with non-email `to`) → 400.
   - `GET` listing → asserts 200, response is an array.
5. **Do not share state between tests.** E2E tests hit the live service so there is no `resetStore()` available — design assertions to tolerate pre-existing data (e.g. `toBeGreaterThanOrEqual(1)` not `toBe(1)`).
6. **Screenshots** are optional but follow the pattern in `customers.spec.ts` when adding UI tests.

### What good looks like
- 4+ tests per service (POST 201, POST 400 schema, POST 400 cross-field, GET 200 array).
- No hardcoded ports or URLs other than `API_BASE`.
- Tests pass with `workers: 1` (the playwright config default) — no parallel state conflicts.

---

## Tier 3 — Chaos Scenarios (bash)

Chaos scenarios live in `scenarios/s<N>-<description>.sh` and follow the runbook pattern established by S1–S8.

### Procedure

1. **Use the template** [`assets/chaos-scenario.sh.template`](./assets/chaos-scenario.sh.template) — replace `{{SCENARIO_NUMBER}}`, `{{SERVICE_NAME}}`, `{{SERVICE_PORT}}`, and `{{HYPOTHESIS}}`.
2. **Always source `scripts/assert.sh`** for the `assert_eq`, `assert_ge` helpers.
3. **Always call `verify-steady-state.sh`** as the first step — do not start the experiment if the stack is already degraded.
4. **Always register a `cleanup` trap** (`trap cleanup EXIT`) that restarts the affected container(s) so the stack is left healthy.
5. **Record results** to `results/s<N>-requests.csv` with columns `seq,http_code,elapsed_ms,result`.
6. **Structure** every scenario as labelled steps: `[1/N] Verify steady state`, `[2/N] Inject fault`, `[3/N] Observe`, `[4/N] Restore`, `[5/N] Assert`.
7. **Add the scenario** to `scenarios/run-all-chaos.sh` so it runs in the nightly suite.

### What good looks like
- One clear hypothesis at the top: *"Service X continues serving traffic for ≥Y seconds after fault Z."*
- Pass/fail printed at the end with an exit code (`exit 0` / `exit 1`).
- Cleanup always runs — even on error — so a failed experiment never leaves the stack broken.
- Results CSV is written before assertions so partial data is preserved on failure.
