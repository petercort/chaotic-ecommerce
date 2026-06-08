# CI Hardening and Service Test Task List

## Goal

Replace fixed startup delays in CI with health-based readiness checks, then add narrow automated tests around the highest-risk backend slices:
- the order creation saga in `order-service`
- the proxy and failure-mapping behavior in `api-gateway`

Current issues:
- active workflows rely on `sleep` instead of actual readiness checks
- service-level tests are sparse and uneven
- core business logic is mostly validated indirectly through E2E, load, and chaos coverage

---

## Workstream A: Replace brittle CI sleeps

### 1. Inventory the active readiness waits

Tasks:
- Review `.github/workflows/pr-smoke-test.yml` for fixed waits.
- Review `.github/workflows/e2e.yml` for fixed waits.
- Review `.github/workflows/resilience-smoke.yml` for fixed waits.
- Note any duplicate wait logic that should be centralized.

Output:
- A short list of workflows and the services each one must wait for.

### 2. Add a reusable readiness helper

Tasks:
- Create a small shell helper under `scripts/` for polling service health endpoints.
- Support configurable timeout, interval, and target URL.
- Make failure output clear enough for CI logs.
- Return non-zero when readiness is not reached.

Suggested behavior:
- Poll `GET /actuator/health`
- Succeed only when the response body indicates `UP`
- Print elapsed time and target URL on failure

Output:
- One reusable readiness script instead of duplicated `curl` loops and `sleep` calls.

### 3. Update `pr-smoke-test.yml`

Tasks:
- Remove the fixed wait.
- Wait on the minimum required service set before k6 smoke runs.
- Prefer waiting on the gateway health endpoint plus any hard dependencies that have historically raced.
- Reassess whether Java setup and `pom.xml` path filters still belong in this workflow.

Validation:
- Confirm the workflow fails fast when services do not start.
- Confirm the workflow proceeds as soon as services are healthy.

### 4. Update `e2e.yml`

Tasks:
- Remove the fixed wait after starting backend services.
- Wait for the gateway to report healthy.
- Wait for the demo UI to be reachable before launching Playwright.
- Keep the workflow output readable when a service fails to come up.
- Reassess stale Java-era setup if it is no longer needed.

Validation:
- Confirm Playwright starts only after both backend and UI are ready.
- Confirm startup failures are visible in workflow logs.

### 5. Update `resilience-smoke.yml`

Tasks:
- Remove the fixed wait.
- Replace it with readiness polling against the services required by `verify-steady-state.sh`.
- Ensure the readiness logic and the steady-state assertions do not conflict.

Validation:
- Confirm the workflow does not begin steady-state checks before services are available.

### 6. Standardize workflow readiness behavior

Tasks:
- Use the same helper and conventions across all touched workflows.
- Keep timeouts consistent unless a workflow truly needs a different threshold.
- Avoid duplicating ad hoc `curl` loops in YAML.

Acceptance criteria:
- No fixed `sleep` remains as the primary readiness mechanism in the active workflows.
- CI logs clearly show what service was awaited and why a readiness check failed.

---

## Workstream B: Add narrow tests for `order-service`

### 1. Establish a service-level test harness

Tasks:
- Choose the package-level test framework for `order-service`.
- Add required dev dependencies.
- Add a test script to `order-service/package.json`.
- Configure the test runner for TypeScript source and module format used by the service.

Output:
- `npm test` or a similarly clear package script that runs only `order-service` tests.

### 2. Make the order saga testable at the right seam

Tasks:
- Identify the smallest seam that allows mocking customer and inventory clients.
- Avoid over-coupling tests to SQLite internals unless persistence verification requires it.
- If needed, extract or expose the saga logic in a way that supports deterministic tests.

Validation target:
- Tests should exercise business behavior, not just route wiring.

### 3. Add success-path order saga tests

Tasks:
- Test that a valid order creates a persisted order with expected totals and items.
- Test that stock reservation is attempted for each requested item.
- Test that the created order has the expected default status.

### 4. Add failure-path order saga tests

