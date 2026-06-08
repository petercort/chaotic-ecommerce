## Summary
There is no rate limiting anywhere in the stack. The api-gateway accepts unbounded request volume, leaving services open to abuse and making overload behavior harder to reason about.

## Current state
- No rate limiter in api-gateway or any service.
- Chaos scenario S4 (gateway overload) exists but there is no protective throttle.

## Proposed change
- Add a token-bucket / sliding-window rate limiter at the api-gateway (e.g. `express-rate-limit`).
- Make limits configurable via env vars.
- Optionally back counters with Redis (see Redis caching issue) for multi-instance correctness.

## Acceptance criteria
- [ ] Requests exceeding the configured limit return `429`.
- [ ] Limits configurable via environment variables.
- [ ] Behavior validated against the S4 overload scenario.

Priority: 🔴 High impact — security & correctness
