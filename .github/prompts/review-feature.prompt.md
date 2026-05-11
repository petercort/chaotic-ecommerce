---
name: review-feature
description: Review a recently-added feature for code quality, consistency with existing services, security, and test coverage.
---

Review the most recent changes (the new feature just added) and produce a structured report:

1. **Consistency** — does the new code match the patterns used by existing microservices (file layout, Eureka registration, health endpoint, error handling)?
2. **Security** — any obvious OWASP issues (input validation, unsanitized output, missing auth, secrets in code)?
3. **Operability** — graceful shutdown, structured logging, env-var configuration, health checks?
4. **Testability** — is the code structured so it can be tested? Are there any tests?
5. **Top 3 fixes** — concrete, prioritized changes you would make before merging.

Cite files using workspace-relative paths.
