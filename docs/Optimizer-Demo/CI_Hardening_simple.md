Absolutely. Here’s the plan in plain terms:

1. Make CI startup checks reliable:
- Replace fixed sleep delays in workflows with a shared health-check script.
- Update PR smoke, E2E, and resilience workflows to wait for real service readiness.
- Standardize timeout and logging behavior so failures are obvious and fast to debug.

2. Add focused tests for order-service:
- Set up a package-level unit test harness.
- Test the order saga success path, failure paths, and compensation logic (stock restore on partial failure).
- Add route-level validation tests for bad payloads and missing resources.

3. Add focused tests for api-gateway:
- Set up a package-level unit/integration-style test harness.
- Test route proxy mapping for customers, products, orders, and notifications.
- Test forwarding behavior (params, body, headers, status/body passthrough).
- Test failure mapping (open circuit -> 503, other upstream failures -> 502).

4. Wire new tests into dev and CI:
- Add clear npm test scripts in both services.
- Run these narrow tests in CI before broader smoke/E2E checks.
- Document how to run service-level tests locally.

Definition of done:
- No primary CI readiness logic depends on blind sleeps.
- Order and gateway have deterministic, local runnable tests for core behavior.
- CI includes these tests as first-line regression protection.