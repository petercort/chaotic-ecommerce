# Research: how to implement unit tests on a typescript app wh

*Generated: 4/21/2026, 9:14:24 PM*

---

# Unit Testing in TypeScript: Frameworks, Patterns & Scalable Implementation

## Executive Summary

The TypeScript unit testing landscape in 2025 has two dominant choices: **Vitest** (modern, fast, native TypeScript) and **Jest** (battle-tested, largest ecosystem). For this codebase — TypeScript/Node.js microservices using Express, better-sqlite3, Zod, Axios, and Opossum circuit breakers — **Vitest is the recommended framework**. It provides native TypeScript support with zero transpilation overhead, 4–10× faster test runs than Jest on large codebases, and a Jest-compatible API that makes migration trivial. Given projected 3× usage growth, the scalability story matters: Vitest's parallel execution, in-process SQLite (already used by the services), and dependency injection patterns ensure the test suite will scale as fast as the codebase does.

---

## Architecture Overview: The Testing Pyramid

For a microservices TypeScript codebase targeting scalability, tests should follow the classic pyramid — heavily weighted toward unit tests:

```
              ┌──────────────┐
              │   E2E Tests  │  ← Already exists (Playwright)
              │    (few)     │
           ┌──┴──────────────┴──┐
           │  Integration Tests │  ← Route-level (supertest)
           │    (moderate)      │
        ┌──┴────────────────────┴──┐
        │       Unit Tests         │  ← Business logic, DB layer, clients
        │  (many — focus of this)  │
        └──────────────────────────┘
```

The codebase already has E2E (Playwright) and load tests (k6). The missing layer is **unit tests** for individual modules: route handlers, DB functions, client adapters, validation schemas, and circuit breaker behavior.[^1]

---

## Framework Comparison

### The Four Main Contenders

| Framework | TypeScript Support | Speed | Ecosystem | Best For |
|---|---|---|---|---|
| **Vitest** | Native, zero config | 4–10× faster than Jest | Growing fast | New TS projects, Node.js, ESM |
| **Jest** | Via ts-jest or @swc/jest | Moderate (improves with SWC) | Largest | Legacy, React Native, enterprise |
| **Mocha + Chai** | Via ts-node | Slow (sequential by default) | Mature, modular | Legacy Node, highly custom setups |
| **Jasmine** | Via ts-node | Moderate | Declining | Angular, legacy |

### Why Vitest for This Codebase

1. **Zero TypeScript config overhead** — the services already use `tsconfig.json` with `strict: true`, `ES2022` target, `CommonJS` module. Vitest respects this directly.[^2]
2. **4–10× faster** — real-world migrations report cold runs of 1.2s vs Jest's 12s in large TS projects.[^3]
3. **Lower memory footprint** — ~800 MB peak vs ~1.2 GB for Jest in 50K-line apps.[^3]
4. **Jest-compatible API** — `describe`, `it`, `expect`, `vi.fn()` (instead of `jest.fn()`) — near-zero learning curve.
5. **Native ESM + CommonJS** — this codebase uses `"module": "CommonJS"` which Vitest handles natively.[^2]
6. **Parallel by default** — runs tests across files in parallel worker threads; critical when test count triples with usage.

### When to Choose Jest Instead

- If you need React Native support
- If your team already has thousands of Jest tests with complex `jest.config.ts`
- If you rely on Jest-specific plugins not ported to Vitest (most have been)

---

## Installation & Configuration

### 1. Install Vitest in Each Service

For each microservice (repeat for `customer-service`, `inventory-service`, `order-service`, etc.):

```bash
cd order-service
npm install --save-dev vitest @vitest/coverage-v8 supertest @types/supertest
```

- `vitest` — the test runner
- `@vitest/coverage-v8` — coverage using V8 (fastest, no Babel needed)
- `supertest` — HTTP assertion layer for Express routes
- `@types/supertest` — TypeScript types

### 2. `vitest.config.ts` (per service)

```typescript
// order-service/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/eureka.ts'], // exclude entry points & infra
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    // Run serially within a file, parallel across files
    pool: 'threads',
    poolOptions: {
      threads: { maxThreads: 4 },
    },
  },
});
```

