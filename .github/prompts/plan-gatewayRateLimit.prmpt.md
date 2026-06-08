## Plan: Gateway Rate Limiting Recommendation

Recommend Redis-backed `express-rate-limit` for the API gateway as the target implementation because it preserves correctness when the gateway scales horizontally while keeping application code simple. Use in-memory `express-rate-limit` only as a local/demo fallback or phase-1 shortcut; avoid custom token bucket unless the project needs semantics that package middleware cannot provide.

**Steps**
1. Add gateway-level middleware after CORS/body parsing and before `/api/*` proxy routes in `/Users/petercort/Documents/petercort/copilot-typescript-demo/api-gateway/src/index.ts`.
2. Use `express-rate-limit` for request-window enforcement and standard rate-limit headers.
3. For production/scaled mode, add Redis-backed storage with `rate-limit-redis` and `redis` so counters are shared across gateway replicas.
4. Add a Redis service to `/Users/petercort/Documents/petercort/copilot-typescript-demo/docker-compose.yml` only if choosing Redis-backed mode for local stack parity.
5. Expose env vars for enablement, window size, max requests, Redis URL, Redis prefix, fail-open/fail-closed behavior, and proxy trust.
6. Add focused tests for 429 behavior and header behavior if/when gateway exports the Express app or has supertest coverage added.

**Relevant files**
- `/Users/petercort/Documents/petercort/copilot-typescript-demo/api-gateway/src/index.ts` — insert limiter middleware before proxy routes and avoid limiting `/actuator/health`.
- `/Users/petercort/Documents/petercort/copilot-typescript-demo/api-gateway/package.json` — add `express-rate-limit`; add `rate-limit-redis` and `redis` for Redis-backed mode.
- `/Users/petercort/Documents/petercort/copilot-typescript-demo/docker-compose.yml` — add Redis service/env only for Redis-backed deployment.
- `/Users/petercort/Documents/petercort/copilot-typescript-demo/implement-rate-limit.md` — existing task note already requires 429s, env-configurable limits, and S4 overload validation.

**Verification**
1. Run `npm install` in `api-gateway` after package selection.
2. Run `npm run build` in `api-gateway` to validate TypeScript.
3. Start stack with `docker compose up --build` if Redis service is added.
4. Send more than `RATE_LIMIT_MAX` requests within `RATE_LIMIT_WINDOW_MS` to an `/api/*` route and verify HTTP 429 plus `RateLimit-*` headers.
5. Verify `/actuator/health` remains available and is not throttled.
6. Re-run or adapt chaos scenario S4 gateway overload to confirm throttling reduces downstream pressure.

**Decisions**
- Score scale: 1 is poor/high risk, 5 is strong/low risk. For P99 latency, 5 means lowest latency impact.
- Recommended target: `express-rate-limit` with Redis store.
- Included scope: gateway ingress rate limiting, env-driven configuration, standard headers, Redis-backed counters for scale.
- Excluded scope: per-user authentication-aware quotas, downstream service-specific adaptive throttling, distributed custom algorithm design.

**Further Considerations**
1. Choose fail-open vs fail-closed if Redis is unavailable. Recommendation: fail-open for demo/customer traffic resilience, fail-closed only for abuse-sensitive public production.
2. Decide keying strategy. Recommendation: IP-based now, authenticated principal later if gateway gets auth context.
