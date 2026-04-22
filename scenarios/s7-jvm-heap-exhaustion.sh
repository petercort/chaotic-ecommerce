#!/bin/bash
# S7: JVM Heap Exhaustion — test service resilience under severe memory constraints (OOM simulation)
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")/../scripts" && pwd)"
RESULTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/results"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$RESULTS_DIR"
source "$SCRIPTS_DIR/assert.sh"

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

TARGET_SERVICE="order-service"
TARGET_PORT=8083
TARGET_IMAGE="copilot-spring-boot-demo-order-service:latest"
HEAP_CONTAINER="${TARGET_SERVICE}-heap-test"
NETWORK="copilot-typescript-demo_ecommerce-net"
HEAP_SIZE="-Xmx32m"
LOG="$RESULTS_DIR/s7-heap-exhaustion.log"

cleanup() {
    echo ""
    echo -e "${YELLOW}[CLEANUP] Removing heap-constrained container and restoring ${TARGET_SERVICE}...${RESET}"
    docker rm -f "$HEAP_CONTAINER" 2>/dev/null || true
    (cd "$PROJECT_DIR" && docker compose up -d "$TARGET_SERVICE") 2>/dev/null || true
    echo -e "${GREEN}[CLEANUP] ${TARGET_SERVICE} restored via docker compose.${RESET}"
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BLUE}${BOLD}║  S7: JVM Heap Exhaustion Chaos Scenario                      ║${RESET}"
echo -e "${BLUE}${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo -e "${CYAN}Target:     ${TARGET_SERVICE} (port ${TARGET_PORT})${RESET}"
echo -e "${CYAN}Heap limit: ${HEAP_SIZE}  (normal Spring Boot requires ~256 MB+; this is extreme)${RESET}"
echo -e "${CYAN}Hypothesis: A severely heap-constrained order-service becomes${RESET}"
echo -e "${CYAN}            unhealthy / OOM-killed under load while customer-service,${RESET}"
echo -e "${CYAN}            inventory-service, and api-gateway remain fully available.${RESET}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo -e "${BLUE}[1/6] Verifying steady state...${RESET}"
bash "$SCRIPTS_DIR/verify-steady-state.sh"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[2/6] Stopping normal ${TARGET_SERVICE} container...${RESET}"
(cd "$PROJECT_DIR" && docker compose stop "$TARGET_SERVICE")
echo -e "${GREEN}  ${TARGET_SERVICE} stopped.${RESET}"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${RED}[3/6] ⚡ CHAOS: Launching heap-constrained ${TARGET_SERVICE} (${HEAP_SIZE})...${RESET}"
docker run -d \
    --name "$HEAP_CONTAINER" \
    --network "$NETWORK" \
    --network-alias "$TARGET_SERVICE" \
    -p "${TARGET_PORT}:${TARGET_PORT}" \
    -e JAVA_TOOL_OPTIONS="${HEAP_SIZE} -XX:+ExitOnOutOfMemoryError -XX:+HeapDumpOnOutOfMemoryError" \
    -e SPRING_PROFILES_ACTIVE=docker \
    -e EUREKA_CLIENT_SERVICEURL_DEFAULTZONE=http://eureka-server:8761/eureka/ \
    "$TARGET_IMAGE"

echo -e "${YELLOW}  Waiting 30s for constrained service startup attempt...${RESET}"
sleep 30

STARTUP_STATUS=$(docker inspect --format '{{.State.Status}}' "$HEAP_CONTAINER" 2>/dev/null || echo "not found")
echo -e "  Container status after startup: ${BOLD}${STARTUP_STATUS}${RESET}"
if [ "$STARTUP_STATUS" = "exited" ]; then
    STARTUP_EXIT=$(docker inspect --format '{{.State.ExitCode}}' "$HEAP_CONTAINER" 2>/dev/null || echo "?")
    echo -e "  ${RED}⚡ Container exited (code ${STARTUP_EXIT}) — likely OOM during JVM init${RESET}"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[4/6] Firing 100 rapid-fire requests to exhaust heap / trigger GC storms...${RESET}"
PASS_COUNT=0
FAIL_COUNT=0
for i in $(seq 1 100); do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "http://localhost:8080/api/orders" \
        -H "Content-Type: application/json" \
        -d '{"customerId":1,"items":[{"productId":1,"quantity":10},{"productId":2,"quantity":10}],"shippingAddress":"123 Main","shippingCity":"NYC","shippingState":"NY","shippingZip":"10001","shippingCountry":"USA"}' \
        --max-time 10 2>/dev/null || echo "000")
    printf "  Request %2d: HTTP %s\n" "$i" "$CODE"
    [ "$CODE" = "200" ] && PASS_COUNT=$((PASS_COUNT + 1)) || FAIL_COUNT=$((FAIL_COUNT + 1))
    sleep 0.05