### 3. Update `package.json` Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  }
}
```

---

## Recommended Project Structure

The most scalable approach co-locates tests next to the code they test, with a separate `tests/` folder for integration-level tests:

```
order-service/
├── src/
│   ├── index.ts                 ← entry point (skip testing)
│   ├── routes.ts                ← route handlers
│   ├── routes.test.ts           ← route unit tests (supertest)
│   ├── db.ts                    ← SQLite data access
│   ├── db.test.ts               ← DB unit tests (in-memory SQLite)
│   ├── clients.ts               ← Axios + circuit breakers
│   ├── clients.test.ts          ← client unit tests (vi.mock)
│   ├── types.ts
│   └── eureka.ts                ← skip (infra)
├── tests/
│   └── integration/
│       └── order-flow.test.ts   ← full saga integration tests
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

**Why co-location over `/tests/unit/`?**
- Tests are adjacent to the code they test — easier to find and maintain
- Refactoring a file automatically reminds you to update its test
- Scales better as services grow: no mirrored folder tree to maintain[^4]

---

## Writing Unit Tests: Concrete Examples

The following examples are tailored to the actual `order-service` architecture in this codebase.

### A. Testing the Database Layer (`db.test.ts`)

The DB layer uses `better-sqlite3` with an in-memory database (`:memory:`)[^5] — this makes it ideal for testing **without mocking**: just import the module and run real SQL.

```typescript
// order-service/src/db.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { insertOrder, getOrderById, getAllOrders, updateOrderStatus } from './db.js';

describe('DB: order operations', () => {
  // SQLite :memory: is already reset per process — each test file gets a fresh DB
  // For isolation within a file, use beforeEach to clear tables

  it('inserts and retrieves an order by ID', () => {
    const id = insertOrder({
      customerId: 1,
      orderNumber: 'ORD-0001',
      status: 'PENDING',
      totalAmount: 99.99,
      shippingAddress: '123 Main St',
      shippingCity: 'NYC',
      shippingState: 'NY',
      shippingZip: '10001',
      shippingCountry: 'USA',
    });

    const order = getOrderById(id);
    expect(order).toBeDefined();
    expect(order?.orderNumber).toBe('ORD-0001');
    expect(order?.status).toBe('PENDING');
  });

  it('updates order status', () => {
    const id = insertOrder({ /* ... */ });
    updateOrderStatus(id, 'CONFIRMED');

    const order = getOrderById(id);
    expect(order?.status).toBe('CONFIRMED');
  });

  it('returns null for unknown ID', () => {
    const order = getOrderById(99999);
    expect(order).toBeNull();
  });
});
```

> **Key insight**: Because `db.ts` uses SQLite `:memory:`[^5], there is **no mocking needed** for DB tests. This is a significant advantage — tests are fast, real, and isolation is automatic.

### B. Testing the Clients Layer (`clients.test.ts`)

The `clients.ts` module uses Axios + Opossum circuit breakers[^6]. These need to be mocked — you never want real HTTP calls in unit tests.

```typescript
// order-service/src/clients.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios BEFORE importing clients
vi.mock('axios');
import axios from 'axios';
import { getCustomer, getProduct } from './clients.js';

const mockedAxios = vi.mocked(axios);

describe('getCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a customer when the service responds 200', async () => {
    mockedAxios.get = vi.fn().mockResolvedValue({
      data: { id: 1, name: 'Alice', email: 'alice@example.com' },
    });

    const customer = await getCustomer(1);
    expect(customer).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
  });

  it('returns null on 404', async () => {
    mockedAxios.get = vi.fn().mockRejectedValue(
      Object.assign(new Error('Not Found'), {
        isAxiosError: true,
        response: { status: 404 },
      })
    );
    // need to mark as axiosError
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const customer = await getCustomer(999);
    expect(customer).toBeNull();
  });

  it('throws on non-404 errors (circuit breaker will open)', async () => {
    mockedAxios.get = vi.fn().mockRejectedValue(new Error('Network Error'));
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(false);

    await expect(getCustomer(1)).rejects.toThrow('Network Error');
  });
});
```

