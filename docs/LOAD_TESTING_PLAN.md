# Load Testing Plan: E-Commerce Microservices

> **Project:** E-Commerce Microservices · TypeScript/Node.js · Express + better-sqlite3  
> **Load tool:** k6 (TypeScript, bundled with esbuild)

---

## Table of Contents

1. [Overview & Goals](#1-overview--goals)
2. [Tooling Selection](#2-tooling-selection)
3. [Baseline Measurements](#3-baseline-measurements)
4. [Test Scenarios — k6](#4-test-scenarios--k6)
5. [Gatling Setup](#5-gatling-setup)
6. [Performance Thresholds & SLOs](#6-performance-thresholds--slos)
7. [Test Data Strategy](#7-test-data-strategy)
8. [Metrics Collection](#8-metrics-collection)
9. [Virtual Threads Benchmark](#9-virtual-threads-benchmark)
10. [Bottleneck Identification Guide](#10-bottleneck-identification-guide)
11. [CI/CD Integration](#11-cicd-integration)
12. [Reporting](#12-reporting)
13. [File Structure](#13-file-structure)
14. [Quick Start](#quick-start)

---

## 1. Overview & Goals

### Purpose

Synthetic load testing answers questions that unit and integration tests cannot:

| Question | Test Type |
|---|---|
| Does the system handle one user reliably? | Smoke Test |
| What is normal, expected performance? | Baseline Test |
| At what load does performance degrade? | Ramp-Up / Stress Test |
| Does the system recover from sudden spikes? | Spike Test |
| Do memory leaks exist under sustained load? | Soak Test |
| What is the max safe throughput? | Capacity Test |

### Service Topology Under Test

```
Client → API Gateway :8080
           ├── /api/customers  → customer-service :8081 → SQLite
           ├── /api/products   → inventory-service :8082 → SQLite
           └── /api/orders     → order-service :8083 → SQLite
                                    ├── axios → customer-service :8081
                                    └── axios → inventory-service :8082
```

Order creation is the **highest-value test target**: it exercises the gateway, the order service, two Feign client calls, and three separate H2 databases in a single request.

### Test Phases

| Phase | Goal |
|---|---|
| **Baseline** | Establish healthy single-user response times and resource usage at rest |
| **Load Test** | Validate expected-production throughput stays within SLOs |
| **Stress Test** | Find the breaking point — where errors begin and latency degrades |
| **Soak Test** | Detect memory leaks, connection exhaustion, and H2 growth over time |

### Java 25 Virtual Threads — Specific Hypothesis

Virtual threads (enabled via `spring.threads.virtual.enabled=true`) allow the JVM to park blocked threads at negligible cost. The hypothesis under test:

> At high concurrency (100+ VUs), a virtual-thread build should sustain significantly higher throughput and lower p99 latency than a platform-thread build, because Feign HTTP calls block the thread while waiting on downstream services.

---

## 2. Tooling Selection

### Primary: k6

| Property | Detail |
|---|---|
| Language | JavaScript / TypeScript |
| Model | VUs (virtual users), scenario stages |
| Metrics | Built-in: `http_req_duration`, `http_reqs`, `vus`, error rate |
| Output | stdout, JSON, InfluxDB, Prometheus, k6 Cloud |
| CI | Single binary — easy GitHub Actions integration |
| Best for | Synthetic API tests, threshold assertions, quick feedback loop |

**Install k6:**

```bash
# macOS (Homebrew)
brew install k6

# Linux (deb)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker (no install)
docker run --rm -i grafana/k6 run - < load-tests/k6/smoke.js
```

**Verify:**
```bash
k6 version
```

### Secondary: Gatling

| Property | Detail |
|---|---|
| Language | Scala DSL / Java DSL |
| Model | Inject users, open/closed models |
| Reports | Built-in HTML reports with percentile charts |
| Integration | Maven plugin (`io.gatling:gatling-maven-plugin`) |
| Best for | Complex simulations, detailed per-request metrics, stakeholder reports |

**Install Gatling (via Maven — no separate install needed):**

```bash
# Gatling runs via Maven plugin inside load-tests/
cd load-tests
mvn gatling:test
```

### When to Use Each

| Scenario | Tool |
|---|---|
| Quick API health check | k6 |
| CI gate — must pass thresholds | k6 |
| Regression comparison with HTML report | Gatling |
| Complex user journey with conditional logic | k6 |
| Stakeholder-facing performance report | Gatling |
| Virtual threads A/B comparison | Both |

---

## 3. Baseline Measurements

Before running any multi-VU tests, establish single-user baselines. These are your reference points for all future comparisons.

### 3.1 Endpoints to Baseline

```bash
BASE=http://localhost:8080

# List all (should hit cache-friendly paths)
curl -o /dev/null -s -w "%{time_total}\n" $BASE/api/customers
curl -o /dev/null -s -w "%{time_total}\n" $BASE/api/products
curl -o /dev/null -s -w "%{time_total}\n" $BASE/api/orders

# By ID (warm H2 lookup)
curl -o /dev/null -s -w "%{time_total}\n" $BASE/api/customers/1
curl -o /dev/null -s -w "%{time_total}\n" $BASE/api/products/1
curl -o /dev/null -s -w "%{time_total}\n" $BASE/api/orders/1

# Order creation — most complex path
curl -o /dev/null -s -w "%{time_total}\n" -X POST $BASE/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId":1,"items":[{"productId":2,"quantity":1}],"shippingAddress":"123 Main St","shippingCity":"New York","shippingState":"NY","shippingZip":"10001","shippingCountry":"USA"}'
```

### 3.2 JVM State at Rest

```bash
# Actuator endpoints (expose in application.properties: management.endpoints.web.exposure.include=*)
curl http://localhost:8081/actuator/metrics/jvm.memory.used
curl http://localhost:8081/actuator/metrics/jvm.threads.live
curl http://localhost:8082/actuator/metrics/jvm.memory.used
curl http://localhost:8083/actuator/metrics/jvm.memory.used
```

### 3.3 Expected Baselines (Targets Before Load Tests)

| Endpoint | Expected p50 | Expected p95 | Notes |
|---|---|---|---|
| `GET /api/customers` | < 20ms | < 50ms | H2 full table scan |
| `GET /api/customers/{id}` | < 10ms | < 30ms | H2 PK lookup |
| `GET /api/products` | < 20ms | < 50ms | |
| `GET /api/products/{id}` | < 10ms | < 30ms | |
| `GET /api/orders` | < 25ms | < 60ms | Includes JOIN to order items |
| `POST /api/orders` | < 100ms | < 250ms | Gateway + 2 Feign calls + H2 write |

---

## 4. Test Scenarios — k6

All scripts live in `load-tests/k6/`. Run from the project root:

```bash
k6 run load-tests/k6/<script>.js
```

### Shared Configuration

**`load-tests/k6/config.js`**
```javascript
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// Seed data IDs — matches DataInitializer.java
export const CUSTOMER_IDS = [1, 2, 3];
export const PRODUCT_IDS  = [1, 2, 3, 4, 5, 6];

export function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function orderPayload(customerId, productId, qty = 1) {
  return JSON.stringify({
    customerId,
    items: [{ productId, quantity: qty }],
    shippingAddress: '123 Load Test Lane',
    shippingCity: 'Testville',
    shippingState: 'TS',
    shippingZip: '00000',
    shippingCountry: 'USA',
  });
}
```

---

### T1: Smoke Test

**Goal:** Verify the system works at all. Catch deploy-time errors before multi-VU runs.

**`load-tests/k6/smoke.js`**
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, CUSTOMER_IDS, PRODUCT_IDS, randomItem, orderPayload } from './config.js';

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    http_req_failed:   ['rate<0.01'],          // <1% errors
    http_req_duration: ['p(95)<500'],          // p95 < 500ms
  },
};

export default function () {
  const params = { headers: { 'Content-Type': 'application/json' } };

  // Customers
  let res = http.get(`${BASE_URL}/api/customers`);
  check(res, { 'customers 200': (r) => r.status === 200 });

  res = http.get(`${BASE_URL}/api/customers/${randomItem(CUSTOMER_IDS)}`);
  check(res, { 'customer by id 200': (r) => r.status === 200 });

  // Products
  res = http.get(`${BASE_URL}/api/products`);
  check(res, { 'products 200': (r) => r.status === 200 });

  res = http.get(`${BASE_URL}/api/products/${randomItem(PRODUCT_IDS)}`);
  check(res, { 'product by id 200': (r) => r.status === 200 });

  // Orders
  res = http.get(`${BASE_URL}/api/orders`);
  check(res, { 'orders 200': (r) => r.status === 200 });

  // Order creation (the critical path)
  res = http.post(
    `${BASE_URL}/api/orders`,
    orderPayload(randomItem(CUSTOMER_IDS), randomItem(PRODUCT_IDS)),
    params
  );
  check(res, { 'create order 201': (r) => r.status === 201 });

  sleep(1);
}
```

---

### T2: Baseline Load Test

**Goal:** Establish normal performance metrics at modest, expected-production load.

**`load-tests/k6/baseline.js`**
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { BASE_URL, CUSTOMER_IDS, PRODUCT_IDS, randomItem, orderPayload } from './config.js';

const orderCreationDuration = new Trend('order_creation_duration');
const orderErrors           = new Counter('order_errors');

export const options = {
  vus: 10,
  duration: '5m',
  thresholds: {
    http_req_failed:          ['rate<0.01'],
    http_req_duration:        ['p(50)<100', 'p(95)<300', 'p(99)<500'],
    order_creation_duration:  ['p(95)<400'],
    order_errors:             ['count<5'],
  },
};

export default function () {
  const params = { headers: { 'Content-Type': 'application/json' } };

  // 70% read traffic
  if (Math.random() < 0.7) {
    const readTargets = [
      () => http.get(`${BASE_URL}/api/customers`),
      () => http.get(`${BASE_URL}/api/customers/${randomItem(CUSTOMER_IDS)}`),
      () => http.get(`${BASE_URL}/api/products`),
      () => http.get(`${BASE_URL}/api/products/${randomItem(PRODUCT_IDS)}`),
      () => http.get(`${BASE_URL}/api/orders`),
    ];
    const res = readTargets[Math.floor(Math.random() * readTargets.length)]();
    check(res, { 'read 200': (r) => r.status === 200 });
  } else {
    // 30% order creation
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/orders`,
      orderPayload(randomItem(CUSTOMER_IDS), randomItem(PRODUCT_IDS)),
      params
    );
    orderCreationDuration.add(Date.now() - start);

    if (!check(res, { 'create order 201': (r) => r.status === 201 })) {
      orderErrors.add(1);
      console.error(`Order creation failed: ${res.status} ${res.body}`);
    }
  }

  sleep(Math.random() * 1 + 0.5); // think time: 0.5–1.5s
}
```

---

### T3: Ramp-Up Test

**Goal:** Find the load level at which performance begins to degrade. Identifies the system's safe operating capacity.

**`load-tests/k6/ramp-up.js`**
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, CUSTOMER_IDS, PRODUCT_IDS, randomItem, orderPayload } from './config.js';

export const options = {
  stages: [
    { duration: '1m',  target: 10  },  // warm-up
    { duration: '2m',  target: 25  },  // light load
    { duration: '2m',  target: 50  },  // moderate load
    { duration: '2m',  target: 75  },  // heavy load
    { duration: '2m',  target: 100 },  // peak load
    { duration: '1m',  target: 0   },  // cool-down
  ],
  thresholds: {
    http_req_failed:   ['rate<0.05'],   // allow up to 5% errors at peak
    http_req_duration: ['p(95)<1000'],  // p95 must stay under 1s
  },
};

export default function () {
  const params = { headers: { 'Content-Type': 'application/json' } };

  const action = Math.random();
  let res;

  if (action < 0.3) {
    res = http.get(`${BASE_URL}/api/customers/${randomItem(CUSTOMER_IDS)}`);
    check(res, { 'customer 200': (r) => r.status === 200 });
  } else if (action < 0.6) {
    res = http.get(`${BASE_URL}/api/products/${randomItem(PRODUCT_IDS)}`);
    check(res, { 'product 200': (r) => r.status === 200 });
  } else if (action < 0.85) {
    res = http.get(`${BASE_URL}/api/orders`);
    check(res, { 'orders 200': (r) => r.status === 200 });
  } else {
    res = http.post(
      `${BASE_URL}/api/orders`,
      orderPayload(randomItem(CUSTOMER_IDS), randomItem(PRODUCT_IDS)),
      params
    );
    check(res, { 'order created': (r) => r.status === 201 });
  }

  sleep(0.5);
}
```

**Interpreting results:** Watch for the VU level at which p95 latency begins climbing non-linearly. That inflection point is your capacity ceiling.

---

### T4: Stress Test

**Goal:** Apply 150% of expected peak load. Verify that degradation is graceful (higher latency, not crashes or data corruption).

**`load-tests/k6/stress.js`**
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, CUSTOMER_IDS, PRODUCT_IDS, randomItem, orderPayload } from './config.js';

export const options = {
  stages: [
    { duration: '2m',  target: 100 },  // ramp to expected peak
    { duration: '5m',  target: 150 },  // stress: 150% of peak
    { duration: '2m',  target: 200 },  // push further
    { duration: '3m',  target: 200 },  // sustain at stress level
    { duration: '2m',  target: 0   },  // ramp down — watch recovery
  ],
  thresholds: {
    // Relaxed thresholds for stress — we expect some degradation
    http_req_failed:   ['rate<0.10'],
    http_req_duration: ['p(99)<3000'],
  },
};

export default function () {
  const params = { headers: { 'Content-Type': 'application/json' } };

  const res = http.post(
    `${BASE_URL}/api/orders`,
    orderPayload(randomItem(CUSTOMER_IDS), randomItem(PRODUCT_IDS)),
    params
  );
  check(res, {
    'status 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  sleep(0.3);
}
```

**Key observations:**
- Does the error rate spike above 10%?
- Does p99 stay under 3 seconds?
- After ramp-down, does latency return to baseline within 30 seconds?
- Do any services return 5xx errors (circuit breaker activation)?

---

### T5: Spike Test

**Goal:** Simulate a sudden 10× traffic surge for 30 seconds. Measure recovery time.

**`load-tests/k6/spike.js`**
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, CUSTOMER_IDS, PRODUCT_IDS, randomItem, orderPayload } from './config.js';

export const options = {
  stages: [
    { duration: '1m',  target: 10  },  // baseline traffic
    { duration: '10s', target: 100 },  // spike — 10x in 10 seconds
    { duration: '30s', target: 100 },  // sustain spike
    { duration: '10s', target: 10  },  // drop back
    { duration: '3m',  target: 10  },  // recovery observation window
    { duration: '30s', target: 0   },  // done
  ],
  thresholds: {
    http_req_failed:   ['rate<0.15'],  // spikes may cause transient errors
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  const params = { headers: { 'Content-Type': 'application/json' } };

  // Mix of reads and writes during spike
  if (Math.random() < 0.5) {
    const res = http.get(`${BASE_URL}/api/products/${randomItem(PRODUCT_IDS)}`);
    check(res, { 'product ok': (r) => r.status === 200 });
  } else {
    const res = http.post(
      `${BASE_URL}/api/orders`,
      orderPayload(randomItem(CUSTOMER_IDS), randomItem(PRODUCT_IDS)),
      params
    );
    check(res, { 'order ok': (r) => r.status === 201 || r.status === 200 });
  }

  sleep(0.2);
}
```

**Recovery metric:** Time from spike end until p95 latency returns to within 20% of pre-spike baseline.

---

### T6: Soak Test

**Goal:** Run at 30% load for 30–60 minutes. Detect memory leaks, H2 table growth, and connection pool exhaustion.

**`load-tests/k6/soak.js`**
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, CUSTOMER_IDS, PRODUCT_IDS, randomItem, orderPayload } from './config.js';

// Track latency drift over time
const latencyDrift = new Trend('latency_drift_over_time');

export const options = {
  stages: [
    { duration: '2m',  target: 30  },   // ramp up
    { duration: '55m', target: 30  },   // soak
    { duration: '3m',  target: 0   },   // ramp down
  ],
  thresholds: {
    http_req_failed:    ['rate<0.01'],
    http_req_duration:  ['p(95)<500'],   // must not degrade over time
    latency_drift_over_time: ['p(95)<500'],
  },
};

export default function () {
  const params = { headers: { 'Content-Type': 'application/json' } };

  const start = Date.now();

  // Cycle through all endpoints to stress all services
  http.get(`${BASE_URL}/api/customers/${randomItem(CUSTOMER_IDS)}`);
  http.get(`${BASE_URL}/api/products/${randomItem(PRODUCT_IDS)}`);

  const orderRes = http.post(
    `${BASE_URL}/api/orders`,
    orderPayload(randomItem(CUSTOMER_IDS), randomItem(PRODUCT_IDS)),
    params
  );
  check(orderRes, { 'order created': (r) => r.status === 201 });

  latencyDrift.add(Date.now() - start);

  sleep(2); // 2s think time → ~15 iterations/min/VU → ~450 req/min total
}
```

**Soak test monitoring checklist:**
- [ ] JVM heap stable (not growing)? → `curl http://localhost:8083/actuator/metrics/jvm.memory.used`
- [ ] Thread count stable? → `curl http://localhost:8083/actuator/metrics/jvm.threads.live`
- [ ] H2 row count growing without bound? → Check `GET /api/orders` response size over time
- [ ] p95 latency flat? (Drift indicates GC pressure or connection pool starvation)

---

### T7: End-to-End Order Flow Scenario

**Goal:** Simulate a realistic user session: browse products → view product detail → create order. This is the highest-value scenario because it exercises every service.

**`load-tests/k6/order-flow.js`**
```javascript
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { BASE_URL } from './config.js';

const orderSuccessRate  = new Rate('order_success_rate');
const fullFlowDuration  = new Trend('full_flow_duration_ms');
const feign_latency     = new Trend('order_creation_ms');  // proxy for Feign overhead

export const options = {
  vus: 20,
  duration: '10m',
  thresholds: {
    http_req_failed:        ['rate<0.02'],
    order_success_rate:     ['rate>0.98'],
    full_flow_duration_ms:  ['p(95)<800'],
    order_creation_ms:      ['p(95)<400'],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  const flowStart = Date.now();

  // ── Step 1: Browse customers (simulate login context check) ──
  let res;
  group('browse_customers', () => {
    res = http.get(`${BASE_URL}/api/customers`);
    check(res, { 'customers loaded': (r) => r.status === 200 });
  });

  // Extract a real customer ID from the response
  let customerId = 1;
  try {
    const customers = res.json();
    if (Array.isArray(customers) && customers.length > 0) {
      customerId = customers[Math.floor(Math.random() * customers.length)].id;
    }
  } catch (_) { /* fallback to 1 */ }

  sleep(0.5);

  // ── Step 2: Browse products ──
  let productId = 2;
  group('browse_products', () => {
    res = http.get(`${BASE_URL}/api/products`);
    check(res, { 'products loaded': (r) => r.status === 200 });
    try {
      const products = res.json();
      if (Array.isArray(products) && products.length > 0) {
        productId = products[Math.floor(Math.random() * products.length)].id;
      }
    } catch (_) { /* fallback */ }
  });

  sleep(0.3);

  // ── Step 3: View product detail ──
  group('view_product', () => {
    res = http.get(`${BASE_URL}/api/products/${productId}`);
    check(res, { 'product detail ok': (r) => r.status === 200 });
  });

  sleep(0.5);

  // ── Step 4: Create order (critical path — Feign calls happen here) ──
  group('create_order', () => {
    const orderStart = Date.now();
    res = http.post(
      `${BASE_URL}/api/orders`,
      JSON.stringify({
        customerId,
        items: [{ productId, quantity: 1 }],
        shippingAddress: '1 Test Street',
        shippingCity: 'Loadtown',
        shippingState: 'LT',
        shippingZip: '99999',
        shippingCountry: 'USA',
      }),
      { headers }
    );

    const success = check(res, {
      'order created 201': (r) => r.status === 201,
      'order has id':      (r) => { try { return r.json().id != null; } catch(e) { return false; } },
    });
    orderSuccessRate.add(success ? 1 : 0);
    feign_latency.add(Date.now() - orderStart);

    if (!success) {
      console.error(`Order failed: ${res.status} body=${res.body.slice(0, 200)}`);
    }
  });

  // ── Step 5: Confirm order was recorded ──
  group('verify_order', () => {
    res = http.get(`${BASE_URL}/api/orders`);
    check(res, { 'orders list ok': (r) => r.status === 200 });
  });

  fullFlowDuration.add(Date.now() - flowStart);
  sleep(1);
}
```

---

## 5. Gatling Setup

### 5.1 Maven Plugin Configuration

**`load-tests/pom.xml`**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.fisglobal.demo</groupId>
    <artifactId>load-tests</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <packaging>jar</packaging>

    <properties>
        <maven.compiler.source>21</maven.compiler.source>
        <maven.compiler.target>21</maven.compiler.target>
        <gatling.version>3.11.5</gatling.version>
        <gatling-maven-plugin.version>4.9.6</gatling-maven-plugin.version>
        <scala.version>2.13.14</scala.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>io.gatling.highcharts</groupId>
            <artifactId>gatling-charts-highcharts</artifactId>
            <version>${gatling.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <testSourceDirectory>src/test/scala</testSourceDirectory>
        <plugins>
            <!-- Scala compiler for Gatling simulations -->
            <plugin>
                <groupId>net.alchim31.maven</groupId>
                <artifactId>scala-maven-plugin</artifactId>
                <version>4.9.2</version>
                <executions>
                    <execution>
                        <goals>
                            <goal>testCompile</goal>
                        </goals>
                    </execution>
                </executions>
            </plugin>

            <!-- Gatling Maven plugin -->
            <plugin>
                <groupId>io.gatling</groupId>
                <artifactId>gatling-maven-plugin</artifactId>
                <version>${gatling-maven-plugin.version}</version>
                <configuration>
                    <!-- Point to a specific simulation class, or omit to run all -->
                    <!-- <simulationClass>simulations.OrderCreationSimulation</simulationClass> -->
                    <runMultipleSimulations>false</runMultipleSimulations>
                    <resultsFolder>${project.build.directory}/gatling-results</resultsFolder>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

### 5.2 Order Creation Simulation

**`load-tests/src/test/scala/simulations/OrderCreationSimulation.scala`**
```scala
package simulations

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.concurrent.duration._

class OrderCreationSimulation extends Simulation {

  // ── HTTP protocol ────────────────────────────────────────────
  val httpProtocol = http
    .baseUrl(System.getProperty("baseUrl", "http://localhost:8080"))
    .acceptHeader("application/json")
    .contentTypeHeader("application/json")
    .userAgentHeader("Gatling/LoadTest")

  // ── Feeders — seed data matching DataInitializer.java ────────
  val customerFeeder = Array(
    Map("customerId" -> 1),
    Map("customerId" -> 2),
    Map("customerId" -> 3)
  ).random

  val productFeeder = Array(
    Map("productId" -> 1),
    Map("productId" -> 2),
    Map("productId" -> 3),
    Map("productId" -> 4),
    Map("productId" -> 5),
    Map("productId" -> 6)
  ).random

  // ── Request bodies ───────────────────────────────────────────
  def orderBody(customerId: Int, productId: Int): String =
    s"""{
       |  "customerId": $customerId,
       |  "items": [{ "productId": $productId, "quantity": 1 }],
       |  "shippingAddress": "1 Gatling Ave",
       |  "shippingCity": "Simcity",
       |  "shippingState": "GA",
       |  "shippingZip": "12345",
       |  "shippingCountry": "USA"
       |}""".stripMargin

  // ── Scenarios ────────────────────────────────────────────────

  val browseProducts = scenario("Browse Products")
    .exec(
      http("list_products")
        .get("/api/products")
        .check(status.is(200))
        .check(jsonPath("$[*].id").findAll.saveAs("productIds"))
    )
    .pause(300.milliseconds, 600.milliseconds)
    .exec(
      http("get_product_detail")
        .get("/api/products/#{productIds.random()}")
        .check(status.is(200))
    )

  val orderCreationFlow = scenario("End-to-End Order Creation")
    .feed(customerFeeder)
    .feed(productFeeder)
    // Step 1: list customers
    .exec(
      http("list_customers")
        .get("/api/customers")
        .check(status.is(200))
    )
    .pause(200.milliseconds, 500.milliseconds)
    // Step 2: list products
    .exec(
      http("list_products")
        .get("/api/products")
        .check(status.is(200))
    )
    .pause(300.milliseconds, 800.milliseconds)
    // Step 3: create order (critical path — triggers 2 Feign calls)
    .exec(
      http("create_order")
        .post("/api/orders")
        .body(StringBody(session =>
          orderBody(
            session("customerId").as[Int],
            session("productId").as[Int]
          )
        ))
        .check(status.is(201))
        .check(jsonPath("$.id").exists)
        .check(jsonPath("$.orderNumber").exists)
        .check(responseTimeInMillis.lte(500))
    )
    .pause(500.milliseconds)
    // Step 4: verify order appears in list
    .exec(
      http("list_orders")
        .get("/api/orders")
        .check(status.is(200))
    )

  // ── Injection profile ────────────────────────────────────────
  setUp(
    browseProducts.inject(
      rampUsers(20).during(2.minutes)
    ),
    orderCreationFlow.inject(
      nothingFor(30.seconds),             // let products load first
      atOnceUsers(5),                     // immediate baseline
      rampUsers(30).during(5.minutes),    // gradual ramp
      constantUsersPerSec(10).during(3.minutes)  // sustained load
    )
  )
  .protocols(httpProtocol)
  .assertions(
    global.responseTime.percentile(95).lte(500),
    global.successfulRequests.percent.gte(99),
    global.requestsPerSec.gte(20),
    details("create_order").responseTime.percentile(99).lte(1000)
  )
}
```

### 5.3 Running Gatling

```bash
# Run default simulation
cd load-tests
mvn gatling:test

# Run specific simulation
mvn gatling:test -Dgatling.simulationClass=simulations.OrderCreationSimulation

# Override base URL
mvn gatling:test -DbaseUrl=http://staging.example.com:8080

# Report opens in: load-tests/target/gatling-results/<timestamp>/index.html
```

---

## 6. Performance Thresholds & SLOs

### 6.1 Response Time SLOs (via API Gateway)

| Endpoint | p50 | p95 | p99 | Max |
|---|---|---|---|---|
| `GET /api/customers` | 20ms | 80ms | 150ms | 500ms |
| `GET /api/customers/{id}` | 10ms | 40ms | 80ms | 300ms |
| `POST /api/customers` | 30ms | 100ms | 200ms | 600ms |
| `GET /api/products` | 20ms | 80ms | 150ms | 500ms |
| `GET /api/products/{id}` | 10ms | 40ms | 80ms | 300ms |
| `POST /api/products` | 30ms | 100ms | 200ms | 600ms |
| `GET /api/orders` | 30ms | 100ms | 200ms | 600ms |
| `GET /api/orders/{id}` | 15ms | 60ms | 120ms | 400ms |
| `POST /api/orders` | 80ms | 300ms | 500ms | 1500ms |

> **Note:** `POST /api/orders` SLOs are intentionally wider — it involves two synchronous Feign calls and three H2 writes.

### 6.2 Throughput Targets

| Scenario | Target RPS | Acceptable Minimum |
|---|---|---|
| Read endpoints (individual) | 200 req/s | 100 req/s |
| `POST /api/orders` | 50 req/s | 25 req/s |
| Mixed realistic traffic | 150 req/s | 75 req/s |

### 6.3 Error Rate Thresholds

| Test Type | Max Error Rate |
|---|---|
| Smoke / Baseline | < 0.1% |
| Load Test (normal) | < 1% |
| Stress Test | < 5% |
| Spike Test | < 10% (transient) |
| Soak Test | < 0.5% |

### 6.4 Resource Thresholds

| Resource | Warning | Critical |
|---|---|---|
| JVM heap used | > 70% of `-Xmx` | > 85% of `-Xmx` |
| Thread count (platform) | > 200 | > 500 |
| Virtual thread count | > 10,000 | > 50,000 |
| H2 active connections | > 8 | > 10 (pool exhaustion) |
| Gateway response queue | > 500ms added latency | Gateway returning 503 |

---

## 7. Test Data Strategy

### 7.1 Seed Data (from DataInitializer.java)

On each service restart, H2 is populated with:

| Service | Records | IDs |
|---|---|---|
| customer-service | 3 customers | 1 (John Doe), 2 (Jane Smith), 3 (Bob Johnson) |
| inventory-service | 6 products | 1–6 (Laptop, Mouse, Keyboard, Chair, Desk, Webcam) |
| order-service | 0 orders | None pre-seeded |

### 7.2 Pre-Test Seed Script

For write-heavy tests (T4, T5, T6), seed additional data to avoid hitting stock limits and to make reads more realistic:

**`load-tests/k6/setup/seed-data.js`**
```javascript
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const headers  = { 'Content-Type': 'application/json' };

export const options = { vus: 1, iterations: 1 };

export default function () {
  // Seed additional customers
  const customerNames = [
    ['Alice', 'Walker',  'alice@example.com'],
    ['Carlos', 'Garcia', 'carlos@example.com'],
    ['Diana', 'Prince',  'diana@example.com'],
    ['Ethan', 'Hunt',    'ethan@example.com'],
    ['Fiona', 'Green',   'fiona@example.com'],
  ];

  customerNames.forEach(([first, last, email]) => {
    const res = http.post(`${BASE_URL}/api/customers`, JSON.stringify({
      firstName: first, lastName: last, email,
      phone: '555-0000', address: '1 Seed St',
      city: 'Testtown', state: 'TS', zipCode: '00000', country: 'USA'
    }), { headers });
    check(res, { [`customer ${first} created`]: (r) => r.status === 201 });
  });

  // Seed additional products with high stock to avoid inventory depletion
  const products = [
    ['USB Hub 7-Port', 'USBHUB-001', '39.99', 10000],
    ['Monitor 27"',    'MON27-001',  '399.99', 500],
    ['Ethernet Cable', 'ETH-001',    '12.99',  5000],
  ];

  products.forEach(([name, sku, price, qty]) => {
    const res = http.post(`${BASE_URL}/api/products`, JSON.stringify({
      name, sku, price: parseFloat(price),
      description: `Load test seed product: ${name}`,
      stockQuantity: qty, category: 'Electronics', reorderLevel: 100
    }), { headers });
    check(res, { [`product ${name} created`]: (r) => r.status === 201 });
  });

  console.log('Seed complete — services ready for load test');
}
```

Run before any write-heavy test:
```bash
k6 run load-tests/k6/setup/seed-data.js
```

### 7.3 Data Growth & Repeatability

**Problem:** `POST /api/orders` creates rows in H2. After a soak test with 30 VUs × 30 min × ~10 req/min, there will be ~9,000 order rows. `GET /api/orders` will become slower over time.

**Mitigation options:**

| Option | Pros | Cons |
|---|---|---|
| Restart services between runs | Clean state, repeatable | Slow startup |
| Add `GET /api/orders` with pagination | Realistic, no restart needed | Requires code change |
| Use read-only VUs for GET /orders | Isolates write growth impact | Masks real behavior |
| H2 `TRUNCATE TABLE orders` via JDBC URL | Fast | Requires H2 console access |

**Recommended:** For soak tests, restart all services before the run:
```bash
# From project root
./build.sh && ./run.sh
# Wait ~30s for Eureka registration, then:
k6 run load-tests/k6/soak.js
```

### 7.4 Read-Heavy vs Write-Heavy Profiles

| Profile | Customers | Products | Orders GET | Orders POST |
|---|---|---|---|---|
| Read-heavy (catalog browse) | 20% | 50% | 25% | 5% |
| Balanced (normal e-commerce) | 15% | 35% | 20% | 30% |
| Write-heavy (checkout surge) | 5% | 10% | 5% | 80% |

Configure by adjusting the `Math.random()` thresholds in `baseline.js` or `ramp-up.js`.

---

## 8. Metrics Collection

### 8.1 k6 Built-in Metrics

Key metrics emitted automatically by k6:

| Metric | Type | Description |
|---|---|---|
| `http_req_duration` | Trend | Total request time |
| `http_req_waiting` | Trend | TTFB — Time to First Byte (server processing time) |
| `http_req_sending` | Trend | Time to send request |
| `http_req_receiving` | Trend | Time to receive response |
| `http_reqs` | Counter | Total requests made |
| `http_req_failed` | Rate | Proportion of failed requests |
| `vus` | Gauge | Active virtual users |
| `iterations` | Counter | Total scenario iterations |
| `iteration_duration` | Trend | Time per full scenario iteration |

**Output JSON for post-processing:**
```bash
k6 run --out json=results/baseline-$(date +%Y%m%d-%H%M%S).json load-tests/k6/baseline.js
```

### 8.2 Spring Boot Actuator Metrics

Expose metrics via `application.properties`:
```properties
management.endpoints.web.exposure.include=health,info,metrics,prometheus
management.endpoint.health.show-details=always
management.metrics.export.prometheus.enabled=true
```

**Key JVM metrics to poll during tests:**

```bash
# Poll every 30s during a test run
SERVICE=http://localhost:8083  # order-service under highest load

watch -n 30 "
  echo '=== Heap ===' && \
  curl -s $SERVICE/actuator/metrics/jvm.memory.used | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[\"measurements\"][0][\"value\"] / 1e6, \"MB\")' && \
  echo '=== Threads ===' && \
  curl -s $SERVICE/actuator/metrics/jvm.threads.live | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[\"measurements\"][0][\"value\"], \"threads\")' && \
  echo '=== GC Pause ===' && \
  curl -s $SERVICE/actuator/metrics/jvm.gc.pause | python3 -c 'import sys,json; d=json.load(sys.stdin); [print(m[\"statistic\"],\"=\",m[\"value\"],\"ms\") for m in d.get(\"measurements\",[])]'
"
```

**Useful actuator endpoints during load test:**

```bash
# All available metrics
curl http://localhost:8083/actuator/metrics | jq '.names[]' | grep -E "(jvm|http|tomcat)"

# HTTP request statistics (per endpoint)
curl http://localhost:8083/actuator/metrics/http.server.requests

# Thread pool (Tomcat/virtual threads)
curl http://localhost:8083/actuator/metrics/tomcat.threads.current
curl http://localhost:8083/actuator/metrics/tomcat.threads.busy

# Connection pool
curl http://localhost:8083/actuator/metrics/hikaricp.connections.active
curl http://localhost:8083/actuator/metrics/hikaricp.connections.pending
```

### 8.3 Prometheus + Grafana Stack (Recommended)

For real-time visualization during load tests:

**`docker-compose.monitoring.yml`** (add to project root):
```yaml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:v2.53.0
    ports:
      - "9090:9090"
    volumes:
      - ./load-tests/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=7d'

  grafana:
    image: grafana/grafana:11.0.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana
      - ./load-tests/monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards

volumes:
  grafana_data:
```

**`load-tests/monitoring/prometheus.yml`**:
```yaml
global:
  scrape_interval: 5s

scrape_configs:
  - job_name: 'spring-customer-service'
    static_configs:
      - targets: ['host.docker.internal:8081']
    metrics_path: /actuator/prometheus

  - job_name: 'spring-inventory-service'
    static_configs:
      - targets: ['host.docker.internal:8082']
    metrics_path: /actuator/prometheus

  - job_name: 'spring-order-service'
    static_configs:
      - targets: ['host.docker.internal:8083']
    metrics_path: /actuator/prometheus

  - job_name: 'spring-api-gateway'
    static_configs:
      - targets: ['host.docker.internal:8080']
    metrics_path: /actuator/prometheus
```

**Start monitoring stack:**
```bash
docker-compose -f docker-compose.monitoring.yml up -d
# Grafana: http://localhost:3000 (admin/admin)
# Import dashboard ID 4701 (JVM Micrometer) from Grafana.com
```

**k6 → InfluxDB → Grafana (k6-specific dashboard):**
```bash
# Start InfluxDB
docker run -d --name influxdb -p 8086:8086 influxdb:1.8

# Run k6 with InfluxDB output
k6 run --out influxdb=http://localhost:8086/k6 load-tests/k6/baseline.js

# Import k6 Grafana dashboard ID: 2587
```

---

## 9. Virtual Threads Benchmark

### 9.1 Hypothesis

Java 25 virtual threads allow the JVM to multiplex many concurrent operations onto a small pool of carrier threads. For this application, the primary benefit is at the **order-service**: when creating an order, two Feign HTTP calls block waiting for downstream responses. With platform threads, each blocked VU occupies a full OS thread. With virtual threads, blocked VUs yield the carrier thread to other work.

**Expected outcome:** At 100+ concurrent VUs, virtual threads should maintain lower p99 latency and higher throughput than platform threads.

### 9.2 Configuration Toggle

**Virtual threads ENABLED** (current default — `order-service/src/main/resources/application.properties`):
```properties
spring.threads.virtual.enabled=true
```

**Virtual threads DISABLED** (for comparison):
```properties
spring.threads.virtual.enabled=false
```

### 9.3 A/B Benchmark Script

**`load-tests/k6/virtual-threads-benchmark.js`**
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, CUSTOMER_IDS, PRODUCT_IDS, randomItem, orderPayload } from './config.js';

// Label results by build under test
const BUILD_LABEL = __ENV.BUILD_LABEL || 'unknown';  // 'virtual' or 'platform'

const orderDuration  = new Trend(`order_duration_${BUILD_LABEL}`);
const orderSuccess   = new Rate(`order_success_${BUILD_LABEL}`);

export const options = {
  stages: [
    { duration: '30s', target: 20   },
    { duration: '1m',  target: 50   },
    { duration: '1m',  target: 100  },  // stress with high concurrency
    { duration: '1m',  target: 150  },
    { duration: '30s', target: 0    },
  ],
  thresholds: {
    http_req_failed: ['rate<0.10'],
  },
};

export default function () {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/orders`,
    orderPayload(randomItem(CUSTOMER_IDS), randomItem(PRODUCT_IDS)),
    { headers: { 'Content-Type': 'application/json' } }
  );
  orderDuration.add(Date.now() - start);
  orderSuccess.add(res.status === 201 ? 1 : 0);
  check(res, { '2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(0.1);
}
```

### 9.4 Running the A/B Comparison

```bash
# ── Run 1: Virtual threads ENABLED ──────────────────────────
# Ensure application.properties has spring.threads.virtual.enabled=true
# Restart services, then:
k6 run \
  --out json=results/virtual-threads-ON-$(date +%Y%m%d-%H%M).json \
  -e BUILD_LABEL=virtual \
  load-tests/k6/virtual-threads-benchmark.js

# ── Run 2: Virtual threads DISABLED ─────────────────────────
# Edit application.properties: spring.threads.virtual.enabled=false
# Restart services, then:
k6 run \
  --out json=results/virtual-threads-OFF-$(date +%Y%m%d-%H%M).json \
  -e BUILD_LABEL=platform \
  load-tests/k6/virtual-threads-benchmark.js
```

### 9.5 Comparing Results

```bash
# Extract p95 from both JSON result files using jq
jq '.metrics.http_req_duration.values."p(95)"' results/virtual-threads-ON-*.json
jq '.metrics.http_req_duration.values."p(95)"' results/virtual-threads-OFF-*.json

# Compare throughput
jq '.metrics.http_reqs.values.rate' results/virtual-threads-ON-*.json
jq '.metrics.http_reqs.values.rate' results/virtual-threads-OFF-*.json
```

### 9.6 Expected Observations

| Metric | Platform Threads | Virtual Threads |
|---|---|---|
| Thread count at 100 VUs | ~100–200 OS threads | ~10–30 carrier threads |
| JVM heap pressure | Higher (thread stacks ~512KB each) | Lower |
| p95 at 150 VUs | Likely degrades | Should remain stable |
| Max throughput | Limited by OS thread limit | Limited by Feign connection pool |

> **Note:** If downstream services respond in < 1ms (H2 is fast), virtual threads show minimal advantage over platform threads. The benefit becomes pronounced when adding artificial latency (e.g., `Thread.sleep()` in a downstream service) or when running against a real network.

---

## 10. Bottleneck Identification Guide

### 10.1 API Gateway Throughput Limit

**Symptom:** All services look healthy, but gateway latency climbs.

**Check:**
```bash
curl http://localhost:8080/actuator/metrics/spring.cloud.gateway.requests
curl http://localhost:8080/actuator/metrics/reactor.netty.http.server.active.connections
```

**Common cause:** Reactive pipeline back-pressure or misconfigured connection limits.

**Fix:** Tune `spring.cloud.gateway.httpclient.pool.max-connections` in gateway's `application.properties`.

---

### 10.2 Feign Client Connection Pool

**Symptom:** `POST /api/orders` latency spikes, but individual service GETs are fast.

**Check:**
```bash
# Watch for connection wait time in order-service logs
curl http://localhost:8083/actuator/metrics/feign.Client

# Or add logging to application.properties:
# logging.level.feign=DEBUG
```

**Common cause:** Feign uses `HttpURLConnection` by default (1 connection at a time per client). Under load, requests queue.

**Fix:** Add Apache HttpClient or OkHttp to `order-service/pom.xml` and configure a connection pool:
```xml
<dependency>
    <groupId>io.github.openfeign</groupId>
    <artifactId>feign-okhttp</artifactId>
</dependency>
```
```properties
spring.cloud.openfeign.okhttp.enabled=true
```

---

### 10.3 H2 Connection Pool Limits

**Symptom:** Database-related errors: `Unable to acquire JDBC Connection`, `Connection is not available, request timed out after 30000ms`.

**Check:**
```bash
curl http://localhost:8083/actuator/metrics/hikaricp.connections.pending
curl http://localhost:8083/actuator/metrics/hikaricp.connections.timeout
```

**Common cause:** HikariCP defaults to 10 connections. Under high VU load, connections are exhausted.

**Fix in `application.properties`:**
```properties
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=5000
spring.datasource.hikari.idle-timeout=300000
```

> **H2 constraint:** H2 in-memory mode has no practical connection limit, but increasing pool size beyond the number of concurrent transactions will not help. Monitor `hikaricp.connections.active` vs `hikaricp.connections.max`.

---

### 10.4 JVM Heap Constraints

**Symptom:** GC pauses spike. Latency becomes spiky/unpredictable. `jvm.gc.pause` metric increases.

**Check:**
```bash
# Heap usage as % of max
curl -s http://localhost:8083/actuator/metrics/jvm.memory.used?tag=area:heap | \
  python3 -c "import sys,json; m=json.load(sys.stdin)['measurements'][0]['value']; print(f'{m/1e6:.0f} MB used')"

curl -s http://localhost:8083/actuator/metrics/jvm.memory.max?tag=area:heap | \
  python3 -c "import sys,json; m=json.load(sys.stdin)['measurements'][0]['value']; print(f'{m/1e6:.0f} MB max')"
```

**Common cause:** H2 stores all data in-memory. After a soak test with many orders, the H2 database itself consumes heap.

**Fix:** Set explicit heap sizes when starting services:
```bash
# In run.sh or JVM args:
-Xms256m -Xmx512m   # customer-service (small dataset)
-Xms256m -Xmx512m   # inventory-service
-Xms512m -Xmx1g     # order-service (growing order dataset)
```

---

### 10.5 Eureka Re-registration Storms

**Symptom:** Intermittent 503 errors from gateway during test, recovering in ~30s.

**Check:** Eureka dashboard at `http://localhost:8761`.

**Cause:** Services de-register and re-register during GC pauses or under CPU saturation, causing gateway to briefly route to unavailable instances.

**Fix:**
```properties
# In each service's application.properties:
eureka.instance.lease-renewal-interval-in-seconds=5
eureka.instance.lease-expiration-duration-in-seconds=15
```

---

### 10.6 Bottleneck Decision Tree

```
High latency observed?
├── Gateway latency high but service latency low?
│   └── → API Gateway connection pool or routing issue
├── POST /api/orders slow, GETs fast?
│   └── → Feign connection pool or downstream service queue
├── All endpoints slow equally?
│   ├── GC pauses high?
│   │   └── → JVM heap exhaustion — increase -Xmx
│   └── H2 connection timeouts?
│       └── → HikariCP pool exhausted — increase pool size
└── Latency grows over time (soak)?
    ├── Heap grows over time?
    │   └── → Memory leak or H2 table growth
    └── Thread count grows over time?
        └── → Virtual thread leak or blocking operation bug
```

---

## 11. CI/CD Integration

### 11.1 GitHub Actions Workflow

**`.github/workflows/nightly-load-test.yml`**
```yaml
name: Nightly Load Test

on:
  schedule:
    - cron: '0 2 * * *'   # 2 AM UTC daily
  workflow_dispatch:        # allow manual trigger
    inputs:
      scenario:
        description: 'k6 scenario to run'
        required: false
        default: 'baseline'
        type: choice
        options: [smoke, baseline, ramp-up, stress, soak]

jobs:
  load-test:
    runs-on: ubuntu-latest
    timeout-minutes: 90

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up JDK 25
        uses: actions/setup-java@v4
        with:
          java-version: '25'
          distribution: 'oracle'
          cache: 'maven'

      - name: Build all services
        run: mvn -B package -DskipTests --no-transfer-progress

      - name: Start microservices
        run: |
          # Start Eureka
          java -jar eureka-server/target/*.jar &
          echo "Waiting for Eureka..."
          sleep 20

          # Start downstream services
          java -jar customer-service/target/*.jar  &
          java -jar inventory-service/target/*.jar &
          sleep 15

          # Start order service
          java -jar order-service/target/*.jar &
          sleep 15

          # Start gateway last
          java -jar api-gateway/target/*.jar &
          sleep 20

          echo "All services started"

      - name: Wait for services to be healthy
        run: |
          for i in {1..30}; do
            if curl -sf http://localhost:8080/actuator/health && \
               curl -sf http://localhost:8081/actuator/health && \
               curl -sf http://localhost:8082/actuator/health && \
               curl -sf http://localhost:8083/actuator/health; then
              echo "All services healthy"
              break
            fi
            echo "Waiting... ($i/30)"
            sleep 10
          done

      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring \
            --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
            --keyserver hkp://keyserver.ubuntu.com:80 \
            --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] \
            https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update && sudo apt-get install -y k6

      - name: Seed test data
        run: |
          k6 run load-tests/k6/setup/seed-data.js

      - name: Run load test
        run: |
          SCENARIO=${{ github.event.inputs.scenario || 'baseline' }}
          k6 run \
            --out json=results/k6-${SCENARIO}-${{ github.run_id }}.json \
            load-tests/k6/${SCENARIO}.js
        env:
          BASE_URL: http://localhost:8080

      - name: Generate k6 HTML report
        if: always()
        run: |
          npm install -g @k6-contrib/html-reporter 2>/dev/null || true
          # k6 summary is embedded in JSON output
          echo "Results saved to results/ directory"

      - name: Upload k6 results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-results-${{ github.run_id }}
          path: results/
          retention-days: 30

      - name: Post summary to PR / job summary
        if: always()
        run: |
          echo "## Load Test Results" >> $GITHUB_STEP_SUMMARY
          echo "**Scenario:** ${{ github.event.inputs.scenario || 'baseline' }}" >> $GITHUB_STEP_SUMMARY
          echo "**Run ID:** ${{ github.run_id }}" >> $GITHUB_STEP_SUMMARY
          if [ -f results/*.json ]; then
            p95=$(jq '.metrics.http_req_duration.values."p(95)"' results/*.json 2>/dev/null || echo "N/A")
            rps=$(jq '.metrics.http_reqs.values.rate' results/*.json 2>/dev/null || echo "N/A")
            errors=$(jq '.metrics.http_req_failed.values.rate' results/*.json 2>/dev/null || echo "N/A")
            echo "| Metric | Value |" >> $GITHUB_STEP_SUMMARY
            echo "|---|---|" >> $GITHUB_STEP_SUMMARY
            echo "| p95 latency | ${p95}ms |" >> $GITHUB_STEP_SUMMARY
            echo "| Throughput | ${rps} req/s |" >> $GITHUB_STEP_SUMMARY
            echo "| Error rate | ${errors} |" >> $GITHUB_STEP_SUMMARY
          fi
```

### 11.2 PR Gate (Quick Smoke Test)

**`.github/workflows/pr-smoke-test.yml`**
```yaml
name: PR Smoke Test

on:
  pull_request:
    branches: [main]
    paths:
      - '**/*.java'
      - '**/pom.xml'

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '25'
          distribution: 'oracle'
          cache: 'maven'

      - name: Build & Start Services
        run: |
          mvn -B package -DskipTests -q
          java -jar eureka-server/target/*.jar &
          sleep 20
          java -jar customer-service/target/*.jar  &
          java -jar inventory-service/target/*.jar &
          java -jar order-service/target/*.jar &
          sleep 20
          java -jar api-gateway/target/*.jar &
          sleep 20

      - name: Install k6
        run: sudo apt-get install -y k6 || brew install k6

      - name: Smoke Test
        run: k6 run load-tests/k6/smoke.js
        env:
          BASE_URL: http://localhost:8080
```

---

## 12. Reporting

### 12.1 k6 HTML Report

k6 generates a summary to stdout. For HTML output:

```bash
# Using k6's built-in handleSummary
# Add to any k6 script:
```

**Add to any k6 script:**
```javascript
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    [`results/report-${timestamp}.html`]: htmlReport(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`results/summary-${timestamp}.json`]: JSON.stringify(data),
  };
}
```

Open the generated HTML file in a browser for a full visual report.

### 12.2 Gatling HTML Report

Gatling generates a full HTML report automatically at:
```
load-tests/target/gatling-results/<simulation-name>-<timestamp>/index.html
```

Open directly:
```bash
cd load-tests
mvn gatling:test
open target/gatling-results/*/index.html
```

The Gatling report includes:
- Request/response time distribution chart
- Per-request percentile breakdown
- Active users over time
- Responses per second over time
- Error details with response codes

### 12.3 Historical Baseline Storage

Store JSON summaries in a `results/` directory committed to a separate branch or artifact storage:

```bash
# Naming convention: <scenario>-<date>-<git-sha>.json
k6 run \
  --out json=results/baseline-$(date +%Y%m%d)-$(git rev-parse --short HEAD).json \
  load-tests/k6/baseline.js
```

**Compare two runs with jq:**
```bash
# p95 comparison
echo "Current:"
jq '.metrics.http_req_duration.values."p(95)"' results/baseline-20250101-*.json

echo "Previous:"
jq '.metrics.http_req_duration.values."p(95)"' results/baseline-20241201-*.json

# Throughput comparison
jq '.metrics.http_reqs.values.rate' results/baseline-20250101-*.json
jq '.metrics.http_reqs.values.rate' results/baseline-20241201-*.json
```

---

## 13. File Structure

```
load-tests/
├── pom.xml                          # Gatling Maven project
├── package.json                     # k6 script dependencies (optional)
│
├── k6/                              # k6 test scripts
│   ├── config.js                    # Shared config (BASE_URL, seed IDs, helpers)
│   ├── smoke.js                     # T1: Smoke test (1 VU, 1 min)
│   ├── baseline.js                  # T2: Baseline load (10 VU, 5 min)
│   ├── ramp-up.js                   # T3: Ramp-up (0→100 VU, 10 min)
│   ├── stress.js                    # T4: Stress test (150% load)
│   ├── spike.js                     # T5: Spike test (10x sudden load)
│   ├── soak.js                      # T6: Soak test (30 VU, 60 min)
│   ├── order-flow.js                # T7: End-to-end order scenario
│   ├── virtual-threads-benchmark.js # Virtual threads A/B benchmark
│   └── setup/
│       └── seed-data.js             # Pre-test data seeding
│
├── src/test/scala/simulations/      # Gatling simulations
│   └── OrderCreationSimulation.scala
│
├── monitoring/                      # Observability stack
│   ├── prometheus.yml               # Prometheus scrape config
│   └── grafana/
│       └── dashboards/              # Grafana dashboard JSON files
│
└── results/                         # Test results (gitignored or separate branch)
    ├── .gitkeep
    └── *.json                       # k6 JSON output files

.github/workflows/
├── nightly-load-test.yml            # Nightly full load test
└── pr-smoke-test.yml                # PR gate smoke test

docker-compose.monitoring.yml        # Prometheus + Grafana stack
```

**`load-tests/package.json`** (for IDE support and k6 type hints):
```json
{
  "name": "ecommerce-load-tests",
  "version": "1.0.0",
  "description": "k6 load tests for FIS Global e-commerce microservices",
  "scripts": {
    "smoke":     "k6 run k6/smoke.js",
    "baseline":  "k6 run k6/baseline.js",
    "ramp-up":   "k6 run k6/ramp-up.js",
    "stress":    "k6 run k6/stress.js",
    "spike":     "k6 run k6/spike.js",
    "soak":      "k6 run k6/soak.js",
    "order-flow":"k6 run k6/order-flow.js",
    "seed":      "k6 run k6/setup/seed-data.js",
    "vt-bench":  "k6 run k6/virtual-threads-benchmark.js"
  },
  "devDependencies": {
    "@types/k6": "^0.54.0"
  }
}
```

---

## Quick Start

Three commands to run your first test (requires services running locally):

```bash
# 1. Install k6
brew install k6   # macOS

# 2. Start all services (from project root)
./run.sh

# 3. Run smoke test
k6 run load-tests/k6/smoke.js
```

**Expected output:**
```
          /\      |‾‾| /‾‾/   /‾‾/
     /\  /  \     |  |/  /   /  /
    /  \/    \    |     (   /   ‾‾\
   /          \   |  |\  \ |  (‾)  |
  / __________ \  |__| \__\ \_____/ .io

  execution: local
     script: load-tests/k6/smoke.js
     output: -

  scenarios: (100.00%) 1 scenario, 1 max VUs, 1m30s max duration (incl. graceful stop):
           * default: 1 looping VUs for 1m0s (gracefulStop: 30s)


running (1m00.0s), 0/1 VUs, 55 complete and 0 interrupted iterations
default ✓ [======================================] 1 VUs  1m0s

     ✓ customers 200
     ✓ customer by id 200
     ✓ products 200
     ✓ product by id 200
     ✓ orders 200
     ✓ create order 201

     checks.........................: 100.00% ✓ 330       ✗ 0
     http_req_duration..............: avg=18ms  min=4ms  med=12ms  max=145ms  p(90)=42ms  p(95)=67ms
     http_req_failed................: 0.00%   ✓ 0         ✗ 330
     http_reqs......................: 330     5.5/s
```

**Next steps after smoke test passes:**
1. Run `k6 run load-tests/k6/baseline.js` to establish performance benchmarks
2. Run `k6 run load-tests/k6/ramp-up.js` to find capacity ceiling
3. Run `k6 run load-tests/k6/order-flow.js` for the full end-to-end scenario
