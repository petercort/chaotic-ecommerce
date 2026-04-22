# E-Commerce Microservices Demo

A fully working e-commerce microservices application built with **TypeScript and Node.js**. Originally a Java Spring Boot monolith, refactored into independent services using GitHub Copilot — extended with Docker Compose, Playwright E2E tests, chaos engineering, and load testing.

## Overview

Five services collaborate to handle customer management, product inventory, and order processing:

| Service | Port | Responsibility |
|---------|------|----------------|
| `api-gateway` | 8080 | Edge router — single client entry point, circuit breakers |
| `customer-service` | 8081 | Customer CRUD, SQLite in-memory DB |
| `inventory-service` | 8082 | Product catalog + stock management, SQLite in-memory DB |
| `order-service` | 8083 | Order lifecycle + orchestration saga, calls customer & inventory via axios |
| `demo-ui` | 8090 | SPA frontend (Express + server-side proxy) |

All external traffic enters through the API Gateway on port **8080**. The demo UI on port **8090** proxies `/api/*` server-side to the gateway, so no CORS exposure to the browser. Service discovery uses Docker Compose container DNS — no separate registry needed.

## Project Structure

```
copilot-typescript-demo/
├── api-gateway/            # Edge router — port 8080 (Express + axios + opossum)
├── customer-service/       # Customer CRUD — port 8081 (Express + SQLite)
├── inventory-service/      # Product catalog — port 8082 (Express + SQLite)
├── order-service/          # Order management — port 8083 (Express + SQLite + axios)
│
├── demo-ui/                # SPA frontend (Express + proxy) — port 8090
│   ├── Dockerfile          # Node 20 multi-stage, API_GATEWAY_URL env var
│   ├── server.ts           # Serves static UI + proxies /api/* to gateway
│   └── public/index.html   # Single-page app (Customers / Products / Orders tabs)
├── incident-service/       # GitHub Copilot Extensions agent service
├── e2e/                    # Playwright E2E test project (20 tests, Chromium)
├── load-tests/             # k6 TypeScript load test suite (esbuild pipeline)
├── scripts/                # Helper scripts (assert, monitor, restart, CLI test runner)
│   └── playwright-cli-test.sh  # playwright-cli runner — 18 DOM assertions + 5 screenshots
├── scenarios/              # Chaos experiment runbooks (S1–S8)
│   └── run-all-chaos.sh    # Run all 8 scenarios in sequence
│
├── docker-compose.yml              # Full stack (all 5 services + demo-ui)
├── docker-compose.monitoring.yml   # Prometheus + Grafana observability stack
├── .env                            # Default port config for Docker
│
├── .github/workflows/
│   ├── e2e.yml                  # Playwright E2E CI
│   ├── chaos-tests.yml          # Weekly chaos suite
│   ├── resilience-smoke.yml     # PR resilience gate
│   ├── nightly-load-test.yml    # Nightly k6 load test
│   └── pr-smoke-test.yml        # PR k6 smoke gate
│
├── build.sh                # Build all services (npm ci + tsc)
├── run.sh                  # Start all services locally
└── docs/                   # Architecture docs + implementation plans
    ├── ARCHITECTURE.md
    ├── QUICKSTART.md
    ├── DOCKER_COMPOSE_PLAN.md
    ├── PLAYWRIGHT_UI_TESTING_PLAN.md
    ├── CHAOS_TESTING_PLAN.md
    └── LOAD_TESTING_PLAN.md
```

## Prerequisites

- **Node.js 20+** (`node --version`)
- **npm 9+** (bundled with Node.js)
- **Docker** (for Docker Compose and monitoring stack)
- **k6** (for load tests — `brew install k6`)

## Running Locally

### Build

```bash
./build.sh
```

Runs `npm ci && npm run build` (TypeScript → `dist/`) in each service.

### Start All Services

```bash
./run.sh
```

Startup order: customer + inventory (parallel) → order-service → api-gateway → demo-ui. All services are running in ~5 s.

```
API Gateway:  http://localhost:8080
Demo UI:      http://localhost:8090
```

### Stop All Services

```bash
kill $(cat /tmp/ecommerce-pids.txt)
```

