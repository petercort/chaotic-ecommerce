# Build Notes

## Runtime Requirements

This project requires **Node.js 20+** to build and run.

```bash
node --version   # must be >= 20
npm --version    # must be >= 9
```

## Building All Services

```bash
./build.sh
```

This runs `npm ci && npm run build` in each service directory:
- `customer-service/`
- `inventory-service/`
- `order-service/`
- `api-gateway/`
- `demo-ui/`

TypeScript is compiled to `dist/` in each service via `tsc`.

## Building a Single Service

```bash
cd customer-service
npm ci            # install deps (uses package-lock.json)
npm run build     # tsc → dist/
```

## Type-Checking Only (no output)

```bash
cd customer-service
npx tsc --noEmit
```

## Development Mode (hot reload)

```bash
cd customer-service
npm run dev       # tsx watch src/index.ts
```

## Starting a Service

```bash
cd customer-service
node dist/index.js
```

Or via npm:
```bash
npm start
```

## Docker Builds

Each service uses a two-stage `node:20-slim` Dockerfile:

```dockerfile
# Stage 1: Build TypeScript
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y python3 make g++   # for better-sqlite3
COPY package*.json ./
RUN npm ci
COPY tsconfig.json src/ ./
RUN npm run build

# Stage 2: Runtime
FROM node:20-slim AS runtime
RUN apt-get update && apt-get install -y python3 make g++   # native module rebuild
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/index.js"]
```

> **Why python3/make/g++?** `better-sqlite3` is a native Node.js addon that must be compiled for the target architecture. Both stages need build tools because `npm ci --omit=dev` rebuilds native modules from source.
>
> **Exception — `customer-service`:** it migrated to PostgreSQL via the pure-JavaScript `pg` driver, so its Dockerfile **drops** `python3 make g++` entirely. Only `inventory-service` and `order-service` still need the native build tools for `better-sqlite3`.

The `api-gateway` and `demo-ui` have no native modules and use `node:20-alpine` for a smaller image.

## k6 Load Tests

The `load-tests/` directory uses **esbuild** (not tsc) to bundle TypeScript for the k6 runtime:

```bash
cd load-tests
npm ci
npm run build    # esbuild bundles k6/*.ts → dist/*.js
npm run smoke    # build + k6 run dist/smoke.js
```

## Troubleshooting

### TypeScript Error: `moduleResolution: "bundler"` incompatible
If you see errors about module resolution, ensure `tsconfig.json` uses `"moduleResolution": "node"` (not `"bundler"`) when `"module"` is `"CommonJS"`.

### `better-sqlite3` Build Errors in Docker
Ensure both builder and runtime stages use the same base image family (`node:20-slim`) and both install build tools (`python3 make g++`).

### Service Can't Connect to Downstream
When running locally (not Docker), set the service URL env vars explicitly:
```bash
CUSTOMER_SERVICE_URL=http://localhost:8081 node dist/index.js
```

The `run.sh` script handles this automatically.

## Verification

After building, type-check all services:
```bash
for svc in customer-service inventory-service order-service api-gateway demo-ui; do
  echo -n "$svc: "
  (cd $svc && npx tsc --noEmit && echo "✓") || echo "✗ FAILED"
done
```
