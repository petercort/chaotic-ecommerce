#!/bin/bash

# Build script for E-Commerce Microservices (TypeScript/Node.js)
# Installs dependencies and compiles TypeScript for all Node.js services.
#
# NOTE: For Docker-based deployment, use docker compose up --build instead.

set -e

echo "Building E-Commerce Microservices..."
echo "====================================="

ROOT="$(cd "$(dirname "$0")" && pwd)"

build_service() {
    local name=$1
    local dir="$ROOT/$name"
    echo ""
    echo "Building $name..."
    (cd "$dir" && npm ci && npm run build)
    echo "✓ $name built"
}

build_service customer-service
build_service auth-service
build_service inventory-service
build_service order-service
build_service api-gateway
build_service demo-ui

echo ""
echo "====================================="
echo "✅ All services built successfully!"
echo ""
echo "To run all services:"
echo "  ./run.sh"
echo ""
echo "Or with Docker:"
echo "  docker compose up"