## API Endpoints (via Gateway on :8080)

### Customers
```bash
GET  /api/customers          # list all (3 seeded)
GET  /api/customers/{id}     # by ID
POST /api/customers          # create
PUT  /api/customers/{id}     # update
DELETE /api/customers/{id}   # delete
```

### Products
```bash
GET  /api/products           # list all (6 seeded)
GET  /api/products/{id}      # by ID
POST /api/products           # create
POST /api/products/{id}/reserve?quantity=N   # reserve stock
POST /api/products/{id}/restore?quantity=N   # restore stock
```

### Orders
```bash
GET  /api/orders             # list all
GET  /api/orders/{id}        # by ID
POST /api/orders             # create (calls customer + inventory via Feign)
PATCH /api/orders/{id}/status?status=CONFIRMED
```

#### Create Order Example
```bash
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "items": [{"productId": 2, "quantity": 1}],
    "shippingAddress": "123 Main St",
    "shippingCity": "New York",
    "shippingState": "NY",
    "shippingZip": "10001",
    "shippingCountry": "USA"
  }'
```

## Seed Data

Each service seeds data on startup (SQLite in-memory — data resets on restart):

| Service | Data |
|---------|------|
| customer-service | John Doe, Jane Smith, Bob Johnson (IDs 1–3) |
| inventory-service | Laptop $1299, Mouse $29, Keyboard $149, Chair $299, Desk $599, Webcam $79 (IDs 1–6) |
| order-service | No seeded orders |

---

## 🐳 Docker Compose

Run the full stack in containers — no local Java or Maven required.

### Quick Start

```bash
# Build all images and start everything
./start.sh

# Start with Prometheus + Grafana monitoring
./start.sh --monitoring

# Skip rebuild (use cached images)
./start.sh --no-build

# Stop all containers
./start.sh --down

# Tail logs
./start.sh --logs
```

Or using Docker Compose directly:

```bash
# Build all images (first time: ~5–10 min, subsequent: seconds with cache)
docker compose build

# Start all services including the demo UI
docker compose up -d

# Verify all services are healthy
docker compose ps

# Verify API Gateway is routing
curl http://localhost:8080/api/customers

# Open the demo UI
open http://localhost:8090

# Tear down (SQLite data is lost — in-memory only)
docker compose down
```

### How It Works

Each service has a `Dockerfile` using a two-stage build:
1. **Build stage** — `node:20-slim` installs deps + compiles TypeScript (`tsc`)
2. **Runtime stage** — `node:20-slim` installs only production deps, runs `node dist/index.js` (~200 MB image)

The `demo-ui` service proxies all `/api/*` requests server-side to `http://api-gateway:8080` (container-to-container), so there is no CORS exposure to the browser.

The `docker-compose.yml` starts services in dependency order using health checks:

```
customer-service (healthy) ─┐
                             ├─→ order-service (healthy) ─┐
inventory-service (healthy) ─┘                            ├─→ api-gateway → demo-ui
                                                          
```

Services find each other by Docker Compose container name (e.g. `http://customer-service:8081`) via environment variables injected at runtime.

### Real-Time Monitoring Stack

Start the full monitoring stack alongside the app (Prometheus, Grafana, Dozzle log viewer, Uptime Kuma):

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

| Tool | URL | Purpose |
|------|-----|---------|
| **Demo UI** | http://localhost:8090 | SPA frontend (Customers / Products / Orders) |
| **Dozzle** | http://localhost:9999 | Live log viewer for all containers |
| **Uptime Kuma** | http://localhost:3001 | Visual uptime / availability dashboard |
| **Grafana** | http://localhost:3000 | Metrics dashboards — `admin` / `admin` |
| **Prometheus** | http://localhost:9090 | Raw metrics scraper |

Grafana auto-provisions a **Chaos Testing Overview** dashboard (`Chaos Testing` folder) with panels for service health, HTTP request/error rates, JVM heap, GC pauses, and circuit-breaker state.

#### Terminal health monitor

```bash
./scripts/watch-chaos.sh
```

Polls all 5 service health endpoints every 2 s and prints a colour-coded status table — useful during chaos experiments when you want a quick "is it alive?" view alongside the richer browser dashboards.

