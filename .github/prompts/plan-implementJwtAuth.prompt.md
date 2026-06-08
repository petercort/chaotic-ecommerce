# Plan: Add JWT Auth at the Gateway + Service-to-Service Auth

Add demo-grade authentication: a JWT login endpoint and validation middleware at the api-gateway protecting all `/api/*` routes, plus shared-secret HMAC tokens for internal `order-service → customer/inventory` calls. The gateway uses a custom axios proxy (not http-proxy-middleware), so auth slots in as standard Express middleware. Secrets are distributed the same way existing `POSTGRES_*` vars are.

## Phase 1 — Gateway client auth (issuance + validation)
1. Add `jsonwebtoken` (+ `@types/jsonwebtoken`) to [api-gateway/package.json](api-gateway/package.json).
2. Create `api-gateway/src/auth.ts` — `signUserToken()`, a `verifyUserToken` middleware (reads `Authorization: Bearer`, returns `401` when missing/invalid), and a small demo user store.
3. In [api-gateway/src/index.ts](api-gateway/src/index.ts) — add `POST /auth/login` returning a JWT; mount `verifyUserToken` on `/api/*` after the body parsers (after L27, before routes at L112-115); in `buildProxyHandler` mint and attach an internal service token onto `forwardHeaders` (L83).

## Phase 2 — Service-to-service auth (depends on shared-secret naming from Phase 3)
4. [order-service/src/clients.ts](order-service/src/clients.ts) — sign with `SERVICE_JWT_SECRET` and add an `Authorization` header to all four axios calls (`getCustomer`, `getProduct`, `reserveStock`, `restoreStock`).
5. customer-service — add `jsonwebtoken`; create a service-token verify middleware; `app.use(...)` before the route mount at [customer-service/src/index.ts](customer-service/src/index.ts#L15).
6. inventory-service — same approach; insert before the mount at [inventory-service/src/index.ts](inventory-service/src/index.ts#L11).

## Phase 3 — Infra/config
7. [docker-compose.yml](docker-compose.yml) — add `JWT_SECRET` and `SERVICE_JWT_SECRET` to api-gateway, order-service, customer-service, inventory-service using the `${VAR:-default}` pattern; add to `.env` and ensure `.env` is gitignored.

## Phase 4 — UI + tests (parallel after Phases 1-2)
8. [demo-ui/server.ts](demo-ui/server.ts) + [demo-ui/public/index.html](demo-ui/public/index.html) — add login, store the token, and send `Authorization` on `/api/*` calls.
9. e2e Playwright — add a login helper in [e2e/utils](e2e/utils), update specs/page objects to send the token, and add an unauthorized (`401`) scenario.
10. Unit tests — gateway login + `401`; customer/inventory auth-middleware tests (`401` no token, `200` valid via `.set('Authorization', ...)`); confirm order-service's mocked-client tests still pass.

## Relevant files
- [api-gateway/src/index.ts](api-gateway/src/index.ts) — proxy + middleware stack; insert auth after L27, add `/auth/login`, attach internal token in `buildProxyHandler` (L74-110).
- [order-service/src/clients.ts](order-service/src/clients.ts) — add signed `Authorization` header to axios calls.
- [customer-service/src/index.ts](customer-service/src/index.ts) / [inventory-service/src/index.ts](inventory-service/src/index.ts) — mount service-auth middleware before route mounting.
- [docker-compose.yml](docker-compose.yml) — distribute `JWT_SECRET` / `SERVICE_JWT_SECRET`.

## Verification
1. `npm test` in order-service, customer-service, inventory-service — all green.
2. `npx playwright test` in [e2e](e2e) — green, including the new unauthorized scenario.
3. Manual: `docker compose up`; `curl /api/customers` without a token → `401`; `POST /auth/login` → token; `curl` with `Bearer` → `200`; create an order to confirm internal auth works end-to-end.

## Decisions
- Login endpoint at the gateway (HS256 JWT), shared-secret HMAC for internal calls, all `/api/*` protected, UI + e2e updated.
- Excluded: mTLS, real user DB, token refresh/rotation, migrating incident-service off session auth.

## Further Considerations
1. Security side issue: a real `GITHUB_CLIENT_SECRET` and `SESSION_SECRET` appear in a committed-looking `.env`. Recommend rotating them and confirming `.env` is gitignored as part of this work.
2. Token lifetime: default to a short-lived token (e.g., 1h) with no refresh for the demo.
