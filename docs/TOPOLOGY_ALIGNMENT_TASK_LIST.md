# Topology Alignment Task List

## Goal

Align the local scripts, Docker Compose topology, and top-level documentation so they all describe and run the same default system.

Current mismatch:
- `docker-compose.yml` includes `eureka-server` and `notifications-service`
- `build.sh` and `run.sh` only handle the older core services plus `demo-ui`
- `README.md` still describes an outdated topology and startup story

---

## Decision Gate

Before making code changes, choose one of these target states:

### Full Stack Is Canonical

Treat these as required default services:
- `eureka-server`
- `customer-service`
- `inventory-service`
- `order-service`
- `notifications-service`
- `api-gateway`
- `demo-ui`

---

## Implementation Tasks

### 1. Confirm the target topology

- Decide whether Option A or Option B is the source of truth.
- Record the decision in `README.md` and in this document once implementation is complete.
- Verify that the chosen topology matches the product story the repo is supposed to tell.

### 2. Update `build.sh`

- Add `eureka-server` to the build order.
- Add `notifications-service` to the build order.
- Verify the build order respects dependencies where helpful for readability.
- Confirm all built services actually expose a `build` script.

Validation tasks:
- Run `./build.sh` from a clean state.
- Confirm every service listed in the script produces a runnable artifact.

### 3. Update `run.sh`

- Start `eureka-server` before all Eureka-registered services.
- Start `notifications-service` before `api-gateway`.
- Pass any required environment variables for local service-to-service communication.
- Update the printed startup summary to include all running services and ports.
- Confirm `run.sh` starts a topology that matches `docker-compose.yml`.

Validation tasks:
- Run `./run.sh` after a successful build.
- Verify each expected health endpoint responds successfully.
- Verify the stop command still terminates every spawned process.

### 4. Reconcile `docker-compose.yml`

If Option A is chosen:
- Keep `eureka-server` and `notifications-service` in the default stack.
- Verify `depends_on` and health checks reflect the real runtime dependencies.
- Confirm environment variables in Compose match the local script behavior.

Validation tasks:
- Run `docker compose up -d` for the default path.
- Run `docker compose ps` and verify the service list matches the docs.
- Verify the gateway can reach all services in the selected default topology.

### 5. Update `README.md`

Required updates:
- Rewrite the service overview table so it matches the chosen topology.
- Fix the architecture narrative around service discovery.
- Update the project structure summary.
- Update local build and run instructions.
- Update any API endpoint sections affected by the topology decision.
- Note whether notifications is part of the product flow or only a scaffolded endpoint.

Specific drift to correct:
- Remove claims that Docker DNS is the only discovery path if Eureka remains required.
- Remove claims that only five services collaborate if the default stack now includes more.
- Align the wording around `demo-ui`, gateway routing, and notifications support.

Validation tasks:
- Read the updated README from top to bottom as a fresh user would.
- Confirm every command in the quick start section still works.
- Confirm there are no references to a topology the repo no longer uses.

### 6. Update related operational docs

- Check `docs/README.md` if needed for consistency with the top-level README.
- Update `docker-compose.monitoring.yml` metadata such as stale repository names.
- Review `docs/TESTING_CAPABILITIES.md` if the service list changes.

Validation tasks:
- Search the repo for outdated service counts and stale topology phrases.
- Fix the highest-signal documentation drift in the same pass.

---

## Recommended Order of Work

1. Decide canonical topology.
2. Update `build.sh`.
3. Update `run.sh`.
4. Reconcile `docker-compose.yml` and related Compose files.
5. Update `README.md`.
6. Update supporting docs.
7. Run local and Docker validation.

---

## Acceptance Criteria

- The default local workflow starts the same topology that the README describes.
- The default Docker workflow starts the same topology that the README describes.
- There is a clear, documented answer to whether `eureka-server` and `notifications-service` are required or optional.
- No top-level docs describe an outdated service count or outdated discovery mechanism.
- A contributor can follow the documented quick start without encountering missing services.

---

## Suggested Validation Commands

```bash
./build.sh
./run.sh
curl http://localhost:8080/actuator/health
curl http://localhost:8081/actuator/health
curl http://localhost:8082/actuator/health
curl http://localhost:8083/actuator/health
docker compose up -d
docker compose ps
```

If the full stack is canonical, also validate:

```bash
curl http://localhost:8761/actuator/health
curl http://localhost:8084/actuator/health
curl http://localhost:8080/api/notifications
```