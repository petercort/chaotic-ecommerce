## Summary
Public API routes exposed through the api-gateway (`/api/customers`, `/api/products`, `/api/orders`, `/api/notifications`) currently have **no authentication or authorization**. Inter-service calls (order-service → customer-service / inventory-service) also have no auth and rely solely on Docker Compose network isolation.

## Current state
- `api-gateway/src/index.ts` proxies all routes with no auth guard.
- `order-service/src/clients.ts` calls downstream services with no auth headers.
- Only `incident-service` has auth (GitHub OAuth for Copilot Extensions).

## Proposed change
- Add JWT bearer token validation middleware at the api-gateway for all `/api/*` routes.
- Add service-to-service authentication (signed headers or mTLS) for internal calls.
- Document token issuance/verification flow.

## Acceptance criteria
- [ ] Requests to protected routes without a valid token return `401`.
- [ ] Valid tokens pass through to downstream services.
- [ ] order-service → customer/inventory calls include and verify a service credential.
- [ ] Tests cover authorized and unauthorized paths.

Priority: 🔴 High impact — security & correctness

## Implementation design

### 1) Gateway JWT validation

- All `/api/*` routes in `api-gateway` are protected by bearer token middleware.
- Requests without `Authorization: Bearer <token>` return `401`.
- Invalid or unverifiable tokens return `401`.
- Health endpoint `/actuator/health` remains unauthenticated.

Validation settings:
- Algorithm: `HS256`
- Secret: `JWT_SECRET`
- Optional issuer check: `JWT_ISSUER`
- Optional audience check: `JWT_AUDIENCE`

### 2) Downstream credential verification (service-to-service)

In addition to forwarding client auth, upstream callers sign each request using HMAC and downstream services verify it.

Headers:
- `x-service-name`
- `x-service-timestamp` (unix millis)
- `x-service-signature`

Signature payload format:

`<service-name>:<HTTP_METHOD>:<path-and-query>:<timestamp>`

Signature algorithm:
- HMAC-SHA256 with `SERVICE_AUTH_SECRET`

Replay window:
- Requests older than `SERVICE_AUTH_MAX_SKEW_MS` (default 5 minutes) are rejected.

### 3) Current traffic model

- `api-gateway` validates JWT and signs proxied downstream requests.
- `customer-service` verifies service signatures for `/api/customers/*`.
- `inventory-service` verifies service signatures for `/api/products/*`.
- `order-service` signs its internal calls to customer/inventory.

### 4) Token issuance flow

The gateway validates tokens but does not issue them. A separate identity provider should issue JWTs using the shared secret (or future JWK integration).

Recommended claims:
- `sub` user or service principal identifier
- `iss` identity provider name (when `JWT_ISSUER` is configured)
- `aud` API audience (when `JWT_AUDIENCE` is configured)
- `exp` short expiration (5–30 min)
- `iat` issued-at timestamp

### 5) Required environment variables

- `JWT_SECRET` (gateway)
- `JWT_ISSUER` (optional, gateway)
- `JWT_AUDIENCE` (optional, gateway)
- `SERVICE_AUTH_SECRET` (gateway + order + customer + inventory)
- `SERVICE_AUTH_CALLER` (gateway and order)
- `SERVICE_AUTH_MAX_SKEW_MS` (optional, customer + inventory)

### 6) Test expectations

- Gateway returns `401` for missing/invalid JWT.
- Gateway forwards valid JWT requests and preserves `Authorization` downstream.
- Customer/inventory reject unsigned service requests with `401`.
- Order-service outbound client calls include signed service headers.
