---
name: chaos-scenario
description: 'Use when authoring, running, or reviewing chaos engineering experiments in this monorepo. Covers steady-state hypothesis, fault injection (service kill, latency, network partition, overload), result recording to CSV, and cleanup/restore. Triggers: "add chaos scenario", "new chaos test", "inject fault", "chaos experiment", "resilience test", "run chaos", "network partition", "latency injection", "kill service".'
argument-hint: 'Describe the fault you want to inject (e.g. "kill order-service and verify gateway fallback")'
---

# Chaos Scenario Skill

Encodes the conventions for writing and running chaos experiments against the Node.js/Eureka e-commerce stack.

## When to use

The user asks to:
- Add a new chaos scenario
- Run an existing scenario and interpret results
- Debug why a scenario is failing
- Review or improve an existing `scenarios/sN-*.sh` file

---

## Existing Scenarios

| Script | Fault | What it validates |
|--------|-------|-------------------|
| `s1-eureka-kill.sh` | Stop Eureka server | Registry cache survivability |
| `s2-customer-service-kill.sh` | Stop customer-service | Gateway error handling (4xx/5xx fallback) |
| `s3-inventory-latency.sh` | Chaos Monkey latency 8–12s | Fast-fail via circuit breaker |
| `s4-gateway-overload.sh` | Concurrent request flood | Gateway throughput under load |
| `s5-cascade-failure.sh` | Kill multiple services | Cascade isolation |
| `s6-network-partition.sh` | Docker network disconnect | Split-brain behaviour |
| `s7-jvm-heap-exhaustion.sh` | Memory stress | OOM recovery |
| `s8-network-packet-drop.sh` | `tc netem` packet drop | Timeout and retry behaviour |

Run all: `bash scenarios/run-all-chaos.sh`

---

## Procedure — Adding a New Scenario

### 1. Choose a scenario number and name

Next available number: **S9**. Name pattern: `s<N>-<fault-noun>.sh`.

### 2. Use the template

Copy [`assets/scenario.sh.template`](./assets/scenario.sh.template) to `scenarios/s<N>-<name>.sh` and fill in every `{{PLACEHOLDER}}`.

### 3. Define the steady-state hypothesis (required)

At the top of the script add a comment block:
```bash
# Hypothesis: <one sentence describing observable system behaviour>
# Steady state: all 5 services healthy, /api/customers /api/products /api/orders → 200
# Blast radius: <which services are affected>
# Expected outcome: <what should happen during fault, e.g. "gateway returns 503, recovers within 10s">
```

### 4. Verify steady state before and after

Call `bash "$SCRIPTS_DIR/verify-steady-state.sh"` as step 1 and again as the final step.  
**Never skip the before-check** — a pre-existing failure will produce misleading results.

### 5. Record results to CSV

Use the `LOG_FILE="$RESULTS_DIR/s<N>-requests.csv"` pattern with header `seq,http_code,elapsed_ms,result`.  
Append one row per request inside a background subshell.

### 6. Clean up in a `trap cleanup EXIT`

Always restore the system in a `cleanup()` function registered with `trap cleanup EXIT` so the stack is usable after a failure mid-script.

### 7. Assert pass/fail at exit

Print `S<N> PASSED` or `S<N> FAILED` and `exit 0` / `exit 1` accordingly so `run-all-chaos.sh` can aggregate results.

---

## Assertion Helpers (`scripts/assert.sh`)

Source with: `source "$SCRIPTS_DIR/assert.sh"`

| Function | Signature | Use |
|----------|-----------|-----|
| `assert_http` | `url [expected_code=200]` | Check HTTP status |
| `assert_response_contains` | `url pattern` | Check response body |
| `assert_service_up` | `name port` | Health-check via `/actuator/health` |

---

## Common Fault Patterns

**Kill a container:**
```bash
docker compose -f "$COMPOSE_FILE" stop <service-name>
# restore:
docker compose -f "$COMPOSE_FILE" start <service-name>
```

**Inject latency via Chaos Monkey (services that support it):**
```bash
curl -s -X POST http://localhost:<port>/actuator/chaosmonkey/assaults \
  -H "Content-Type: application/json" \
  -d '{"latencyActive":true,"latencyRangeStart":5000,"latencyRangeEnd":8000,"level":1}'
# disable:
curl -s -X POST http://localhost:<port>/actuator/chaosmonkey/disable
```

**Network partition via Docker:**
```bash
docker network disconnect ecommerce-net <container>
# restore:
docker network connect ecommerce-net <container>
```

**Packet drop via tc netem (requires NET_ADMIN cap or host network):**
```bash
tc qdisc add dev eth0 root netem loss 30%
# restore:
tc qdisc del dev eth0 root
```

---

## Running Scenarios

```bash
# Single scenario
bash scenarios/s1-eureka-kill.sh

# All scenarios (continues on failure)
bash scenarios/run-all-chaos.sh

# Watch live metrics during a run
bash scripts/watch-chaos.sh

# Verify steady state only
bash scripts/verify-steady-state.sh
```

Results are written to `results/s<N>-requests.csv`.

---

## Interpretation

A scenario **passes** when the system behaves as the hypothesis states under fault conditions.  
A scenario **warns** when recovery happens but is slower than expected.  
A scenario **fails** when the system is left degraded or the hypothesis is violated.
