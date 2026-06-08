---
name: docker-deploy
description: 'Use when starting, stopping, rebuilding, or debugging the docker-compose stack for this monorepo. Covers full stack startup, single-service rebuild, log tailing, health checks, port reference, env vars, and common failure diagnosis. Triggers: "start the stack", "bring up services", "rebuild service", "docker compose", "service not starting", "check logs", "service unhealthy", "stop all services", "deploy", "run locally".'
argument-hint: 'What do you need to do? (e.g. "start everything", "rebuild order-service", "check why api-gateway is unhealthy")'
---

# Docker Deploy Skill

Covers every common operation for running the Node.js/Eureka e-commerce stack locally with Docker Compose or the native `run.sh` launcher.

---

## Service Map

| Service | Container | Port | Health endpoint |
|---------|-----------|------|-----------------|
| Eureka Server | `eureka-server` | 8761 | `/actuator/health` |
| API Gateway | `api-gateway` | 8080 | `/actuator/health` |
| Customer Service | `customer-service` | 8081 | `/actuator/health` |
| Inventory Service | `inventory-service` | 8082 | `/actuator/health` |
| Order Service | `order-service` | 8083 | `/actuator/health` |
| Notifications Service | `notifications-service` | 8084 | `/actuator/health` |
| Demo UI | `demo-ui` | 8090 | — |
| Eureka Dashboard | `eureka-server` | 8761 | `/` |
| Prometheus | `prometheus` | 9090 | — (monitoring profile) |
| Grafana | `grafana` | 3000 | — (monitoring profile) |

New services should use ports **8085+**.

---

## Startup Procedures

### Option A — Docker Compose (recommended)

```bash
# Build images and start all services
docker compose up --build

# Start without rebuilding (faster if no code changes)
docker compose up

# Start in background
docker compose up -d

# Include monitoring (Prometheus + Grafana)
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Compose respects `depends_on` + `condition: service_healthy`, so services start in the correct order automatically.

### Option B — Native Node.js (no Docker)

```bash
# 1. Build all TypeScript services
./build.sh

# 2. Start all services (writes PIDs to /tmp/ecommerce-pids.txt)
./run.sh

# Stop all
kill $(cat /tmp/ecommerce-pids.txt)
```

Logs are written to `/tmp/<service-name>.log`.

---

## Common Operations

### Rebuild a single service

```bash
docker compose up -d --build <service-name>
# e.g.
docker compose up -d --build order-service
```

### Tail logs for one service

```bash
docker compose logs -f <service-name>
# e.g.
docker compose logs -f api-gateway
```

### Tail logs for all services

```bash
docker compose logs -f
```

### Restart a service without rebuilding

```bash
docker compose restart <service-name>
```

### Stop everything and remove containers

```bash
docker compose down
# Also remove volumes (resets in-memory DBs on restart):
docker compose down -v
```

### Check container health status

```bash
docker compose ps
# Or inspect a specific container:
docker inspect --format='{{.State.Health.Status}}' <container-name>
```

### Verify all services are healthy via API

```bash
bash scripts/verify-steady-state.sh
```

---

## Startup Order and Dependencies

Eureka must be healthy **before** any other service starts — it is the service registry.  
The correct startup order is:

1. `eureka-server` (waits for `/actuator/health` → `UP`)
2. `customer-service`, `inventory-service` (parallel, depend on Eureka)
3. `order-service` (depends on customer + inventory being healthy)
4. `api-gateway`, `notifications-service` (depend on Eureka)
5. `demo-ui`

Docker Compose enforces this automatically. When running with `run.sh`, the script uses `sleep` guards — if a service crashes, check its log first.

---

## Diagnosing Common Failures

### Service shows `unhealthy` in `docker compose ps`

```bash
# 1. Check the container log
docker compose logs <service-name> | tail -40

# 2. Manually probe the health endpoint
curl http://localhost:<port>/actuator/health

# 3. Check if the port is already in use
lsof -i :<port>
```

### `Error: connect ECONNREFUSED` in a service log

The upstream it depends on is not ready yet. Restart in order:
```bash
docker compose restart eureka-server
sleep 10
docker compose restart <failing-service>
```

### Eureka shows services as `DOWN` in dashboard

Services deregister when stopped. After restarting a service, wait ~30 s for the heartbeat to re-register, then refresh `http://localhost:8761`.

### Port already in use

```bash
# Find and kill the process using the port
lsof -ti :<port> | xargs kill -9
```

### TypeScript compile errors after a code change (native mode)

```bash
# Rebuild only the changed service
cd <service-name> && npm run build
# Then restart it via docker compose or run.sh
```

---

## Environment Variables

Key variables consumed by the stack (set automatically by Compose via `environment:` blocks):

| Variable | Default | Consumed by |
|----------|---------|-------------|
| `EUREKA_HOST` | `eureka-server` (Docker) / `localhost` (native) | All services |
| `CUSTOMER_SERVICE_URL` | `http://customer-service:8081` | order-service, api-gateway |
| `INVENTORY_SERVICE_URL` | `http://inventory-service:8082` | order-service, api-gateway |
| `ORDER_SERVICE_URL` | `http://order-service:8083` | api-gateway |
| `NOTIFICATIONS_SERVICE_URL` | `http://notifications-service:8084` | api-gateway |
| `API_GATEWAY_URL` | `http://localhost:8080` | demo-ui |
| `*_SERVICE_PORT` | port number | Overrides the host-side port mapping |

Override a port on the host side (e.g. to avoid a conflict):
```bash
CUSTOMER_SERVICE_PORT=9081 docker compose up -d customer-service
```

---

## Quick Smoke Test

After startup, confirm everything is reachable:

```bash
curl -s http://localhost:8080/api/customers | jq .
curl -s http://localhost:8080/api/products   | jq .
curl -s http://localhost:8080/api/orders     | jq .
```

All three should return `200` with JSON arrays.  
Open the Demo UI at `http://localhost:8090` for a browser-based check.
