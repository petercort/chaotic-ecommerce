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
