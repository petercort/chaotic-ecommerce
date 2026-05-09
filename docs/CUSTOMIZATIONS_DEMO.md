# Demo: The Power of Copilot Customizations

A 4-stage live demo showing how each layer of customization changes the *quality* of Copilot's output for the same task.

The task throughout: **"Add a notifications microservice to this monorepo."**

---

## Setup (once, before the demo)

1. Open this repo in VS Code with GitHub Copilot enabled.
2. **Hide** the customizations so you can re-add them on stage:
   ```bash
   mkdir -p .demo-stash
   mv .github/copilot-instructions.md   .demo-stash/ 2>/dev/null
   mv .github/agents                    .demo-stash/ 2>/dev/null
   mv .github/skills                    .demo-stash/ 2>/dev/null
   ```
   Keep `.github/prompts/` in place for Stage 1.
3. Install the eval extension: **Chat Customizations Evaluations** (`ms-vscode.vscode-chat-customizations-evaluations`).
4. Open the Copilot Chat panel.

To reset between runs, delete any `notifications-service/` folder Copilot creates and `git checkout -- docker-compose.yml api-gateway/`.

---

## Stage 1 — Baseline: just a prompt

**Goal:** show what raw Copilot does when it has *no project context*.

1. In chat, run:
   ```
   /add-notifications-service
   ```
   (from [.github/prompts/add-notifications-service.prompt.md](.github/prompts/add-notifications-service.prompt.md))
2. Let Copilot generate the service.
3. Then run:
   ```
   /review-feature
   ```
   (from [.github/prompts/review-feature.prompt.md](.github/prompts/review-feature.prompt.md))

**Talking points — what you'll likely see go wrong:**
- Wrong port (collides with an existing service).
- Eureka registration missing or rewritten from scratch (not the project pattern).
- No zod validation.
- Health endpoint shape inconsistent with siblings.
- Dockerfile may not be multi-stage.
- `docker-compose.yml` block may miss the healthcheck or `depends_on`.

Reset the workspace before Stage 2.

---

## Stage 2 — Add `copilot-instructions.md` + a custom agent

**Goal:** show how project conventions and a specialised agent dramatically tighten the output.

1. Restore the customizations:
   ```bash
   mv .demo-stash/copilot-instructions.md .github/
   mv .demo-stash/agents                  .github/
   ```
   Files in play:
   - [.github/copilot-instructions.md](.github/copilot-instructions.md) — always-on conventions.
   - [.github/agents/microservice-scaffolder.agent.md](.github/agents/microservice-scaffolder.agent.md) — custom agent.

2. Re-run the same prompt, but this time pick the **`microservice-scaffolder`** agent from the chat agent picker, then:
   ```
   /add-notifications-service
   ```
3. Then `/review-feature`.

**Talking points:**
- Eureka files are copied verbatim (the agent is told to never rewrite them).
- Health endpoint shape matches siblings.
- Dockerfile is multi-stage.
- `docker-compose.yml` block has the correct healthcheck and `depends_on`.
- Zod validation appears.

Reset before Stage 3.

---

## Stage 3 — Run the Evaluations extension

**Goal:** show that customizations themselves can be linted/scored.

1. Open [.github/agents/microservice-scaffolder.agent.md](.github/agents/microservice-scaffolder.agent.md).
2. Command palette → **Chat Customizations: Evaluate Active File** (or click the diagnostic gutter).
3. Repeat for [.github/copilot-instructions.md](.github/copilot-instructions.md) and the prompt files in [.github/prompts/](.github/prompts/).
4. Talk through the diagnostics: missing description keywords, applyTo patterns, ambiguous tool lists, etc.
5. Optional: invoke the **`fix-customization-evaluation-diagnostics`** skill on the active file to auto-apply the suggestions.

**Talking points:**
- Customizations are code — they need review and CI too.
- The eval extension catches the silent-failure traps (bad YAML, weak descriptions, over-broad `applyTo`).

---

## Stage 4 — Add skills with bundled assets

**Goal:** show how skills package *deterministic templates*, not just guidance.

1. Restore the skills:
   ```bash
   mv .demo-stash/skills .github/
   ```
   Skills now in play:
   - [.github/skills/eureka-microservice/SKILL.md](.github/skills/eureka-microservice/SKILL.md) + templates in `assets/`.
   - [.github/skills/test-conventions/SKILL.md](.github/skills/test-conventions/SKILL.md) + templates in `assets/`.

2. Re-run **Stage 2** exactly as before (same agent, same prompt). The agent should now discover and invoke the `eureka-microservice` skill, which causes it to literally copy the bundled template files instead of regenerating them.

3. Then ask:
   ```
   Add unit tests for the new notifications-service.
   ```
   The `test-conventions` skill should fire — the agent installs Jest, drops the bundled mock + config, and writes the first test using the template.

**Talking points:**
- Skills bundle *files*, not just words. The mock for Eureka, the Jest config, the Dockerfile — all byte-for-byte deterministic.
- Discovery is driven by the skill's `description` — note the trigger phrases ("new microservice", "add tests", etc.).
- The same prompt now produces the same output every time.

---

## Recap slide

| Stage | Layer added | What got better |
|------:|-------------|-----------------|
| 1 | Prompt only | Saves typing — quality is luck-of-the-draw |
| 2 | `copilot-instructions.md` + custom agent | Conventions enforced, scope tightened |
| 3 | Eval extension | Customizations themselves get reviewed |
| 4 | Skills with assets | Deterministic templates — same output every time |

---

## Cleanup after the demo

```bash
rm -rf .demo-stash notifications-service
git checkout -- docker-compose.yml api-gateway/
```
