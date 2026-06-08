# Testing Plan

## Test Frameworks

| Framework | Type |
|---|---|
| **Playwright** | E2E / UI |
| **k6** | Load / Performance |
| **Bash scripts** | Chaos Engineering |

---

## 1. E2E Tests (`/e2e/`)

Uses **Playwright** targeting the Demo UI at `localhost:8090`.

**4 test suites:**
- `customers.spec.ts` — GET list, GET by ID, 404s, UI rendering
- `products.spec.ts` — Product API & UI
- `orders.spec.ts` — Order creation, items, UI tabs/forms
- `error-scenarios.spec.ts` — Invalid IDs, zero qty, error states

**Configuration** (`playwright.config.ts`):
- Timeout: 30s per test, 10s assertions
- Workers: 1 (sequential)
- Base URL: `http://localhost:8090`
- Retries: 2 in CI, 0 locally
- Screenshots/video: on failure
- Browser: Chromium (Desktop Chrome)

**Run commands:**
```bash
cd e2e && npm install
npx playwright test              # run all
npx playwright test --headed     # with browser visible
npx playwright test --ui         # interactive UI mode
npx playwright show-report       # view HTML report

# Run individual suites
npx playwright test tests/customers.spec.ts
npx playwright test tests/products.spec.ts
npx playwright test tests/orders.spec.ts
npx playwright test tests/error-scenarios.spec.ts
```

---

## 2. Load Tests (`/load-tests/k6/`)

**8 k6 scenarios** (TypeScript, compiled with esbuild). Base URL: `http://localhost:8080`.

| Script | VUs | Duration | Failure Threshold | Latency Threshold |
|---|---|---|---|---|
| `smoke` | 1 | 1m | < 1% | p95 < 1s |
| `baseline` | 10 | 5m | < 1% | p95 < 500ms |
| `ramp-up` | 10→50→100 | 10m | < 5% | p95 < 2s |
| `stress` | 100→150→200 | 11m | < 10% | p99 < 5s |
| `spike` | 10→100 | 1.5m | < 10% | — |
| `soak` | 30 | 60m | < 1% | p95 < 1s, errors < 10 |
| `order-flow` | 20 | 5m | < 1% | — |
| `vt-bench` | 50→100→150 | 6m | success > 95% | — |

**Run commands:**
```bash
cd load-tests
npm run build        # compile TypeScript → dist/

npm run smoke
npm run baseline
npm run ramp-up
npm run stress
npm run spike
npm run soak
npm run order-flow
npm run vt-bench

# Export results to JSON
k6 run --out json=results/baseline.json dist/baseline.js
```

---

## 3. Chaos Scenarios (`/scenarios/`)

**7 bash-driven chaos tests.** Each scenario: verifies steady state → injects failure → probes recovery at t+15s, t+30s, t+60s → cleans up → logs to `results/chaos-<scenario>.log`.

| Scenario | What It Tests |
|---|---|
| `s1-eureka-kill.sh` | Service registry failure, 60s cache survivability |
| `s2-customer-service-kill.sh` | Circuit breaker activation |
| `s3-inventory-latency.sh` | High latency injection (500ms+) |
| `s4-gateway-overload.sh` | API gateway backpressure (300 concurrent) |
| `s5-cascade-failure.sh` | Blast radius containment |
| `s6-network-partition.sh` | Network isolation via iptables |
| `s8-network-packet-drop.sh` | 60% packet loss via tc/pumba |

**Run commands:**
```bash
bash scenarios/run-all-chaos.sh                 # run all 7 sequentially
bash scenarios/s1-eureka-kill.sh                # run individual
bash scripts/verify-steady-state.sh             # pre/post health check
bash scripts/watch-chaos.sh                     # monitor execution
```

**Recovery expectations:**
- Service restart time: 30–60 seconds
- Eureka cache survivability: ≥ 60 seconds
- Circuit breaker fast-fail: after 3–5 consecutive errors

---

## 4. Helper Scripts (`/scripts/`)

| Script | Purpose |
|---|---|
| `verify-steady-state.sh` | Assert all 5 services return healthy responses |
| `assert.sh` | HTTP check helpers and assertion utilities |
| `traffic-monitor.sh` | Monitor API traffic during chaos tests |
| `watch-chaos.sh` | Live monitor of chaos scenario execution |
| `restart-service.sh` | Restart individual Docker services |

---

## 5. CI/CD Workflows (`.github/workflows/`)

| Workflow | Trigger | What Runs |
|---|---|---|
| `e2e.yml` | Push/PR to main | Full Playwright suite; uploads HTML report artifact |
| `pr-smoke-test.yml` | PR touching `*/src/**` | k6 smoke test |
| `nightly-load-test.yml` | Daily 2AM UTC | smoke + baseline (exports JSON artifact) |
| `chaos-tests.yml` | Weekly Mon 3AM UTC | All 8 chaos scenarios; uploads logs as artifacts |
| `resilience-smoke.yml` | PR on order-service or api-gateway | Steady-state verification |

---

## 6. Services Under Test

| Service | Port | Tested By |
|---|---|---|
| api-gateway | 8080 | E2E, load tests, chaos (s4, s6) |
| customer-service | 8081 | E2E (customers), chaos (s2, s8) |
| inventory-service | 8082 | E2E (products), chaos (s3, s5) |
| order-service | 8083 | E2E (orders), load (order-flow), chaos (s5) |
| eureka-server | 8761 | Chaos (s1) |

---

## Notable Gaps

- **No unit tests** in any microservice — all testing is external via E2E, load, and chaos
- No Jest or Vitest configured in any service
- Load tests require k6 to be installed locally (`brew install k6`)
- Chaos scenarios using `iptables` and `pumba` require elevated privileges / Docker socket access
