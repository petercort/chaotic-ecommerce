---
name: add-unit-tests-Sonnet
description: Generate unit tests for all services.
---

### Phase 1 — Bootstrap missing test infrastructure *(customer-service + inventory-service, in parallel)*

Both services are missing jest, supertest, jest.config.js, and any tests.

**For each:**
1. Install `jest ts-jest @types/jest supertest @types/supertest` as devDependencies
2. Add `jest.config.js` (copy from api-gateway pattern)
3. Add `"test": "jest"` to `package.json` scripts
4. Create `tests/__mocks__/eureka.ts` — mock `startEurekaClient` as a no-op
5. Create `tests/customers.test.ts` / `tests/products.test.ts` with full route coverage (see below)

**customer-service coverage:**
- `GET /api/customers` → 200, array
- `GET /api/customers/:id` → 200 + 404
- `GET /api/customers/email/:email` → 200
- `POST /api/customers` → 201, 400 (Zod), 409 (duplicate email)
- `PUT /api/customers/:id` → 200 + 404
- `DELETE /api/customers/:id` → 204 + 404
- `GET /actuator/health` → 200 `{ status: "UP" }`

**inventory-service coverage:**
- `GET /api/products` → 200, `?activeOnly=true` filter
- `GET /api/products/:id` → 200 + 404
- `GET /api/products/sku/:sku`, `/category/:category`, `/low-stock` → 200
- `POST /api/products` → 201, 400, 409 (duplicate SKU)
- `PUT /api/products/:id` → 200 + 404
- `DELETE /api/products/:id` → 204
- `POST /api/products/:id/reserve` → 200 (sufficient stock), 400 (insufficient)
- `POST /api/products/:id/restore` → 200
- `GET /actuator/health` → 200

**DB mocking strategy:** mock `../src/db` (per the test-conventions skill: "Never test against a database") rather than relying on seed data.

---

### Phase 2 — Expand existing tests *(order-service + notifications-service, in parallel)*

**order-service** already has `order-service/tests/order.test.ts` (473 lines). Add:
- Saga compensation with 2+ items (first item reserved, second fails → both restored)
- `GET /api/orders/status/:status` for each valid status enum value

**notifications-service** already has `notifications-service/tests/notifications.test.ts` (only 50 lines). Expand:
- `POST` with all optional fields (`type`, `priority`) → 201
- `POST` with `channel='email'` and non-email `to` → 400 (cross-field Zod rule per skill)
- `POST` missing required fields (`subject`, `body`) → 400
- `GET /api/notifications` → 200, returns array with proper shape

---

### Phase 3 — demo-ui *(parallel with Phase 2)*

`demo-ui/server.ts` is 29 lines — just a proxy + static file server. Testable surface is small.

1. Install test deps
2. Add `jest.config.js`
3. Create `tests/server.test.ts` covering:
   - `GET /` → 200, returns HTML
   - Proxy error handler → 502 when upstream fails

---

### Relevant Files
- `api-gateway/jest.config.js` — config to copy
- `api-gateway/tests/gateway.test.ts` — mock + supertest pattern reference
- `order-service/tests/order.test.ts` — db mock pattern reference
- `notifications-service/tests/notifications.test.ts` — resetStore pattern
- `customer-service/src/routes.ts`, `customer-service/src/db.ts`
- `inventory-service/src/routes.ts`, `inventory-service/src/db.ts`
- `demo-ui/server.ts`

### Verification
1. `cd customer-service && npm test` → all pass
2. `cd inventory-service && npm test` → all pass
3. `cd order-service && npm test` → all pass (no regressions)
4. `cd notifications-service && npm test` → all pass
5. `cd demo-ui && npm test` → all pass
