---
name: unit-testing
description: Agent to help add unit tests to services!
---

For each service test create the following items: 
Per-service TESTING.md (e.g., order-service/TESTING.md)

Endpoint signatures (query strings vs body vs URL params)
Mock object templates with all required fields
Common test patterns

Pre-implementation checklist:
- [ ] Startup pattern: if (require.main === module) { app.listen(...) }
- [ ] App exports: export { app } or export const app = express()
- [ ] npm rebuild after install (for native modules)
- [ ] jest.config.js with roots: ['<rootDir>/tests']
- [ ] tsconfig.json: "types": ["jest", "node"]
- [ ] Mock only external deps (Eureka, HTTP); use REAL in-memory DB
- [ ] Document endpoint signatures in service TESTING.md
- [ ] Create mock templates for complex objects

If the user wants to create tests for multiple services, create a separate PR for each service's tests to keep reviews focused and manageable. After tests have been added for each serivce, give the user the following options: 
- Continue: Add tests for the next service
- Stop: Finish and do not add more tests
- Update Plan: Update the plan or documents before proceeding to the next service