#### Uptime Kuma — add monitors after first launch

1. Open http://localhost:3001 and create an account.
2. Click **Add New Monitor** for each service:

| Name | URL |
|------|-----|
| api-gateway | http://api-gateway:8080/actuator/health |
| customer-service | http://customer-service:8081/actuator/health |
| inventory-service | http://inventory-service:8082/actuator/health |
| order-service | http://order-service:8083/actuator/health |

Set **Heartbeat Interval** to 10 s for chaos-test sensitivity.

### Configuration

Edit `.env` to override ports:
```env
API_GATEWAY_PORT=8080
CUSTOMER_SERVICE_PORT=8081
INVENTORY_SERVICE_PORT=8082
ORDER_SERVICE_PORT=8083
DEMO_UI_PORT=8090
```

> **See also:** [`docs/DOCKER_COMPOSE_PLAN.md`](docs/DOCKER_COMPOSE_PLAN.md)

---

## 🎭 Playwright UI Tests

End-to-end tests that exercise the full service mesh through the demo UI. Two ways to run: the **spec-file test runner** (`npx playwright test`) for CI and the **playwright-cli runner** (`bash scripts/playwright-cli-test.sh`) for agent-driven or local testing.

### Prerequisites

```bash
# Services must be running (local or Docker)
docker compose up -d

# Install Playwright + Chromium (spec-file runner)
cd e2e && npm install && npx playwright install chromium

# Install playwright-cli (CLI runner)
npm install -g @playwright/cli@latest
playwright-cli install --skills   # registers GitHub Copilot skills
```

### Spec-File Test Runner

```bash
cd e2e

# Run all 20 tests (headless)
npx playwright test

# Run with visible browser
npx playwright test --headed

# Open interactive test UI
npx playwright test --ui

# View HTML report
npx playwright show-report
```

### playwright-cli Runner