Tasks:
- Test customer-not-found behavior.
- Test product-not-found behavior.
- Test insufficient-stock behavior.
- Test downstream service errors mapped through the current error handling.

### 5. Add compensation tests

Tasks:
- Test that already reserved items are restored if a later item fails.
- Verify restore calls are made with the correct product IDs and quantities.
- Ensure no order is persisted after compensation-triggering failures.

### 6. Add route-level edge tests

Tasks:
- Test invalid create-order payloads return 400.
- Test status updates validate allowed states.
- Test status update on a missing order returns 404.
- Test order lookup routes for missing resources where helpful.

Acceptance criteria:
- The order-service package has deterministic tests covering success, validation, and compensation behavior.
- The tests can run without bringing up the full stack.

---

## Workstream C: Add narrow tests for `api-gateway`

### 1. Establish a service-level test harness

Tasks:
- Choose the package-level test framework for `api-gateway`.
- Add required dev dependencies.
- Add a test script to `api-gateway/package.json`.
- Ensure tests can run without contacting real downstream services.

Output:
- A package-local test command for gateway behavior.

### 2. Identify the test seam for proxy logic

Tasks:
- Test at the HTTP layer where practical so route wiring and proxy behavior are both exercised.
- Mock the forwarding layer or axios requests rather than spinning up all downstream services.
- Keep circuit breaker behavior testable without introducing flaky timing assumptions.

### 3. Add proxy routing tests

Tasks:
- Verify `/api/customers*` forwards to the customer base URL.
- Verify `/api/products*` forwards to the inventory base URL.
- Verify `/api/orders*` forwards to the order base URL.
- Verify `/api/notifications*` forwards to the notifications base URL.

### 4. Add request-shape forwarding tests

Tasks:
- Verify query parameters are forwarded.
- Verify JSON request bodies are forwarded.
- Verify non-hop-by-hop headers needed by the app are preserved.
- Verify upstream response status and body are returned unchanged where expected.

### 5. Add failure-mapping tests

Tasks:
- Verify open-circuit failures return 503 with the correct service label.
- Verify generic forwarding failures return 502 with the correct service label.
- Verify health endpoint behavior remains stable.

Acceptance criteria:
- The api-gateway package has deterministic tests for route selection and failure mapping.
- Tests run without requiring customer, inventory, order, or notifications services to be live.

---

## Workstream D: Wire tests into local development and CI

### 1. Add package scripts

Tasks:
- Add clear test scripts to `order-service/package.json`.
- Add clear test scripts to `api-gateway/package.json`.
- Ensure script names are consistent with existing package conventions.

### 2. Add focused CI execution

Tasks:
- Add a CI step or job that runs the new narrow tests before broader smoke or E2E validation.
- Keep the scope narrow enough that failures point directly to the touched service.
- Avoid making the E2E workflow the only signal for backend regressions.

### 3. Document how to run the tests

Tasks:
- Update `docs/TESTING_CAPABILITIES.md` or a related testing doc.
- Document the local commands for running just the order-service tests.
- Document the local commands for running just the api-gateway tests.

Acceptance criteria:
- A contributor can run service-level tests directly from the package they are changing.
- CI runs those narrow tests without depending on the whole stack.

---

## Recommended Order of Work

1. Add the reusable readiness helper.
2. Replace workflow sleeps with health-based waits.
3. Add `order-service` test harness.
4. Add order saga and compensation tests.
5. Add `api-gateway` test harness.
6. Add gateway proxy and failure-mapping tests.
7. Wire the new tests into CI.
8. Update testing documentation.

---

## Suggested Validation Commands

```bash
./build.sh
bash scripts/verify-steady-state.sh
cd order-service && npm test
cd api-gateway && npm test
```

If workflow changes are made, also validate locally where practical:

```bash
./run.sh
curl http://localhost:8080/actuator/health
curl http://localhost:8090
```

---

## Definition of Done

- Active workflows no longer rely on blind startup sleeps.
- Readiness failures are reported with useful logs.
- `order-service` has narrow tests covering success, validation, and compensation.
- `api-gateway` has narrow tests covering proxy routing and failure mapping.
- The new tests are runnable locally and in CI with clear package scripts.