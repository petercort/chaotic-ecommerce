---
name: add-notifications-service
description: Scaffold a brand-new notifications microservice that other services can call when an incident is detected.
---

Add a new microservice called **`notifications-service`** to this monorepo.

Requirements:
- Express + TypeScript, runs on port `8084`.
- Exposes:
  - `POST /api/notifications` — body `{ channel: 'email'|'sms'|'webhook', to: string, subject: string, body: string }`. Stores the notification in memory and returns `{ id, status: 'sent' }`.
  - `GET /api/notifications` — returns all stored notifications.
  - `GET /actuator/health` — returns `{ status: 'UP' }`.
- Registers with the existing Eureka server.
- Add a `Dockerfile` and wire the service into `docker-compose.yml` so the api-gateway can reach it.
- Add a route in `api-gateway` so `POST /api/notifications` is proxied to the new service.

When you finish, list every file you created or modified.
