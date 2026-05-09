---
name: eureka-microservice
description: 'Use when scaffolding a new TypeScript microservice that must register with the Eureka service registry in this monorepo. Bundles ready-to-copy templates for src/index.ts, src/eureka.ts, Dockerfile, package.json, and a docker-compose service block. Triggers: "new microservice", "add service", "scaffold service", "register with eureka".'
---

# Eureka Microservice Skill

This skill scaffolds a new microservice that drops cleanly into the existing monorepo.

## When to use
The user asks to add a new TypeScript microservice (e.g. `notifications-service`, `payments-service`, `audit-service`) that needs to register with Eureka and be reachable through the api-gateway.

## Procedure

1. **Read the templates** in `assets/`:
   - [`assets/index.ts.template`](./assets/index.ts.template)
   - [`assets/package.json.template`](./assets/package.json.template)
   - [`assets/Dockerfile.template`](./assets/Dockerfile.template)
   - [`assets/compose-block.yml.template`](./assets/compose-block.yml.template)

2. **Pick a port.** Used: 8080 (gateway), 8081 (customer), 8082 (inventory), 8083 (order), 8761 (eureka), 8090 (ui). New services should use 8084+.

3. **Create the service folder** at the workspace root using the template files. Replace placeholders:
   - `{{SERVICE_NAME}}` → kebab-case name (e.g. `notifications-service`)
   - `{{SERVICE_PORT}}` → chosen port
   - `{{SERVICE_ENV_NAME}}` → SHOUTY_SNAKE (e.g. `NOTIFICATIONS_SERVICE`)

4. **Copy verbatim** from `customer-service/src/`:
   - `eureka.ts`
   - `eureka-client.d.ts`
   Never modify these files.

5. **Create `tsconfig.json`** by copying `customer-service/tsconfig.json` unchanged.

6. **Append the compose block** from `assets/compose-block.yml.template` to `docker-compose.yml`.

7. **Add a proxy route** in `api-gateway/src/index.ts` so the new endpoints are reachable from the public API.

8. **Validate** by running `npm install && npx tsc --noEmit` inside the new service folder.

## Conventions to enforce
- Validate every request body with `zod`.
- Use `process.env.PORT ?? '<default>'` and `parseInt(..., 10)`.
- Expose `GET /actuator/health` returning `{ status: 'UP' }`.
- Call `startEurekaClient(<name>, Number(PORT))` after `app.listen`.
