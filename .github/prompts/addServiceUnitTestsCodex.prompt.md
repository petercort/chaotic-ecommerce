---
name: add-unit-tests-5.3-Codex
description: Generate unit tests for all services.
---

Add deterministic Jest + supertest service-level tests for customer-service, inventory-service, order-service, notifications-service, and demo-ui by first making each service test-import safe (no auto-listen on import), then adding package-local test harness config and high-value route/proxy behavior cases.

**Steps**
Phase 1: Baseline test harness alignment
1. If a script or devDependency already exists with a different value, leave it unchanged and do not overwrite; only add entries that are absent.' *parallel across all packages*
2. Add Jest toolchain devDependencies where missing (jest, ts-jest, supertest, @types/jest, @types/supertest). *parallel across packages except order-service where deps already exist*
3. Add package-local Jest config files in customer-service, inventory-service, demo-ui, and confirm existing configs in order-service and notifications-service remain consistent. *parallel with step 2*

Phase 2: Make apps test-import safe
1. Update customer-service startup so app.listen only runs when executed directly, and export app/default for supertest. *blocks customer-service tests*
2. Update inventory-service startup similarly and export app/default. *blocks inventory-service tests*
3. Update demo-ui startup similarly and export app/default. *blocks demo-ui tests*
4. Keep order-service and notifications-service startup behavior unchanged (already test-safe).

Phase 3: Customer-service unit/integration tests
1. Create tests for health endpoint and core CRUD happy paths (list, create, update, delete).
2. Add validation/error tests: invalid payload (400), not found (404), duplicate email conflict on create/update (409).
3. Mock eureka module in tests and isolate DB behavior through mocked db module calls to avoid shared state flakiness.

Phase 4: Inventory-service unit/integration tests
1. Create tests for health endpoint, list/filter routes (activeOnly, category, sku, low-stock threshold), create/update/delete happy paths.
2. Add validation/error tests: invalid payload (400), missing resources (404), duplicate SKU conflicts (409).
3. Add reserve/restore behavior tests: successful reserve decrements stock, insufficient stock returns 400, missing product returns 404, restore increments stock.
4. Mock eureka and db module interactions for deterministic route-level behavior.

Phase 5: Order-service gap-fill tests (fast scope)
1. Keep existing comprehensive suite and add only missing targeted tests rather than broad rewrite.
2. Add gap tests around error mapping edges not clearly covered today (for example generic non-Axios downstream failure -> 500 path and optional restore failure logging path) while preserving existing saga/compensation coverage.
3. Maintain existing mocking strategy for clients and db modules.

Phase 6: Notifications-service gap-fill tests (fast scope)
1. Add missing test scripts and missing Jest-related devDependencies in package.json (config file already exists).
2. Extend tests for schema boundaries and channel-specific behavior: subject/body max limits, webhook/sms accepted shapes, empty list behavior.
3. Preserve resetStore beforeEach and eureka mock pattern for deterministic isolation.

Phase 7: Demo-ui server integration-style unit tests
1. Add tests that validate static file serving from public and baseline HTTP behavior.
2. Mock http-proxy-middleware to verify proxy wiring for /api routes.
3. Add proxy error mapping test to assert 502 JSON contract when upstream is unavailable.
4. Validate proxy request behavior assumptions (including stripped origin/referer intent via middleware callback behavior).

Phase 8: Validate and stabilize
1. Run package-local tests individually for each of the five packages.
2. Run all five test suites sequentially to confirm no shared-process interference.
3. Fix flaky assertions by avoiding time/random exact matches and asserting shapes/status/contracts.

**Relevant files**
- /Users/petercort/Documents/petercort/copilot-typescript-demo/customer-service/src/index.ts — add conditional startup and app exports for testability.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/customer-service/package.json — add test scripts and test devDependencies.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/customer-service/jest.config.js — new Jest config for package-local tests.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/customer-service/tests/customer.test.ts — new route-level tests.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/inventory-service/src/index.ts — add conditional startup and app exports for testability.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/inventory-service/package.json — add test scripts and test devDependencies.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/inventory-service/jest.config.js — new Jest config.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/inventory-service/tests/inventory.test.ts — new route and reserve/restore tests.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/order-service/tests/order.test.ts — add narrow gap-fill tests only.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/notifications-service/package.json — add missing test scripts and test devDependencies.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/notifications-service/tests/notifications.test.ts — extend with boundary and channel behavior tests.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/demo-ui/server.ts — add conditional startup and app exports for testability.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/demo-ui/package.json — add test scripts and test devDependencies.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/demo-ui/jest.config.js — new Jest config.
- /Users/petercort/Documents/petercort/copilot-typescript-demo/demo-ui/tests/server.test.ts — new supertest + proxy-mock tests.

**Verification**
1. From /Users/petercort/Documents/petercort/copilot-typescript-demo/customer-service run npm test.
2. From /Users/petercort/Documents/petercort/copilot-typescript-demo/inventory-service run npm test.
3. From /Users/petercort/Documents/petercort/copilot-typescript-demo/order-service run npm test.
4. From /Users/petercort/Documents/petercort/copilot-typescript-demo/notifications-service run npm test.
5. From /Users/petercort/Documents/petercort/copilot-typescript-demo/demo-ui run npm test.
6. Optional aggregate sanity: run all five test commands in sequence from repo root to verify isolation and repeatability.

**Decisions**
- Confirmed scope: gap-fill only for order-service and notifications-service (no broad suite rewrite).
- Confirmed scope: demo-ui tests should be server integration style using supertest with mocked proxy middleware.
- Included: package-local unit/integration test harness and tests for all five services.
- Excluded for this pass: CI workflow wiring and documentation updates unless requested in a follow-up.

**Further Considerations**
1. If test runtime exceeds 30 seconds, split slow route suites into separate files and keep health/smoke tests minimal in default npm test.
2. If future CI isolation is needed, consider adding package-level npm run test:ci scripts with --runInBand for deterministic logs.
3. If you want stronger order-service confidence later, add focused clients.ts breaker behavior tests as a separate follow-up scope.
