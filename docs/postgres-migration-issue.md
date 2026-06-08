# Story: Add PostgreSQL for Customer Data Persistence

## Summary
Customer data is currently stored in in-memory SQLite and is lost on service restart.  
Migrate `customer-service` to PostgreSQL so customer records are durable across restarts and deployments.

## User Story
As a platform engineer,  
I want customer records to be stored in PostgreSQL,  
So that customer data is persistent, reliable, and production-ready.

## Problem
- Current storage is ephemeral (`:memory:` SQLite)
- Data is lost when services restart
- No durable backing database for customer domain

## Scope
- Add PostgreSQL to local/container stack
- Update `customer-service` data layer to use PostgreSQL
- Add schema creation/migration for customers table
- Keep API contracts unchanged
- Add env-based seed behavior
- Update tests and documentation

## Acceptance Criteria
1. Customer records persist in PostgreSQL and survive service restarts.
2. Existing customer API routes and payloads remain backward-compatible.
3. Customers schema is created automatically (migration or init step).
4. Email remains unique at the database level.
5. Docker Compose includes PostgreSQL with a named persistent volume.
6. `customer-service` fails health checks if DB connection is unavailable.
7. Automated tests pass with PostgreSQL-backed data access.
8. README includes setup, env vars, migration/init, and troubleshooting steps.

## Technical Breakdown
- **Infra**
  - Add `postgres` service to compose
  - Add volume for durable data
  - Add DB connection env vars
- **App**
  - Replace SQLite repository calls in `customer-service`
  - Add PostgreSQL connection management (retry + startup validation)
- **Schema**
  - Create `customers` table + indexes + unique constraint on `email`
- **Testing**
  - Update service tests for PostgreSQL-backed execution
  - Ensure test isolation/cleanup strategy
- **Docs**
  - Update local runbook and configuration docs

## Non-Goals
- Migrating all other services to PostgreSQL in this story
- Changing customer API contracts
- Introducing cross-service shared database patterns

## Risks & Mitigations
- **Risk:** Startup race between app and DB  
  **Mitigation:** retry/backoff + healthcheck gating
- **Risk:** Test flakiness with shared DB state  
  **Mitigation:** per-test cleanup or isolated test DB
- **Risk:** Breaking existing demo flows  
  **Mitigation:** preserve API schema and add compatibility tests

## Definition of Done
- Customer CRUD works end-to-end against PostgreSQL
- Data remains after restart
- CI/local tests are green
- Docs are updated and reproducible by another developer