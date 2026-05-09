# Copilot Instructions — copilot-typescript-demo

This is a TypeScript microservices monorepo demonstrating a Netflix-style ecommerce stack with chaos-engineering scenarios. Follow these conventions for every change.

## Architecture
- Services: `api-gateway` (8080), `customer-service` (8081), `inventory-service` (8082), `order-service` (8083), `eureka-server` (8761), `incident-service`, `demo-ui` (8090).
- Service discovery: every service registers with Eureka via `src/eureka.ts` (`startEurekaClient(appName, port)`).
- Inter-service calls go through the api-gateway in production paths; direct calls are only for tests.

## TypeScript / Node conventions
- Node 20, Express 4, `tsx` for dev, `tsc` for build (`dist/`).
- Strict TypeScript — no `any`. Validate request bodies with `zod` (already used in `customer-service`).
- Use `process.env.PORT ?? '<default>'` and `parseInt(..., 10)` — never hardcode ports.
- Always expose `GET /actuator/health` returning `{ status: 'UP' }`.
- Always call `startEurekaClient(<service-name>, Number(PORT))` after `app.listen`.
- Always handle `SIGTERM` / `SIGINT` — the eureka helper already does this.

## File layout (copy from `customer-service/`)
```
<service>/
  Dockerfile
  package.json
  tsconfig.json
  src/
    index.ts          # express bootstrap + health + eureka
    routes.ts         # express.Router with the API endpoints
    types.ts          # zod schemas + inferred types
    eureka.ts         # COPY verbatim from customer-service/src/eureka.ts
    eureka-client.d.ts# COPY verbatim
    db.ts             # only if persistence is needed (better-sqlite3)
```

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
- Never log raw request bodies that could contain PII.

## Testing
- Tests go next to the service in a `tests/` folder.
- Use Jest (when added) with `supertest` for HTTP-level tests.
- Mock the Eureka client — never start it in tests.

## Things to avoid
- Adding new top-level dependencies without a clear reason.
- Editing `eureka.ts` / `eureka-client.d.ts` — copy them verbatim from an existing service.
- Hand-rolling health-check shell payloads — copy from the existing compose entries.
