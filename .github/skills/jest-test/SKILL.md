---
name: jest-test
description: This skill helps scaffold unit tests for this service in the mono repo. It includes best practices for testing with Jest and supertest, as well as patterns for mocking external dependencies and using real in-memory databases. Use when creating new jest tests for services or when adding jest tests to existing services that lack coverage.
---

## Quick Start

**TL;DR:** To add tests to a service:

1. **Verify startup pattern** — Ensure `src/index.ts` exports `app` without auto-listening (see [Startup Pattern](#startup-pattern-test-safe-imports))
2. **Add npm test scripts** — Copy template from [Package.json Scripts](#packagejson-scripts-and-dependencies)
3. **Create jest.config.js** — Copy template from [jest.config.js](#jestconfigjs)
4. **Create tests directory** — Follow [File Naming & Organization](#file-naming--organization)
5. **Use mock templates** — Reference [Mock Object Templates](#mock-object-templates) for your service
6. **Run tests** — `cd [service-name] && npm test`

For service-specific patterns, jump to [Service-Specific Testing Patterns](#service-specific-testing-patterns).

---

## Overview

This monorepo uses **Jest + supertest** for service-level unit tests. All 5 services have comprehensive test suites (90 tests total) that validate:
- Route handlers and middleware
- Request validation and error handling
- Business logic and state management
- Integration with in-memory databases
- External service mocking (Eureka, HTTP clients)

**Run tests anywhere:**
```bash
cd [service-name] && npm test
cd [service-name] && npm test -- --watch
```

---

## Setup Checklist

Before adding unit tests to a service, ensure these prerequisites:

### 1. Startup Pattern (Test-Safe Imports)

The service must NOT auto-listen when imported for testing. Wrap `app.listen()`:

```typescript
// server.ts or src/index.ts
import express from 'express';

const app = express();

// ... middleware and routes ...

// Only listen if this is the main module (not imported for testing)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export { app };
```

**Why?** Without this, `npm test` will hang because the service tries to bind the port. Tests need the `app` object without starting the server.

### 2. Package.json Scripts and Dependencies

Add test scripts:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "supertest": "^6.3.3",
    "@types/jest": "^29.5.8",
    "@types/supertest": "^2.0.12"
  }
}
```

### 3. jest.config.js

Create at root of service directory:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
```

### 4. tsconfig.json Updates

Add Jest types and test files to include:

```json
{
  "compilerOptions": {
    "types": ["jest", "node"]
  },
  "include": ["src/**/*", "tests/**/*", "*.ts"]
}
```

### 5. Post-Install Setup

After `npm install`, rebuild native modules:

```bash
npm rebuild
```

(Required for `better-sqlite3` and similar native dependencies.)

---

## Core Principles

### ✅ Mock External Dependencies

Mock HTTP clients, service registries, and external APIs:

```typescript
jest.mock('../src/eureka');
jest.mock('../src/clients'); // HTTP client wrappers

// Import mocked modules
import * as clients from '../src/clients';
const mockClients = clients as jest.Mocked<typeof clients>;
```

**What to mock:**
- Eureka service registration
- axios/HTTP clients
- External APIs
- Circuit breakers (Opossum)

### ✅ Test with Real In-Memory Databases

**Don't mock the database layer.** Use real in-memory SQLite:

```typescript
// ✅ GOOD: Test against real in-memory DB
import request from 'supertest';
import { app } from '../src/index';

describe('customer-service', () => {
  it('creates a customer', async () => {
    const response = await request(app)
      .post('/api/customers')
      .send({ firstName: 'John', email: 'john@example.com', ... });

    expect(response.status).toBe(201);
  });
});

// ❌ BAD: Mocking database bypasses integration testing
jest.mock('../src/db'); // Don't do this
```

**Why?** Real in-memory DB:
- Tests actual SQL and constraints
- Catches data type mismatches
- Validates uniqueness constraints
- Simple and deterministic
- Matches production behavior

### ✅ Reset State Between Tests

For services with in-memory state (e.g., notifications), reset it:

```typescript
beforeEach(() => {
  jest.clearAllMocks();
  resetStore(); // Service-specific reset function
});
```

---

## Test Isolation & Flakiness Prevention

Flaky tests (that pass/fail inconsistently) are common in monorepos. Prevent them:

### ✅ Clear Mocks Between Tests

Always reset mocks in `beforeEach()` to prevent state leakage:

```typescript
beforeEach(() => {
  jest.clearAllMocks(); // Clears call history and implementations
  jest.resetAllMocks(); // Same, but also resets internal state
});
```

### ✅ Reset In-Memory Databases

For services with persistent in-memory state:

```typescript
beforeEach(() => {
  // Clear the SQLite in-memory database
  db.exec('DELETE FROM customers');
  db.exec('DELETE FROM orders');
  // Or use a service-specific reset:
  resetDatabase();
});
```

### ✅ Avoid Hardcoded Delays and Timeouts

**Don't use `setTimeout` or delay assertions:**

```typescript
// ❌ BAD: Flaky, depends on system load
it('eventually completes', async () => {
  startAsyncOperation();
  await new Promise(r => setTimeout(r, 100));
  expect(result).toBe('done');
});

// ✅ GOOD: Wait for actual condition
it('eventually completes', async () => {
  await waitFor(() => {
    expect(result).toBe('done');
  });
});
```

### ✅ Use Deterministic Test Data

Avoid timestamps, random IDs, or environment-dependent values in assertions:

```typescript
// ❌ BAD: Timestamp changes every run
expect(response.body.createdAt).toBe(new Date().toISOString());

// ✅ GOOD: Use matchers
expect(response.body.createdAt).toEqual(expect.any(String));
expect(response.body.createdAt).toMatch(/\d{4}-\d{2}-\d{2}/);
```

### ✅ Isolate Mock Setup Per Test

Don't share mock setup across tests \u2014 each test should configure its mocks independently:

```typescript
// ❌ BAD: Shared mock state
jest.mock('../src/clients');
const mockClients = clients as jest.Mocked<typeof clients>;
mockClients.getCustomer.mockResolvedValue(mockCustomer); // Applies to all tests

describe('orders', () => {
  it('test 1', ...) // Uses shared mock
  it('test 2', ...) // Also uses shared mock, can conflict
});

// ✅ GOOD: Per-test setup
describe('orders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('test 1', async () => {
    mockClients.getCustomer.mockResolvedValue(mockCustomer);
    // ...
  });

  it('test 2', async () => {
    mockClients.getCustomer.mockRejectedValue(new Error('Not found'));
    // ...
  });
});
```

---

## File Naming & Organization

Consistent file structure makes tests easy to locate and maintain.

### Directory Structure

```
[service-name]/
├── src/
│   ├── index.ts           # Main app entry point
│   ├── routes.ts          # Express route handlers
│   ├── controllers/
│   │   ├── customer.ts
│   │   ├── order.ts
│   ├── services/
│   │   ├── business-logic.ts
│   ├── db.ts              # Database initialization
│   ├── eureka.ts          # Eureka registration
│   └── clients.ts         # HTTP client wrappers
├── tests/                 # All test files here
│   ├── routes.test.ts     # Tests for src/routes.ts
│   ├── health.test.ts     # Tests for health endpoint
│   ├── controllers/
│   │   ├── customer.test.ts
│   │   ├── order.test.ts
│   ├── services/
│   │   ├── business-logic.test.ts
│   ├── setup.ts           # Shared test utilities
│   ├── mocks.ts           # Mock objects (see Mock Object Templates)
│   └── fixtures/
│       └── sample-data.ts
├── jest.config.js
├── tsconfig.json
└── package.json
```

### Naming Conventions

| File Type | Pattern | Example |
|-----------|---------|---------|
| Source file | `src/[feature].ts` | `src/routes.ts`, `src/db.ts` |
| Test file | `tests/[feature].test.ts` | `tests/routes.test.ts` |
| Sub-feature source | `src/[category]/[feature].ts` | `src/controllers/order.ts` |
| Sub-feature test | `tests/[category]/[feature].test.ts` | `tests/controllers/order.test.ts` |
| Mock objects | `tests/mocks.ts` | Centralized mock templates |
| Test utilities | `tests/setup.ts` | Helper functions, reset logic |
| Sample data | `tests/fixtures/[domain].ts` | `tests/fixtures/sample-data.ts` |

### Example: Organizing Tests for Order Service

```typescript
// src/controllers/order.ts
export function createOrder(req, res) { ... }

// src/services/order-processor.ts
export function processOrder(order) { ... }

// tests/controllers/order.test.ts
describe('Order Controller', () => {
  it('creates order', ...) // Tests createOrder()
});

// tests/services/order-processor.test.ts
describe('Order Processor', () => {
  it('processes order', ...) // Tests processOrder()
});

// tests/mocks.ts
export const mockOrder = { ... };
export const mockCustomer = { ... };

// tests/setup.ts
export function resetDatabase() { ... }
```

---

## Mock Object Templates

Create mock objects with **all required fields** to prevent TypeScript errors and runtime failures.

### Order Service

**Order Object:**
```typescript
const mockOrder = {
  id: 1,
  customerId: 1,
  orderNumber: 'ORD-1234567890-ABC',
  status: 'CONFIRMED',
  totalAmount: 100.00,
  shippingAddress: null,
  shippingCity: null,
  shippingState: null,
  shippingZip: null,
  shippingCountry: null,
  items: [
    {
      id: 1,
      productId: 101,
      productName: 'Widget',
      productSku: 'WDG-001',
      quantity: 1,
      unitPrice: 29.99,
      subtotal: 29.99,
    },
  ],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
} as any;
```

**Customer DTO:**
```typescript
const mockCustomer = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
};
```

**Product DTO:**
```typescript
const mockProduct = {
  id: 101,
  name: 'Widget',
  sku: 'WDG-001',
  price: 29.99,
  stockQuantity: 100,
};
```

### Inventory Service

**Product Object:**
```typescript
const mockProduct = {
  id: 1,
  name: 'Laptop',
  sku: 'LAP-001',
  description: 'High-performance laptop',
  price: 999.99,
  stockQuantity: 50,
  category: 'Electronics',
  reorderLevel: 10,
  active: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};
```

### Customer Service

**Customer Row (database):**
```typescript
const mockCustomerRow = {
  id: 1,
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@example.com',
  phone: '555-0101',
  address: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  zip_code: '62701',
  country: 'USA',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: null,
};
```

### Notifications Service

**Notification Object:**
```typescript
const mockNotification = {
  id: 'uuid-1234-5678',
  channel: 'email',
  to: 'user@example.com',
  subject: 'Order Confirmation',
  body: 'Your order has been placed',
  status: 'sent',
  createdAt: '2024-01-01T00:00:00Z',
};
```

---

## Common Test Patterns

### Test Structure

```typescript
import request from 'supertest';
import { app } from '../src/index';

jest.mock('../src/eureka');
jest.mock('../src/clients');

describe('service-name', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Health Endpoint', () => {
    it('returns UP status', async () => {
      const response = await request(app)
        .get('/actuator/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'UP' });
    });
  });

  describe('GET routes', () => {
    it('lists all items', async () => {
      const response = await request(app).get('/api/items');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns 404 for missing item', async () => {
      const response = await request(app).get('/api/items/9999');

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST routes', () => {
    it('creates item with valid payload', async () => {
      const newItem = { name: 'Test', email: 'test@example.com' };

      const response = await request(app)
        .post('/api/items')
        .send(newItem);

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
    });

    it('rejects invalid payload', async () => {
      const invalidItem = { name: 'Test' }; // missing email

      const response = await request(app)
        .post('/api/items')
        .send(invalidItem);

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('rejects duplicate unique constraint', async () => {
      const duplicate = {
        name: 'Test',
        email: 'existing@example.com', // Already exists
      };

      const response = await request(app)
        .post('/api/items')
        .send(duplicate);

      expect(response.status).toBe(409);
    });
  });
});
```

### Mocking External HTTP Clients

```typescript
import * as clients from '../src/clients';
const mockClients = clients as jest.Mocked<typeof clients>;

describe('external calls', () => {
  it('calls getCustomer on downstream service', async () => {
    mockClients.getCustomer.mockResolvedValue({
      id: 1,
      name: 'John',
      email: 'john@example.com',
    });

    const response = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, items: [] });

    expect(mockClients.getCustomer).toHaveBeenCalledWith(1);
  });

  it('handles downstream service errors', async () => {
    mockClients.getCustomer.mockRejectedValue(
      new Error('Service unavailable')
    );

    const response = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, items: [] });

    expect(response.status).toBe(500);
  });
});
```

### Testing Async Operations

```typescript
it('creates order and reserves stock', async () => {
  mockClients.getCustomer.mockResolvedValue(mockCustomer);
  mockClients.getProduct.mockResolvedValue(mockProduct);
  mockClients.reserveStock.mockResolvedValue(true);

  const response = await request(app)
    .post('/api/orders')
    .send({
      customerId: 1,
      items: [{ productId: 101, quantity: 5 }],
    });

  expect(response.status).toBe(201);
  expect(mockClients.reserveStock).toHaveBeenCalledWith(101, 5);
});
```

---

## TypeScript & Jest Type Casting

### Using `as any` for Complex Mocks

When Jest's strict typing conflicts with your mock structure, use `as any`:

```typescript
const mockDb = db as any;

mockDb.prepare = jest.fn().mockReturnValue({
  all: jest.fn(() => [...items]),
  get: jest.fn(() => items[0]),
  run: jest.fn(() => ({ changes: 1 })),
});
```

### Mocking with Proper Types

For HTTP clients, use `jest.Mocked`:

```typescript
import * as clients from '../src/clients';

const mockClients = clients as jest.Mocked<typeof clients>;

// Now TypeScript knows the mock methods exist
mockClients.getCustomer.mockResolvedValue(...);
```

---

## Service-Specific Testing Patterns

Each service has unique testing needs. Use these patterns as templates.

### Order Service \u2014 Testing Cascade Calls

Order service calls **customer-service** (to validate customer) and **inventory-service** (to reserve stock). Mock both:

```typescript
import request from 'supertest';
import { app } from '../src/index';
import * as clients from '../src/clients';

const mockClients = clients as jest.Mocked<typeof clients>;

jest.mock('../src/clients');

describe('Order Service \u2014 Cascade Calls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates order after validating customer and reserving stock', async () => {
    mockClients.getCustomer.mockResolvedValue({
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
    });
    mockClients.getProduct.mockResolvedValue({
      id: 101,
      name: 'Widget',
      price: 29.99,
    });
    mockClients.reserveStock.mockResolvedValue(true);

    const response = await request(app)
      .post('/api/orders')
      .send({
        customerId: 1,
        items: [{ productId: 101, quantity: 5 }],
      });

    expect(response.status).toBe(201);
    expect(mockClients.getCustomer).toHaveBeenCalledWith(1);
    expect(mockClients.reserveStock).toHaveBeenCalledWith(101, 5);
  });

  it('returns 400 when customer not found', async () => {
    mockClients.getCustomer.mockRejectedValue(new Error('Not found'));

    const response = await request(app)
      .post('/api/orders')
      .send({
        customerId: 9999,
        items: [{ productId: 101, quantity: 5 }],
      });

    expect(response.status).toBe(400);
  });

  it('returns 409 when stock cannot be reserved', async () => {
    mockClients.getCustomer.mockResolvedValue({ id: 1, name: 'John' });
    mockClients.reserveStock.mockResolvedValue(false); // Stock unavailable

    const response = await request(app)
      .post('/api/orders')
      .send({
        customerId: 1,
        items: [{ productId: 101, quantity: 5 }],
      });

    expect(response.status).toBe(409);
  });
});
```

### Customer Service \u2014 Testing DB Constraints

Customer service uses in-memory SQLite. Test uniqueness and validation:

```typescript
import request from 'supertest';
import { app } from '../src/index';
import { initDb } from '../src/db';

describe('Customer Service \u2014 DB Constraints', () => {
  beforeEach(async () => {
    // Reset database for each test
    initDb(); // Re-init in-memory DB
  });

  it('creates customer with valid data', async () => {
    const response = await request(app)
      .post('/api/customers')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phone: '555-0101',
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
  });

  it('rejects duplicate email (unique constraint)', async () => {
    // Create first customer
    await request(app)
      .post('/api/customers')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      });

    // Try to create duplicate
    const response = await request(app)
      .post('/api/customers')
      .send({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'john@example.com', // Same email
      });

    expect(response.status).toBe(409); // Conflict
  });

  it('validates required fields', async () => {
    const response = await request(app)
      .post('/api/customers')
      .send({
        firstName: 'John',
        // Missing lastName, email, phone
      });

    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
  });
});
```

### Inventory Service \u2014 Testing Stock Management

Inventory service manages stock levels. Test reservations and updates:

```typescript
import request from 'supertest';
import { app } from '../src/index';

describe('Inventory Service \u2014 Stock Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reserves stock and decrements quantity', async () => {
    // Create product with 100 units
    const createRes = await request(app)
      .post('/api/products')
      .send({
        name: 'Laptop',
        sku: 'LAP-001',
        price: 999.99,
        stockQuantity: 100,
      });
    const productId = createRes.body.id;

    // Reserve 5 units
    const reserveRes = await request(app)
      .post(`/api/products/${productId}/reserve`)
      .send({ quantity: 5 });

    expect(reserveRes.status).toBe(200);
    expect(reserveRes.body.stockQuantity).toBe(95);
  });

  it('rejects reservation when stock insufficient', async () => {
    const createRes = await request(app)
      .post('/api/products')
      .send({
        name: 'Rare Item',
        sku: 'RARE-001',
        price: 199.99,
        stockQuantity: 3, // Only 3 in stock
      });
    const productId = createRes.body.id;

    const reserveRes = await request(app)
      .post(`/api/products/${productId}/reserve`)
      .send({ quantity: 5 }); // Request 5

    expect(reserveRes.status).toBe(409);
  });
});
```

### Notifications Service \u2014 Testing In-Memory Store

Notifications service stores notifications in memory. Test state management:

```typescript
import request from 'supertest';
import { app } from '../src/index';
import { resetStore } from '../src/store'; // Service-specific reset

describe('Notifications Service \u2014 In-Memory Store', () => {
  beforeEach(() => {
    resetStore(); // Clear in-memory notifications
    jest.clearAllMocks();
  });

  it('sends and stores notification', async () => {
    const response = await request(app)
      .post('/api/notifications')
      .send({
        channel: 'email',
        to: 'user@example.com',
        subject: 'Order Confirmation',
        body: 'Your order has been placed',
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    expect(response.body.status).toBe('sent');
  });

  it('lists all notifications', async () => {
    // Send 3 notifications
    await request(app).post('/api/notifications').send({
      channel: 'email',
      to: 'user1@example.com',
      subject: 'Test 1',
      body: 'Body 1',
    });
    await request(app).post('/api/notifications').send({
      channel: 'sms',
      to: '555-1234',
      subject: 'Test 2',
      body: 'Body 2',
    });

    const response = await request(app).get('/api/notifications');

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(2);
  });

  it('retrieves notification by ID', async () => {
    const createRes = await request(app)
      .post('/api/notifications')
      .send({
        channel: 'email',
        to: 'user@example.com',
        subject: 'Test',
        body: 'Body',
      });
    const notificationId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/notifications/${notificationId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(notificationId);
  });
});
```

### API Gateway \u2014 Testing Proxy and Middleware

API Gateway routes requests to downstream services. Test proxy logic and middleware:

```typescript
import request from 'supertest';
import { app } from '../src/index';

jest.mock('http-proxy-middleware');
import { createProxyMiddleware } from 'http-proxy-middleware';

describe('API Gateway \u2014 Proxy Routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('proxies /api/customers to customer-service', async () => {
    const response = await request(app)
      .get('/api/customers');

    // Verify proxy middleware was set up (via mock)
    expect(createProxyMiddleware).toHaveBeenCalled();
  });

  it('adds auth header before proxying', async () => {
    const response = await request(app)
      .get('/api/orders')
      .set('Authorization', 'Bearer token123');

    expect(response.status).toBe(200);
  });

  it('returns 401 when auth header missing', async () => {
    const response = await request(app)
      .get('/api/protected-endpoint');

    expect(response.status).toBe(401);
  });
});
```

---

## Running Tests

### Basic Commands

```bash
# Run all tests in a service
cd customer-service
npm test

# Watch mode (re-run on file change)
npm test -- --watch

# Coverage report
npm test -- --coverage

# Run specific test file
npm test -- tests/customer.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="creates"
```

### From Repo Root

Run all service tests:

```bash
# Customer service
cd customer-service && npm test

# Inventory service
cd inventory-service && npm test

# Order service
cd order-service && npm test

# Notifications service
cd notifications-service && npm test

# Demo UI
cd demo-ui && npm test
```

---

## Coverage Targets

Maintain minimum coverage standards to catch regressions early.

### Coverage Metrics

| Metric | Target | What It Measures |
|--------|--------|------------------|
| **Lines** | 80% | What percentage of lines were executed |
| **Branches** | 75% | Decision paths (if/else, loops, etc.) |
| **Functions** | 80% | Named functions and methods |
| **Statements** | 80% | Individual statements executed |

### Checking Coverage

```bash
# Generate coverage report
npm test -- --coverage

# Coverage report output:
#  % Stmts   % Branch % Funcs % Lines
#  75.50%    72.41%   77.27%  75.50%

# HTML report (view in browser)
open coverage/lcov-report/index.html
```

### Coverage by Service

| Service | Current Coverage | Target |
|---------|------------------|--------|
| customer-service | 82% | 80% |
| inventory-service | 78% | 80% |
| order-service | 85% | 80% |
| notifications-service | 79% | 80% |
| api-gateway | 76% | 80% |
| demo-ui | 72% | 70% |

### Improving Coverage

Focus on high-risk code:

1. **Error paths** — Cover 4xx and 5xx responses
2. **Validation** — Test invalid inputs
3. **Edge cases** — Boundary conditions, empty data, null checks
4. **Business logic** — Complex calculations, state transitions

**Don't aim for 100%** — Some code (e.g., error handlers) is expensive to test and low-risk.

---

## CI/Coverage Integration

### GitHub Actions Workflow

Tests run automatically on every pull request. See `.github/workflows/test.md`:

```bash
# Runs in CI:
npm install
npm test -- --coverage

# Fails if:
# - Any test fails
# - Coverage drops below 80%
# - TypeScript compilation errors
```

### CI Failure Examples

| Failure | Typical Cause | How to Debug |
|---------|---------------|--------------|
| `● customer-service › creates customer › fails` | Logic bug or constraint violation | `npm test -- tests/routes.test.ts --verbose` |
| `FAIL tests/routes.test.ts (12.5s)` | Hangs or timeout | Check for `app.listen()` in src/index.ts |
| `Coverage is below 80%` | Untested code paths | `npm test -- --coverage` and add tests |
| `Cannot find module '../src/db'` | Mock path incorrect | Verify mock path relative to test file |

---

## Troubleshooting

### Issue: `NODE_MODULE_VERSION` Mismatch

```
Error: The module '.../better_sqlite3.node' was compiled against a different Node.js version
```

**Fix:**
```bash
npm rebuild
```

### Issue: `Cannot find module '../src/db'`

**Cause:** Mock path doesn't match actual structure  
**Fix:** Verify path relative to test file:

```bash
# If test is at tests/customer.test.ts and db is at src/db.ts
jest.mock('../src/db'); // ✅ Correct

# NOT:
jest.mock('./src/db');  // ❌ Wrong
jest.mock('src/db');    // ❌ Wrong
```

### Issue: Tests Hang on Startup

**Cause:** Service auto-listens when imported  
**Fix:** Add startup pattern to `src/index.ts`:

```typescript
if (require.main === module) {
  app.listen(PORT);
}
export { app };
```

### Issue: `TypeError: Router.use() requires a middleware function`

**Cause:** Mock returns `undefined` instead of middleware  
**Fix:** Mock must return a function:

```typescript
jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn(() => (req, res, next) => next()),
}));
```

### Issue: Tests Pass Locally but Fail in CI

**Cause:** Mock isn't cleared between tests  
**Fix:** Add to `beforeEach`:

```typescript
beforeEach(() => {
  jest.clearAllMocks();
});
```

### Issue: "Property does not exist on type Mocked"

**Cause:** TypeScript doesn't recognize mock methods  
**Fix:** Use `as any` or `jest.Mocked<typeof module>`:

```typescript
// Option 1: Use as any
const mockDb = db as any;
mockDb.prepare(...);

// Option 2: Use jest.Mocked
const mockDb = db as jest.Mocked<typeof db>;
```

---

## Troubleshooting Monorepo-Specific Issues

### Issue: Tests Pass Locally but Fail in CI

**Cause:** Tests depend on execution order or shared state (common in monorepos)

**Fix:** Run tests in random order to catch state leakage:

```bash
npm test -- --randomize
```

Add to jest.config.js for consistent randomization:

```javascript
module.exports = {
  // ...
  randomize: true,
  randomizeBufferSize: 100,
};
```

### Issue: Mock Conflicts Between Services

**Cause:** Multiple services share utilities, mock in one test affects others

**Fix:** Use unique mock implementations per service:

```typescript
// ❌ BAD: Shared mock
jest.mock('../shared/utils');
const mockUtils = require('../shared/utils') as jest.Mocked<typeof import('../shared/utils')>;

describe('Service A', () => {
  it('test 1', () => {
    mockUtils.doSomething.mockReturnValue('A'); // This leaks to Service B tests
  });
});

// ✅ GOOD: Service-specific mock factory
function createMockUtils() {
  return {
    doSomething: jest.fn().mockReturnValue('default'),
  };
}

describe('Service A', () => {
  let mockUtils = createMockUtils();

  beforeEach(() => {
    mockUtils = createMockUtils(); // Fresh instance per test
  });

  it('test 1', () => {
    mockUtils.doSomething.mockReturnValue('A');
  });
});
```

### Issue: Module Resolution Fails in Monorepo

**Cause:** Different services have different `tsconfig.json` or `jest.config.js` settings

**Fix:** Verify each service has correct paths:

```bash
# List resolved modules (debug)
node -e "console.log(require.resolve('../src/db'))"

# If resolution fails, check:
# 1. jest.config.js moduleNameMapper
# 2. tsconfig.json paths
# 3. Import path is relative to test file, not service root
```

**Example:**

```typescript
// ✅ CORRECT: Relative to test file
jest.mock('../../src/db'); // If test is at tests/routes.test.ts

// ❌ WRONG: Absolute paths don't work in monorepo
jest.mock('src/db');
jest.mock('/src/db');
```

### Issue: Eureka Mock Doesn't Work in Monorepo

**Cause:** Multiple services try to register with mock Eureka, conflicts

**Fix:** Mock before importing app:

```typescript
// ✅ CORRECT: Mock before import
jest.mock('../src/eureka');
import { app } from '../src/index'; // Now imports mocked eureka

// ❌ WRONG: Mock after import
import { app } from '../src/index';
jest.mock('../src/eureka'); // Too late, eureka already imported
```

### Issue: Tests Slow Down Over Time in Monorepo

**Cause:** Accumulating in-memory databases or mock state

**Fix:** Explicitly reset and clean up:

```typescript
afterEach(() => {
  // Close database connections
  if (db) db.close();
  
  // Clear all mocks
  jest.clearAllMocks();
  jest.resetModules(); // Reset module cache
});

afterAll(() => {
  // Close server connections
  if (server) server.close();
});
```

### Issue: "EADDRINUSE" Error (Port Already Bound)

**Cause:** Previous test didn't close the server

**Fix:** Ensure startup pattern exports app without listening:

```typescript
// src/index.ts
export const app = express();

// Only listen when main module
if (require.main === module) {
  app.listen(PORT);
}
```

**And test doesn't start server:**

```typescript
import { app } from '../src/index';
import request from 'supertest';

// ✅ CORRECT: supertest starts server internally
const response = await request(app).get('/health');

// ❌ WRONG: Starts server manually
const server = app.listen(3000);
// ...
```

---

## Best Practices

### ✅ Do

- **Test against real in-memory databases** — catches constraint violations and SQL errors
- **Mock only external dependencies** — Eureka, HTTP clients, third-party APIs
- **Reset mocks in beforeEach** — prevents state leakage between tests
- **Test both success and error paths** — validation, 404s, 409s, 500s
- **Use descriptive test names** — "returns 404 when customer not found"
- **Group related tests with describe()** — organize by route or feature
- **Test at the route level** — use supertest, not unit functions directly

### ❌ Don't

- **Mock the database layer** — test with real in-memory SQLite
- **Skip error scenarios** — validation, conflicts, not-found cases are critical
- **Use hardcoded timestamps/IDs in assertions** — use matchers like `expect.any(Number)`
- **Forget to clear mocks** — causes false failures and state leakage
- **Test implementation details** — test behavior, not how functions work internally
- **Skip the startup pattern** — services must not auto-listen during testing

---

## Integration with Docker & Docker Compose

Unit tests don't require the full stack running. They use:
- Real in-memory SQLite (no external DB needed)
- Mocked service calls (no Eureka needed)
- Mocked HTTP clients (no downstream services needed)

To run tests in Docker:

```dockerfile
FROM node:20

WORKDIR /app
COPY . .
RUN npm ci

# Run tests
CMD ["npm", "test"]
```

---

## Next Steps

1. **Start with Quick Start** — New to testing? Jump to [Quick Start](#quick-start) for the TL;DR
2. **Check Service Status** — Is your service in [Service Readiness Status](#service-readiness-status)? If not, follow [Setup Checklist](#setup-checklist)
3. **Use Service-Specific Patterns** — Pick your service from [Service-Specific Testing Patterns](#service-specific-testing-patterns) and copy the pattern
4. **Run and Monitor Coverage** — `npm test -- --coverage` to check your coverage against [Coverage Targets](#coverage-targets)
5. **Debug Flakiness** — Tests failing inconsistently? See [Test Isolation & Flakiness Prevention](#test-isolation--flakiness-prevention)
6. **Deploy with Confidence** — Check [CI/Coverage Integration](#cicoverage-integration) to understand how tests run in GitHub Actions

---

## Related Skills

- **[e2e-testing](../e2e-testing/SKILL.md)** — End-to-end testing patterns with Playwright
- **[chaos-scenario](../chaos-scenario/SKILL.md)** — Fault injection, resilience testing, and chaos engineering
- **[eureka-microservice](../eureka-microservice/SKILL.md)** — Scaffolding new services with Eureka registration

