# Copilot Instructions — copilot-typescript-demo

This is a TypeScript microservices monorepo demonstrating an ecommerce stack with chaos-engineering scenarios. Follow these conventions for every change.

## Architecture
- Services: `api-gateway` (8080), `customer-service` (8081), `inventory-service` (8082), `order-service` (8083),`eureka-server` (8761), `incident-service`, `demo-ui` (8090).
- Service discovery: every service registers with Eureka via `src/eureka.ts` (`startEurekaClient(appName, port)`).
- Inter-service calls go through the api-gateway in production paths; direct calls are only for tests.

## TypeScript / Node conventions
- Node 20, Express 4, `tsx` for dev, `tsc` for build (`dist/`).
- Strict TypeScript — no `any`. Validate request bodies with `zod` (already used in `customer-service`).
- Use `process.env.PORT ?? '<default>'` and `parseInt(..., 10)` — never hardcode ports.
- Always expose `GET /actuator/health` returning `{ status: 'UP' }`.
- Always call `startEurekaClient(<service-name>, Number(PORT))` after `app.listen`.
- Always handle `SIGTERM` / `SIGINT` — the eureka helper already does this.

## Dockerfile
- Base image `node:20-slim`, multi-stage (`builder` → `runtime`).
- `npm ci` in builder, `npm ci --omit=dev` in runtime.
- `EXPOSE` the service port, `CMD ["node", "dist/index.js"]`.

## docker-compose.yml
- Add the service on the `ecommerce-net` network.
- `depends_on: { eureka-server: { condition: service_healthy } }`.
- Add a node-based healthcheck identical in shape to existing services.
- Set `EUREKA_HOST: eureka-server` env var.
- Use `${<SERVICE>_PORT:-<default>}:<internal>` for the port mapping.

## Code quality
- No `console.log` for errors — use `console.warn` / `console.error`.
- No secrets, tokens, or hostnames in code — read from env.
- Validate every external input with zod before use (OWASP A03).
- Always set both `.min(1)` and `.max(N)` on every user-supplied string field in zod schemas — no unbounded strings (prevents memory exhaustion via repeated large-field payloads).
- Never log raw request bodies that could contain PII.
- Always pass a size limit to `express.json()`: `app.use(express.json({ limit: '10kb' }))` — prevents memory exhaustion (OWASP A05).
- When a field's valid values depend on another field (e.g. `to` must be an email for `channel: 'email'`), use zod `.superRefine()` to enforce the cross-field rule rather than leaving it as `.string().min(1)`.
- Import paths in `src/` must use explicit `.js` extensions (e.g. `from './routes.js'`) — required for `NodeNext` module resolution and must be consistent across all services.

## Testability
- Router-level in-memory state (arrays, counters) MUST be exported with a `resetStore()` function so unit/integration tests can reset between runs:
  ```ts
  export let store: MyType[] = [];
  export function resetStore() { store = []; }
  ```
- Every new service needs a corresponding `e2e/tests/<service-name>.spec.ts` covering: successful POST, validation failure (400), and GET listing.

## Things to avoid
- Adding new top-level dependencies without a clear reason.
- Editing `eureka.ts` / `eureka-client.d.ts`.
- Hand-rolling health-check shell payloads — copy from the existing compose entries.
- Using bare `.string().min(1)` for fields whose format depends on a sibling field — use `.superRefine()` instead.
- Module-level singleton state without an exported `resetStore()` function.
- Calling `express.json()` without a `limit` option.

## Security

- Be security focused, especially when adding new services. 
- Follow OWASP guidelines and ensure that all endpoints are properly validated and sanitized. 
- Avoid exposing sensitive information in logs or error messages. 
- Always use HTTPS for external communications and ensure that any third-party libraries are up-to-date and free from known vulnerabilities.
- Always review code against all instructions after writing. 