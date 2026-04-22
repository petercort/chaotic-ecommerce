#!/bin/bash

# start.sh — Build and start the full e-commerce stack with Docker Compose.
#
# Usage:
#   ./start.sh              # build images + start all services
#   ./start.sh --no-build   # start using existing images (skip build)
#   ./start.sh --monitoring # also start Prometheus + Grafana monitoring stack
#   ./start.sh --down       # stop and remove all containers
#   ./start.sh --logs       # tail logs for all running containers

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.yml"
MONITORING_FILE="$ROOT/docker-compose.monitoring.yml"

# ── Colour helpers ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
info() { echo -e "${YELLOW}→ $*${NC}"; }
fail() { echo -e "${RED}✗ $*${NC}"; exit 1; }

# ── Argument parsing ───────────────────────────────────────────────────────────
NO_BUILD=false
MONITORING=false
DOWN=false
LOGS=false

for arg in "$@"; do
  case $arg in
    --no-build)   NO_BUILD=true ;;
    --monitoring) MONITORING=true ;;
    --down)       DOWN=true ;;
    --logs)       LOGS=true ;;
    --help|-h)
      echo "Usage: ./start.sh [options]"
      echo ""
      echo "Options:"
      echo "  --no-build    Skip image build (use cached images)"
      echo "  --monitoring  Also start Prometheus + Grafana stack"
      echo "  --down        Stop and remove all containers"
      echo "  --logs        Tail logs for all running containers"
      echo "  --help        Show this help message"
      exit 0
      ;;
    *) fail "Unknown option: $arg (use --help for usage)" ;;
  esac
done

# ── Require Docker ─────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  fail "Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop"
fi

# ── --down ─────────────────────────────────────────────────────────────────────
if $DOWN; then
  info "Stopping all containers..."
  if $MONITORING; then
    docker compose -f "$COMPOSE_FILE" -f "$MONITORING_FILE" down
  else
    docker compose -f "$COMPOSE_FILE" down
  fi
  ok "All containers stopped."
  exit 0
fi

# ── --logs ─────────────────────────────────────────────────────────────────────
if $LOGS; then
  docker compose -f "$COMPOSE_FILE" logs -f
  exit 0
fi

# ── Build + start ──────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════╗"
echo "║   E-Commerce Microservices Stack     ║"
echo "╚══════════════════════════════════════╝"
echo ""

COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if $MONITORING; then
  COMPOSE_ARGS+=(-f "$MONITORING_FILE")
  info "Monitoring stack enabled (Prometheus + Grafana)"
fi

if $NO_BUILD; then
  info "Skipping build (using existing images)..."
else
  info "Building Docker images..."
  docker compose "${COMPOSE_ARGS[@]}" build
  ok "Images built."
fi

info "Starting containers..."
docker compose "${COMPOSE_ARGS[@]}" up -d
echo ""

# ── Wait for gateway health ────────────────────────────────────────────────────
info "Waiting for services to become healthy..."
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' api-gateway 2>/dev/null || echo "missing")
  if [ "$STATUS" = "healthy" ]; then
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  echo -ne "\r  ${YELLOW}→ api-gateway: ${STATUS} (${ELAPSED}s)${NC}   "
done
echo ""

if [ "$STATUS" != "healthy" ]; then
  echo ""
  echo -e "${YELLOW}⚠ Services may still be starting. Check status with:${NC}"
  echo "    docker compose ps"
  echo "    docker compose logs api-gateway"
else
  ok "All services healthy."
fi

# ── Print access URLs ──────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Services are running!                               ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Demo UI       →  http://localhost:8090              ║"
echo "║  API Gateway   →  http://localhost:8080              ║"
echo "║  Customers     →  http://localhost:8080/api/customers║"
echo "║  Products      →  http://localhost:8080/api/products ║"
echo "║  Orders        →  http://localhost:8080/api/orders   ║"
if $MONITORING; then
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Grafana       →  http://localhost:3000  (admin/admin)║"
echo "║  Prometheus    →  http://localhost:9090              ║"
fi
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Stop:   ./start.sh --down                           ║"
echo "║  Logs:   ./start.sh --logs                           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
