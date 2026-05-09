---
name: test-conventions
description: 'Use when adding or reviewing tests in this monorepo. Bundles a Jest config, supertest example, and Eureka mock so tests do not actually start the registry. Triggers: "add tests", "write unit tests", "test this service", "jest setup", "supertest".'
---

# Test Conventions Skill

This skill enforces the project test conventions and ships a copy-paste-ready Jest setup.

## When to use
The user asks to add tests for any service, or asks "how should I test this?"

## Procedure

1. **Tests live next to the service** in `<service>/tests/`. Never put them at the repo root.
2. **Add Jest deps** (one-time per service):
   ```
   npm install -D jest ts-jest @types/jest supertest @types/supertest
   ```
3. **Drop the templates** from `assets/` into the service folder:
   - [`assets/jest.config.js.template`](./assets/jest.config.js.template) → `<service>/jest.config.js`
   - [`assets/eureka.mock.ts.template`](./assets/eureka.mock.ts.template) → `<service>/tests/__mocks__/eureka.ts`
   - [`assets/health.test.ts.template`](./assets/health.test.ts.template) → `<service>/tests/health.test.ts`
4. **Add a test script** to the service's `package.json`: `"test": "jest"`.
5. **Mock Eureka in every test file** with `jest.mock('../src/eureka')` — never start the real client.
6. **Use `supertest`** against the Express app, not real HTTP.
7. **Never test against a database**; use an in-memory store or mock `db.ts`.

## What good looks like
- Each route file has a matching `<route>.test.ts` covering happy path + 1 validation error + 1 not-found.
- No test imports `eureka-js-client`.
- Test run completes in under 5 seconds per service.