done
echo -e "  Burst results: ${GREEN}${PASS_COUNT} success${RESET} / ${RED}${FAIL_COUNT} failed${RESET}"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[5/6] Assessing system state after heap pressure...${RESET}"

CONTAINER_STATUS=$(docker inspect --format '{{.State.Status}}' "$HEAP_CONTAINER" 2>/dev/null || echo "not found")
CONTAINER_OOM=$(docker inspect --format '{{.State.OOMKilled}}' "$HEAP_CONTAINER" 2>/dev/null || echo "false")

echo -e "  ${TARGET_SERVICE} container status : ${BOLD}${CONTAINER_STATUS}${RESET}"
echo -e "  OOMKilled flag                    : ${BOLD}${CONTAINER_OOM}${RESET}"

OOM_IN_LOGS=false
if docker logs "$HEAP_CONTAINER" 2>&1 | grep -qiE "OutOfMemoryError|Cannot allocate memory|GC overhead limit|Terminating due to java.lang.OutOfMemoryError"; then
    OOM_IN_LOGS=true
    echo -e "  ${RED}⚡ OOM-related log entries detected in ${TARGET_SERVICE} container${RESET}"
else
    echo -e "  No OOM log entries found (service may have exited before logging)"
fi

HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:${TARGET_PORT}/actuator/health" --max-time 5 2>/dev/null || echo "000")
echo -e "  Actuator health (constrained)     : HTTP ${HEALTH_CODE}"

echo ""
echo -e "  Verifying other services remain up (no cascade)..."
OTHERS_UP=true
assert_service_up "api-gateway"       8080 || OTHERS_UP=false
assert_service_up "customer-service"  8081 || OTHERS_UP=false
assert_service_up "inventory-service" 8082 || OTHERS_UP=false

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[6/6] Scenario verdict...${RESET}"

SCENARIO_PASS=true

# Assertion 1: no cascade — all other services must remain up
if [ "$OTHERS_UP" = "true" ]; then
    echo -e "  ${GREEN}✅ PASS — No cascade: api-gateway, customer-service, inventory-service all UP${RESET}"
else
    echo -e "  ${RED}❌ FAIL — Cascade detected: one or more peer services went down${RESET}"
    SCENARIO_PASS=false
fi

# Assertion 2: constrained service shows signs of distress
STRESSED=false
[ "$CONTAINER_OOM"    = "true"    ] && STRESSED=true
[ "$OOM_IN_LOGS"      = "true"    ] && STRESSED=true
[ "$CONTAINER_STATUS" = "exited"  ] && STRESSED=true
[ "$FAIL_COUNT"       -gt 10      ] && STRESSED=true
[ "$HEALTH_CODE"      != "200"    ] && STRESSED=true

if [ "$STRESSED" = "true" ]; then
    echo -e "  ${GREEN}✅ PASS — Heap exhaustion observed (OOMKilled=${CONTAINER_OOM}, OOMLog=${OOM_IN_LOGS}, status=${CONTAINER_STATUS}, fails=${FAIL_COUNT})${RESET}"
else
    echo -e "  ${YELLOW}⚠  WARN — ${TARGET_SERVICE} survived ${HEAP_SIZE} without obvious distress; consider reducing heap further${RESET}"
fi

# Persist results
{
    echo "S7: JVM Heap Exhaustion — $(date)"
    echo "Heap setting      : $HEAP_SIZE"
    echo "Container status  : $CONTAINER_STATUS"
    echo "OOMKilled         : $CONTAINER_OOM"
    echo "OOM in logs       : $OOM_IN_LOGS"
    echo "Health HTTP code  : $HEALTH_CODE"
    echo "Request results   : $PASS_COUNT success / $FAIL_COUNT failed"
    echo "Cascade detected  : $([ "$OTHERS_UP" = "true" ] && echo no || echo YES)"
} >> "$LOG"

echo ""
if [ "$SCENARIO_PASS" = "true" ]; then
    echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════════${RESET}"
    echo -e "${GREEN}${BOLD}  ✅  S7 PASSED — Heap exhaustion contained; no cascade failure  ${RESET}"
    echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════════${RESET}"
else
    echo -e "${RED}${BOLD}════════════════════════════════════════════════════════════════${RESET}"
    echo -e "${RED}${BOLD}  ❌  S7 FAILED — Unexpected behaviour under JVM heap pressure   ${RESET}"
    echo -e "${RED}${BOLD}════════════════════════════════════════════════════════════════${RESET}"
fi
echo "Full log: $LOG"
