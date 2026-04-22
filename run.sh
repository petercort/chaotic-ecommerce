#!/bin/bash

# Run script for E-Commerce Microservices (TypeScript/Node.js)
# Starts all services in separate background processes.
# Requires a prior ./build.sh run.
#
# Service ports:
#   8080 - API Gateway         (single client-facing entry point)
#   8081 - Customer Service
#   8082 - Inventory Service
#   8083 - Order Service
#   8090 - Demo UI
#
# Stop all with: kill $(cat /tmp/ecommerce-pids.txt) 2>/dev/null

set -e

echo "Starting E-Commerce Microservices..."
echo "======================================"

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE=/tmp/ecommerce-pids.txt
> "$PID_FILE"

start_service() {
    local name=$1
    local dir="$ROOT/$name"
    local log="/tmp/${name}.log"
    echo "Starting ${name} -> log: ${log}"
    (cd "$dir" && node dist/index.js > "$log" 2>&1) &
    echo $! >> "$PID_FILE"
}

start_node_service() {
    local name=$1
    local entrypoint="${2:-dist/index.js}"
    local dir="$ROOT/$name"
    local log="/tmp/${name}.log"
    echo "Starting ${name} -> log: ${log}"
    (cd "$dir" && node "$entrypoint" > "$log" 2>&1) &
    echo $! >> "$PID_FILE"
}

# Start data services first
start_service customer-service
start_service inventory-service
echo "Waiting 3s for data services..."
sleep 3

# Start order-service (depends on customer + inventory)
CUSTOMER_SERVICE_URL=http://localhost:8081 \
INVENTORY_SERVICE_URL=http://localhost:8082 \
start_service order-service
echo "Waiting 2s for order-service..."
sleep 2

# Start gateway (routes to all three)
CUSTOMER_SERVICE_URL=http://localhost:8081 \
INVENTORY_SERVICE_URL=http://localhost:8082 \
ORDER_SERVICE_URL=http://localhost:8083 \
start_service api-gateway

# Start demo-ui
API_GATEWAY_URL=http://localhost:8080 \
start_service demo-ui

echo ""
echo "All services started."
echo ""
echo "Endpoints (via API Gateway on :8080):"
echo "  GET  http://localhost:8080/api/customers"
echo "  GET  http://localhost:8080/api/products"
echo "  GET  http://localhost:8080/api/orders"
echo "  POST http://localhost:8080/api/orders"
echo ""
echo "Demo UI: http://localhost:8090"
echo ""
echo "To stop all services:"
echo "  kill \$(cat $PID_FILE)"
