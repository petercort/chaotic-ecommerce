# Quick Start Guide

Follow these steps to get the demo application running quickly.

## Prerequisites Check

Make sure you have:
- [ ] Node.js 20+ installed (`node --version`)
- [ ] npm 9+ installed (`npm --version`)
- [ ] Git installed (`git --version`)
- [ ] GitHub Copilot enabled in your IDE

## 1. Quick Start with Docker (Recommended — 5 minutes)

```bash
# Clone the repository
git clone <repository-url>
cd copilot-typescript-demo

# Build all images and start the full stack
docker compose up --build -d

# Verify all services are healthy
docker compose ps

# Open the demo UI
open http://localhost:8090
```

### Test the API

```bash
# List seeded customers
curl http://localhost:8080/api/customers

# List seeded products
curl http://localhost:8080/api/products

# Create an order
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "items": [{"productId": 1, "quantity": 1}],
    "shippingAddress": "123 Main St",
    "shippingCity": "New York",
    "shippingState": "NY",
    "shippingZip": "10001",
    "shippingCountry": "USA"
  }'
```

## 2. Quick Start Locally (requires Node.js 20+)

```bash
# Build all TypeScript services
./build.sh

# Start all services (opens ports 8080–8083, 8090)
./run.sh

# Stop all services
kill $(cat /tmp/ecommerce-pids.txt)
```

> **Note:** Service URLs default to `http://localhost:808X` when running locally. The `run.sh` script injects the correct `CUSTOMER_SERVICE_URL` / `INVENTORY_SERVICE_URL` / `ORDER_SERVICE_URL` environment variables automatically.

## 3. Explore the Code

Open the project in your IDE and explore:

### Key Files to Review
1. **Customer Service**: `customer-service/src/` — Express routes, PostgreSQL schema/migrations, seed data
2. **Inventory Service**: `inventory-service/src/` — Product catalog + reserve/restore logic
3. **Order Service**: `order-service/src/` — Orchestration saga with compensation
4. **API Gateway**: `api-gateway/src/index.ts` — Axios proxying + opossum circuit breakers
5. **Shared types**: Each service has its own `src/types.ts`

### Architecture Observations
- All services are independent Node.js/Express processes
- `customer-service` persists to a PostgreSQL container (durable via named volume); `inventory-service` and `order-service` use SQLite in-memory databases (data resets on restart)
- `order-service` calls `customer-service` and `inventory-service` via axios with circuit breakers
- Service discovery is handled by Docker Compose DNS (no registry needed)

## 4. Run the Tests

```bash
# Playwright E2E tests (requires services running)
cd e2e && npm install && npx playwright install chromium
npx playwright test

# k6 load tests
cd load-tests && npm install && npm run smoke
```

## 5. Common Issues

### Port Already in Use
```bash
# Kill process on port 8080
lsof -ti:8080 | xargs kill -9
```

### TypeScript Build Fails
```bash
# Rebuild a specific service
cd customer-service && npm ci && npm run build

# Type-check only (no output)
npx tsc --noEmit
```

### Service Won't Start
```bash
# Check logs for a specific service (Docker)
docker compose logs customer-service

# Check local service log
cat /tmp/customer-service.log
```

### Docker Build Fails (better-sqlite3 native module)
The `node:20-slim` base image requires build tools for native modules. The Dockerfiles install `python3 make g++` automatically. If you see build errors, ensure you're not overriding the base image.

## 6. Resources

- Full documentation: **[README.md](../README.md)**
- API examples: **[API_EXAMPLES.md](API_EXAMPLES.md)**
- Architecture: **[ARCHITECTURE.md](ARCHITECTURE.md)**
- Testing strategy: **[COMPREHENSIVE-TESTING-PLAN.md](COMPREHENSIVE-TESTING-PLAN.md)**

---

**You're ready to start!** 🚀