### C. Testing Route Handlers (`routes.test.ts`)

Use `supertest` to test Express routes as black boxes — this tests routing, validation (Zod), error mapping, and the saga together.[^7]

```typescript
// order-service/src/routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import orderRouter from './routes.js';

// Mock the dependency layers
vi.mock('./db.js');
vi.mock('./clients.js');

import * as db from './db.js';
import * as clients from './clients.js';

const app = express();
app.use(express.json());
app.use('/api/orders', orderRouter);

describe('POST /api/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an order successfully (201)', async () => {
    vi.mocked(clients.getCustomer).mockResolvedValue({ id: 1, name: 'Alice', email: 'a@a.com' });
    vi.mocked(clients.getProduct).mockResolvedValue({ id: 1, name: 'Widget', price: 9.99, sku: 'WID-001', stockQuantity: 100 });
    vi.mocked(clients.reserveStock).mockResolvedValue(true);
    vi.mocked(db.insertOrder).mockReturnValue(42);
    vi.mocked(db.getOrderById).mockReturnValue({
      id: 42, orderNumber: 'ORD-0042', status: 'PENDING',
      customerId: 1, totalAmount: 9.99, items: [],
    } as any);

    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, items: [{ productId: 1, quantity: 1 }] });

    expect(res.status).toBe(201);
    expect(res.body.orderNumber).toBe('ORD-0042');
  });

  it('returns 400 when quantity is zero (Zod validation)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, items: [{ productId: 1, quantity: 0 }] });

    expect(res.status).toBe(400);
  });

  it('returns 404 when customer does not exist', async () => {
    vi.mocked(clients.getCustomer).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 999, items: [{ productId: 1, quantity: 1 }] });

    expect(res.status).toBe(404);
  });

  it('returns 503 when circuit breaker is open', async () => {
    const err = new Error('Circuit breaker is open') as any;
    err.constructor = { name: 'OpenCircuitError' };
    vi.mocked(clients.getCustomer).mockRejectedValue(err);

    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, items: [{ productId: 1, quantity: 1 }] });

    expect(res.status).toBe(503);
  });
});

describe('GET /api/orders/:id', () => {
  it('returns 200 with order data', async () => {
    vi.mocked(db.getOrderById).mockReturnValue({ id: 1, orderNumber: 'ORD-0001' } as any);

    const res = await request(app).get('/api/orders/1');
    expect(res.status).toBe(200);
    expect(res.body.orderNumber).toBe('ORD-0001');
  });

  it('returns 404 for unknown order', async () => {
    vi.mocked(db.getOrderById).mockReturnValue(null);

    const res = await request(app).get('/api/orders/99999');
    expect(res.status).toBe(404);
  });
});
```

### D. Testing Zod Validation Schemas

Zod is already used in `routes.ts`[^8] for request validation. Schema logic can be unit tested in isolation:

```typescript
// order-service/src/schemas.test.ts
import { describe, it, expect } from 'vitest';
import { CreateOrderSchema } from './schemas.js'; // extract schema to separate file

describe('CreateOrderSchema', () => {
  it('accepts a valid order', () => {
    const result = CreateOrderSchema.safeParse({
      customerId: 1,
      items: [{ productId: 1, quantity: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects quantity of zero', () => {
    const result = CreateOrderSchema.safeParse({
      customerId: 1,
      items: [{ productId: 1, quantity: 0 }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain('quantity');
  });

  it('rejects empty items array', () => {
    const result = CreateOrderSchema.safeParse({ customerId: 1, items: [] });
    expect(result.success).toBe(false);
  });
});
```

---

## Scalability Patterns

As usage triples, the test suite must scale without becoming a bottleneck. Key patterns:

### 1. Dependency Injection (DI)

The most important architectural change for testability. Instead of importing `db.ts` and `clients.ts` directly in routes, pass them as parameters:

