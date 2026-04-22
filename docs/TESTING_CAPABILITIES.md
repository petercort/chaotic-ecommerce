# Testing Capabilities

## E2E Tests — Playwright (`/e2e/`)

- **Framework:** Playwright (`@playwright/test`)
- **Test files:** `customers.spec.ts`, `products.spec.ts`, `orders.spec.ts`, `error-scenarios.spec.ts`

### Run Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests |
| `npm run test:headed` | Run with browser visible |
| `npm run test:ui` | Interactive UI mode |
| `npm run test:customers` | Run customer tests only |
| `npm run test:products` | Run product tests only |
| `npm run test:orders` | Run order tests only |
| `npm run test:report` | Show HTML test report |

---

## Load Tests — k6 (`/load-tests/`)

- **Framework:** k6 (TypeScript, compiled via esbuild)

### Scenarios

| Script | Command | Purpose |
|--------|---------|---------|
| Smoke | `npm run smoke` | Quick sanity check |
| Baseline | `npm run baseline` | Normal load simulation |
| Ramp-up | `npm run ramp-up` | Gradually increasing traffic |
| Stress | `npm run stress` | High load beyond capacity |
| Spike | `npm run spike` | Sudden traffic burst |
| Soak | `npm run soak` | Extended duration test |
| Order Flow | `npm run order-flow` | Full order flow simulation |
| VT Benchmark | `npm run vt-bench` | Virtual threads benchmark |

### Build

```bash
cd load-tests
npm run build   # Compiles TypeScript to dist/
npm run typecheck  # Type-check without compiling
```

---

## Copilot CLI Testing Tools

- **`playwright-cli` skill** — Automates browser interactions and runs Playwright tests via AI assistance
- **`code-coverage-specialist` agent** — Analyzes code coverage and suggests test improvements
