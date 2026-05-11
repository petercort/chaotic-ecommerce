---
name: eureka-microservice
description: 'Use when scaffolding a new TypeScript microservice that must register with the Eureka service registry in this monorepo. Bundles ready-to-copy templates for src/index.ts, src/eureka.ts, Dockerfile, package.json, and a docker-compose service block. Triggers: "new microservice", "add service", "scaffold service", "register with eureka".'
---

# Eureka Microservice Skill

This skill scaffolds a new microservice that drops cleanly into the existing monorepo.

## When to use
The user asks to add a new TypeScript microservice (e.g. `notifications-service`, `payments-service`, `audit-service`) that needs to register with Eureka and be reachable through the api-gateway.

## Procedure

1. **Read the templates** in `assets/`:
   - [`assets/index.ts.template`](./assets/index.ts.template)
   - [`assets/package.json.template`](./assets/package.json.template)
   - [`assets/Dockerfile.template`](./assets/Dockerfile.template)
   - [`assets/compose-block.yml.template`](./assets/compose-block.yml.template)

2. **Pick a port.** Used: 8080 (gateway), 8081 (customer), 8082 (inventory), 8083 (order), 8084 (notifications), 8761 (eureka), 8090 (ui). New services should use 8085+.

3. **Create the service folder** at the workspace root using the template files. Replace placeholders:
   - `{{SERVICE_NAME}}` → kebab-case name (e.g. `notifications-service`)
   - `{{SERVICE_PORT}}` → chosen port
   - `{{SERVICE_ENV_NAME}}` → SHOUTY_SNAKE (e.g. `NOTIFICATIONS_SERVICE`)

4. **Copy verbatim** from `customer-service/src/`:
   - `eureka.ts`
   - `eureka-client.d.ts`
   Never modify these files.

5. **Create `tsconfig.json`** by copying `customer-service/tsconfig.json` unchanged.

6. **Append the compose block** from `assets/compose-block.yml.template` to `docker-compose.yml`.

7. **Add a proxy route** in `api-gateway/src/index.ts` so the new endpoints are reachable from the public API. Add the `NOTIFICATIONS_SERVICE_URL`-style constant, a new `buildBreaker` call, and an `app.all('/api/<name>*', ...)` line.

8. **Add E2E tests** in `e2e/tests/<service-name>.spec.ts` covering:
   - Successful POST → 201 with `id` and `status` in response body.
   - Validation failure → 400 (test at least one invalid cross-field case, e.g. `channel='webhook'` with a non-URL `to`).
   - Missing required fields → 400.
   - GET listing → 200, response is an array.

9. **Validate** by running `npm install && npx tsc --noEmit` inside the new service folder, then `npx tsc --noEmit` in `api-gateway/` to confirm the proxy additions compile cleanly.

## Conventions to enforce
- Validate every request body with `zod`. Always set `.min(1).max(N)` on every user-supplied string — no unbounded strings.
- Use `process.env.PORT ?? '<default>'` with `parseInt(..., 10)` — never `Number()` or bare string.
- Expose `GET /actuator/health` returning `{ status: 'UP' }`.
- Call `startEurekaClient(<name>, PORT)` after `app.listen`.
- Always call `express.json({ limit: '10kb' })` — never bare `express.json()`.
- Use explicit `.js` extensions on all local imports in `src/` (e.g. `from './routes.js'`) — required for NodeNext module resolution.
- Use `console.warn` / `console.error` for error paths in route handlers — never `console.log` for failures. Log validation rejections at `warn` level (without the raw body).
- Export in-memory store state with a `resetStore()` function so tests can reset between runs.
- Use zod `.superRefine()` for cross-field validation (e.g. email format when `channel === 'email'`, URL format when `channel === 'webhook'`).
- Cap unbounded `GET` list endpoints: return at most the last N entries (e.g. `store.slice(-1000)`) to prevent memory exhaustion on large in-memory stores.