```typescript
// Before (hard to test)
import { getAllOrders } from './db.js';
router.get('/', (req, res) => { const orders = getAllOrders(); ... });

// After (easily testable)
export function createOrderRouter(deps: { getAllOrders: typeof getAllOrders, getCustomer: typeof getCustomer }) {
  const router = Router();
  router.get('/', (req, res) => { const orders = deps.getAllOrders(); ... });
  return router;
}
```

In tests, inject mocks. In production, inject real implementations. This eliminates the need for `vi.mock()` module-level mocking.[^4]

### 2. Parallel Test Execution with Sharding

As the test suite grows, shard across CI jobs:

```yaml
# .github/workflows/unit-tests.yml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npx vitest run --shard=${{ matrix.shard }}/4
```

Vitest's `--shard` flag splits the test suite evenly across workers — 4 parallel jobs = 4× throughput.[^9]

### 3. Test-Data Builders (Factories)

Avoid repeating test fixture setup. Create typed factories:

```typescript
// tests/factories/order.ts
import type { Order } from '../../src/types.js';

export function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    orderNumber: 'ORD-0001',
    customerId: 1,
    status: 'PENDING',
    totalAmount: 9.99,
    items: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
```

Usage: `buildOrder({ status: 'CONFIRMED', totalAmount: 199.99 })`. As new fields are added to `Order`, the factory provides safe defaults and TypeScript flags missing required fields.[^4]

### 4. Coverage Thresholds as Quality Gates

Enforce coverage in CI — fail the build if it drops below thresholds:

```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    lines: 80,
    functions: 80,
    branches: 70,
    statements: 80,
  },
}
```

```yaml
# .github/workflows/unit-tests.yml
- run: npm run test:coverage
```

Vitest exits with code 1 if any threshold is breached, failing the CI job.[^10]

### 5. Parametrized Tests with `test.each`

Avoid copy-paste test code for similar scenarios:

```typescript
test.each([
  [{ quantity: 0 },    400, 'zero quantity'],
  [{ quantity: -1 },   400, 'negative quantity'],
  [{ customerId: 0 },  400, 'invalid customer ID'],
])('returns 400 for %s', async (invalidField, expectedStatus, _label) => {
  const res = await request(app)
    .post('/api/orders')
    .send({ customerId: 1, items: [{ productId: 1, quantity: 1 }], ...invalidField });
  expect(res.status).toBe(expectedStatus);
});
```

### 6. In-Process SQLite for DB Tests

Since `db.ts` already uses SQLite `:memory:`[^5], DB-layer tests need **no Docker, no external database**. Tests run in milliseconds and are fully isolated. This is a critical scalability advantage — DB tests are as fast as pure unit tests.

---

## CI/CD Integration

Add a dedicated unit test workflow that runs on every PR:

```yaml
# .github/workflows/unit-tests.yml
name: Unit Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [order-service, customer-service, inventory-service, api-gateway]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: ${{ matrix.service }}/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: ${{ matrix.service }}

      - name: Run unit tests with coverage
        run: npm run test:coverage
        working-directory: ${{ matrix.service }}

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        with:
          name: coverage-${{ matrix.service }}
          path: ${{ matrix.service }}/coverage/
```

Key design decisions:
- **Matrix strategy** runs all 4 services in parallel — total CI time = slowest service, not sum of all
- **`npm ci`** (not `npm install`) for reproducible installs
- **Coverage artifacts** uploaded for every run — enables trend tracking

---

## Mocking Reference

| What to Mock | Tool | How |
|---|---|---|
| Axios HTTP calls | `vi.mock('axios')` | Replace `.get`/`.post` with `vi.fn()` |
| Module imports | `vi.mock('./module')` | Auto-mocks all exports |
| Timers / `Date.now()` | `vi.useFakeTimers()` | Control time in tests |
| Circuit breaker (Opossum) | `vi.mock('./clients')` | Mock the exported functions, not Opossum internals |
| Environment variables | `vi.stubEnv('KEY', 'val')` | Scoped to test, restored after |
| SQLite | **Don't mock** | Use real `:memory:` DB |
| Console output | `vi.spyOn(console, 'log')` | Assert or suppress logs |

---

## Framework Quick-Start Commands

