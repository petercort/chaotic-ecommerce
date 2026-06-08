---
name: e2e-testing
description: 'Use when adding or reviewing tests in this monorepo. E2E tests (Playwright),Eureka mock and E2E spec template. Triggers: "add e2e tests", "write e2e tests", "playwright".'
---

# Test Conventions Skill

This skill enforces the project test conventions for **E2E tests** (Playwright) and provides templates for Eureka mocks and E2E specs.

## When to use
The user asks to add E2E tests for any service or asks "how should I test this?"
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