Uses [`@playwright/cli`](https://github.com/microsoft/playwright-cli) — a token-efficient CLI built for coding agents. Drives a real browser via concise shell commands, no JSON-RPC boilerplate.

```bash
# Headless (default)
bash scripts/playwright-cli-test.sh

# Headed (visible browser)
bash scripts/playwright-cli-test.sh --headed

# Custom base URL
bash scripts/playwright-cli-test.sh --base-url http://localhost:8090
```

The script opens a named browser session, navigates each tab via `eval`, asserts DOM values directly, captures a screenshot per suite, then closes. Screenshots are saved to `results/screenshots/cli-0N-<name>.png`.

**Why playwright-cli for agents:**
- No accessibility tree dumped into context — far fewer tokens per interaction
- DOM values returned directly from `eval --raw` (e.g. `3`, `"John Doe"`)
- Works with any coding agent (GitHub Copilot, Claude Code, etc.) via installed skills
- Simple named sessions: `playwright-cli -s=my-session <cmd>`

### Test Coverage

| Spec file | Tests | What it verifies |
|-----------|-------|-----------------|
| `customers.spec.ts` | 5 | Customer API responses + UI tab (names, emails) |
| `products.spec.ts` | 4 | Product API responses + UI tab (names, prices) |
| `orders.spec.ts` | 6 | **Cross-service order creation** (Gateway → Order → Customer + Inventory Feign calls) |
| `error-scenarios.spec.ts` | 5 | 404s, invalid inputs, error state display |

### playwright-cli (AI-Assisted Testing in VS Code)

`playwright-cli install --skills` installs a `SKILL.md` to `.claude/skills/playwright-cli/` that GitHub Copilot and Claude Code read automatically. Once installed, ask your agent:

- *"Use playwright skills to test http://localhost:8090"*
- *"playwright-cli open http://localhost:8090 --headed, then screenshot each tab"*
- *"Take a screenshot of the Create Order form"*

### CI

`.github/workflows/e2e.yml` — triggers on push/PR. Builds services, starts them, runs all Playwright tests, uploads HTML report as artifact.

> **See also:** [`docs/PLAYWRIGHT_UI_TESTING_PLAN.md`](docs/PLAYWRIGHT_UI_TESTING_PLAN.md)

---

## 💥 Chaos Testing

Resilience experiments that validate the system's behaviour under failure conditions. Built on [Chaos Monkey for Spring Boot](https://github.com/codecentric/chaos-monkey-spring-boot) and [Toxiproxy](https://github.com/Shopify/toxiproxy).

### Prerequisites

Resilience patterns are already wired in:
- **Circuit breakers** with [opossum](https://github.com/nodeshift/opossum) on all downstream calls in `order-service` and `api-gateway`
- **Per-call timeouts** (5 s) on customer + inventory calls from order-service
- **Compensation logic** in order-service saga (restores reserved stock on any failure)

### Quick Start

```bash
# 1. Verify steady state (all services must be running first)
bash scripts/verify-steady-state.sh

# 2. Run a single scenario
bash scenarios/s4-gateway-overload.sh

# 3. Run all 8 scenarios in sequence
bash scenarios/run-all-chaos.sh
```

### All Eight Scenarios

| Script | Scenario | Load | Tests |
|--------|----------|------|-------|
| `s1-eureka-kill.sh` | Eureka server killed | 10 req × 3 endpoints × 3 checkpoints | Services keep routing for ≥60 s via cached registry; auto-restarts Eureka on exit |
| `s2-customer-service-kill.sh` | Customer service killed | 60 concurrent + 20 fast-fail probes | Circuit breaker opens within 5 failures; auto-restart on exit |
| `s3-inventory-latency.sh` | Inventory latency injected (8–12 s) | 30 concurrent requests | Feign timeout triggers in <5 s |
| `s4-gateway-overload.sh` | Mixed GET + POST burst | 3 × 100 concurrent = 300 total | <5% error rate under sustained load |
| `s5-cascade-failure.sh` | Inventory killed | 20 customer + 30 order concurrent | customer-service stays up; order fails gracefully; auto-restart on exit |
| `s6-network-partition.sh` | Toxiproxy TCP fault (10 s + 500 ms jitter) | 30 concurrent | Network-level partition via proxy; graceful skip if Toxiproxy not running |
| `s7-jvm-heap-exhaustion.sh` | JVM heap capped at 32 MB | 100 requests at 0.05 s intervals | OOM handling; service degrades gracefully |
| `s8-network-packet-drop.sh` | 60% packet loss for 120 s | 60 requests | Resilience under severe packet loss; macOS-compatible timing |

All scenarios use `docker compose stop/start` (not `pgrep/kill`) and include cleanup traps to restore services on exit.

### Grafana Dashboard

The monitoring stack auto-provisions a **Chaos Testing Overview** dashboard with 8 panels:

| Panel | What it shows |
|-------|---------------|
| Service Health | HTTP success/error rates per service |
| HTTP Request Rate | Requests/sec per service |
| 5xx Error Rate | Server error rate |
| JVM Heap Used | Heap consumption (useful for S7) |
| GC Pause Time | Garbage collection impact |
| Circuit Breaker Status | OPEN / CLOSED / HALF_OPEN with colour coding |
| CB Failure Rate | Failure % triggering breaker |
| CB Blocked Calls | Calls rejected while breaker is OPEN |

### Enabling Chaos Monkey

> **Note:** Chaos Monkey for Spring Boot is no longer available (services are now TypeScript/Node.js). Use Toxiproxy scenarios (S3, S6, S8) for network-level fault injection, or `docker compose stop <service>` / `docker compose start <service>` for service kill/restart experiments.

### Helper Scripts

```bash
scripts/verify-steady-state.sh   # Assert all 4 services + 3 routes are healthy
scripts/traffic-monitor.sh       # Continuously log HTTP status + response time to CSV
scripts/watch-chaos.sh           # Colour-coded live service health table (polls every 2 s)
scripts/assert.sh                # Sourced by scenarios — http/response/service assertions
```

### CI

- `.github/workflows/chaos-tests.yml` — runs S4 every Monday at 3 AM UTC
- `.github/workflows/resilience-smoke.yml` — runs steady-state check on PRs touching `order-service` or `api-gateway`

> **See also:** [`docs/CHAOS_TESTING_PLAN.md`](docs/CHAOS_TESTING_PLAN.md)

---

## 📊 Load Testing

Synthetic benchmarks using [k6](https://k6.io) (primary) and [Gatling](https://gatling.io) (secondary) to measure throughput, latency, and the impact of Java 25 virtual threads.

### Quick Start

```bash
# Install k6
brew install k6   # macOS

# Start all microservices
docker compose up -d

# Build and run the smoke test (1 VU × 1 min — verify everything works)
cd load-tests && npm install && npm run smoke

# Run the baseline (10 VUs × 5 min — establish benchmarks)
npm run baseline
```

### Test Scenarios

| Script | VUs | Duration | Purpose |
|--------|-----|----------|---------|
| `smoke.ts` | 1 | 1 min | Sanity check all endpoints |
| `baseline.ts` | 10 | 5 min | Establish normal performance |
| `ramp-up.ts` | 0→100 | 10 min | Find capacity ceiling |
| `stress.ts` | 100→200 | 10 min | Behaviour beyond capacity |
| `spike.ts` | 10→100→10 | ~2 min | Sudden burst + recovery |
| `soak.ts` | 30 | 60 min | Memory leaks, SQLite growth |
| `order-flow.ts` | 20 | 5 min | Realistic browse → order user journey |
| `virtual-threads-benchmark.ts` | 0→150 | 6 min | Concurrency benchmark |

Tests are written in TypeScript and bundled with esbuild. All scripts use `npm run <name>` from the `load-tests/` directory:

```bash
cd load-tests
npm run smoke
npm run baseline
npm run order-flow
```

### Virtual Threads Benchmark

```bash
# Run concurrency benchmark (measures Node.js async throughput at high load)
cd load-tests && npm run virtual-threads-benchmark
```

Compare `order_duration_ms` p95/p99 at different VU counts to understand throughput limits.

### Performance SLOs

| Endpoint | p50 target | p95 target |
|----------|-----------|-----------|
| `GET /api/customers` | <20 ms | <50 ms |
| `GET /api/products` | <20 ms | <50 ms |
| `GET /api/orders` | <25 ms | <60 ms |
| `POST /api/orders` | <100 ms | <250 ms |

### CI

- `.github/workflows/nightly-load-test.yml` — runs smoke + baseline nightly, uploads JSON results
- `.github/workflows/pr-smoke-test.yml` — runs smoke test on every PR touching service code

> **See also:** [`docs/LOAD_TESTING_PLAN.md`](docs/LOAD_TESTING_PLAN.md)

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5, Node.js 20 |
| Framework | Express.js (all services) |
| API Gateway | Express + axios proxying + opossum circuit breakers |
| Inter-service calls | axios with per-call opossum circuit breakers |
| Resilience | opossum (circuit breaker, timeout) + saga compensation |
| Database | better-sqlite3 in-memory per service |
| Validation | zod |
| Containers | Docker (node:20-slim multi-stage), Docker Compose (5 services + demo-ui) |
| Frontend | Express.js SPA with server-side API proxy |
| E2E testing | Playwright spec runner + playwright-cli agent runner |
| Load testing | k6 (TypeScript, bundled with esbuild) |
| Chaos engineering | Toxiproxy (8 scenarios), docker compose stop/start |
| Observability | `/actuator/health` endpoints, Prometheus, Grafana |
| CI/CD | GitHub Actions |

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/DOCKER_COMPOSE_PLAN.md`](docs/DOCKER_COMPOSE_PLAN.md) | Full Docker Compose implementation guide |
| [`docs/PLAYWRIGHT_UI_TESTING_PLAN.md`](docs/PLAYWRIGHT_UI_TESTING_PLAN.md) | Playwright setup + test authoring guide |
| [`docs/CHAOS_TESTING_PLAN.md`](docs/CHAOS_TESTING_PLAN.md) | Chaos experiment runbooks + resilience patterns |
| [`docs/LOAD_TESTING_PLAN.md`](docs/LOAD_TESTING_PLAN.md) | Load test scenarios + SLOs + Gatling setup |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture diagrams |
| [`docs/API_EXAMPLES.md`](docs/API_EXAMPLES.md) | Comprehensive API testing examples |
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | Original quick start guide |

## License

This is a demo project for educational purposes.