```bash
# Install (run in each service directory)
npm install --save-dev vitest @vitest/coverage-v8 supertest @types/supertest

# Run all tests once
npm test

# Run in watch mode (instant re-runs on file change)
npm run test:watch

# Run with coverage report
npm run test:coverage

# Run specific file
npx vitest run src/routes.test.ts

# Run tests matching a pattern
npx vitest run --reporter=verbose -t "POST /api/orders"

# Open visual UI (browser-based test explorer)
npx vitest --ui
```

---

## Key Repositories and References

| Resource | URL | Purpose |
|---|---|---|
| Vitest | [vitest.dev](https://vitest.dev) | Primary framework docs |
| Vitest Config Reference | [vitest.dev/config](https://vitest.dev/config) | All config options |
| @vitest/coverage-v8 | [vitest.dev/guide/coverage](https://vitest.dev/guide/coverage) | Coverage setup |
| supertest | [github.com/ladjs/supertest](https://github.com/ladjs/supertest) | Express HTTP testing |
| Vitest vs Jest 2025 | [speakeasy.com/blog/vitest-vs-jest](https://www.speakeasy.com/blog/vitest-vs-jest) | Detailed comparison |
| Migration guide | [dev.to/atlaswhoff/vitest-20-vs-jest](https://dev.to/whoffagents/vitest-20-vs-jest-we-migrated-400-tests-and-heres-what-actually-changed-59hh) | Real migration data |

---

## Confidence Assessment

| Claim | Confidence | Basis |
|---|---|---|
| Vitest is faster than Jest for large TS codebases | **High** | Multiple independent benchmarks, migration reports |
| This codebase's `:memory:` SQLite eliminates DB mocking | **High** | Verified in `order-service/src/db.ts` directly |
| DI pattern is the most scalable approach | **High** | Industry consensus, test framework docs |
| 4–10× speed claim | **Medium** | Benchmark conditions vary; likely 2–5× in practice for this codebase size |
| Coverage thresholds (80% lines) | **Medium** | Industry norm; optimal % depends on team tolerance |
| CI sharding approach | **High** | Vitest `--shard` is a documented, stable feature |

---

## Footnotes

[^1]: Codebase analysis — no `*.test.ts` files found in any service's `src/` directories. Only E2E (Playwright in `/e2e/`) and load tests (k6 in `/load-tests/`) exist.

[^2]: `order-service/tsconfig.json` — `"target": "ES2022"`, `"module": "CommonJS"`, `"strict": true`. Vitest handles CommonJS natively.

[^3]: Vitest vs Jest benchmark data — [Vitest 2.0 vs Jest: We Migrated 400 Tests](https://dev.to/whoffagents/vitest-20-vs-jest-we-migrated-400-tests-and-heres-what-actually-changed-59hh); [Speakeasy: Vitest vs Jest](https://www.speakeasy.com/blog/vitest-vs-jest)

[^4]: TypeScript unit testing best practices — [Microsoft TypeScript Handbook](https://www.typescriptlang.org/docs/); industry-standard DI and factory patterns.

[^5]: `order-service/src/db.ts:4` — `const db = new Database(':memory:')`. The entire schema is created fresh per process startup.

[^6]: `order-service/src/clients.ts:1-10` — Axios with Opossum `CircuitBreaker` wrapping `getCustomerFn` and `getProductFn`. Timeout: 5000ms, errorThreshold: 50%, resetTimeout: 10000ms.

[^7]: `order-service/src/routes.ts:1-15` — Express Router importing from `db.js` and `clients.js` with Zod validation via `CreateOrderSchema`.

[^8]: `order-service/src/routes.ts:14-32` — `CreateOrderSchema` using `z.object()` with `z.number()`, `z.array().nonempty()`, and `z.number().int().min(1)`.

[^9]: [Vitest Sharding Documentation](https://vitest.dev/guide/improving-performance.html#sharding) — stable feature since Vitest 0.32.

[^10]: [Vitest Coverage Thresholds](https://vitest.dev/config/#coverage-thresholds) — exits with code 1 when any threshold is not met, failing CI jobs.
