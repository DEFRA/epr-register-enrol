# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

### Start the case-management stack (backend + frontend)

Run all commands from the repo root (`epr-register-enrol/`).

```bash
# First time / after a long pause: stop any conflicting Redis from another project
docker stop cdp-uploader-redis-1 2>/dev/null || true

# Start backend + frontend (builds images if not cached)
docker compose up -d case-management-backend case-management-frontend

# Health check — both should return 200 before running tests
curl -s -o /dev/null -w "%{http_code}" http://localhost:8085/health/ready
curl -s -o /dev/null -w "%{http_code}" http://localhost:5001/health
```

| Service | URL |
|---------|-----|
| Frontend (management-fe) | http://localhost:5001 |
| Backend (management-be)  | http://localhost:8085 |

**Note:** `NOTIFY_API_KEY` is optional for local dev — the warning about a blank string is harmless.

### Hot-reload development

```bash
docker compose up --watch
```

- Backend: `dotnet watch` — `.cs`/`.json` edits sync and rebuild in-process; `.csproj`/`.sln` changes rebuild the image.
- Frontend: `nodemon` — edits under `src/` sync and restart the server; `package*.json` / `vite.config.js` changes rebuild the image.

### Stop the stack

```bash
docker compose down          # keep volumes (MongoDB data preserved)
docker compose down -v       # destroy volumes (clean slate)
```

### Known gotcha: port 6379 conflict

If `cdp-uploader-redis-1` (from another project) is already running it will hold port 6379 and prevent `epr-register-enrol-redis-1` from starting, which blocks `case-management-frontend`. Fix:

```bash
docker stop cdp-uploader-redis-1
docker compose up -d case-management-backend case-management-frontend
```

### Known gotcha: floci init script line endings

`lib/epr-register-enrol-management-fe/compose/floci/start.d/10-setup-resources.sh` must have LF line endings (not CRLF). If floci exits immediately on startup with `Hook script failed: ... exited with code 127`, run:

```bash
sed -i 's/\r//' lib/epr-register-enrol-management-fe/compose/floci/start.d/10-setup-resources.sh
```

### Run E2E tests locally (against the running stack)

```bash
cd lib/epr-register-enrol-mgmt-tests
npx wdio run wdio.local.conf.js                                      # all specs
npx wdio run wdio.local.conf.js --spec test/specs/<name>.e2e.js      # single spec
```

Requires the stack to be up (both health endpoints return 200). The Allure report step will error if Java is not installed — this does not affect the test result.

### Run E2E tests via Docker (CI-style)

```bash
docker compose up -d case-management-backend case-management-frontend
docker compose --profile tests run --rm mgmt-tests
```

### Run management-fe unit tests

```bash
cd lib/epr-register-enrol-management-fe
npm test
```

## Architecture Overview

This monorepo coordinates several submodules under `lib/`:

| Submodule | Language | Role |
|-----------|----------|------|
| `epr-register-enrol-management-be` | C# / .NET | Case-management backend API (port 8085) |
| `epr-register-enrol-management-fe` | Node.js / Hapi | Case-management frontend (port 5001) |
| `epr-register-enrol-mgmt-tests` | JS / WebdriverIO | E2E test suite for the management app |
| `epr-register-enrol-backend` | C# / .NET | EPR registration backend (port 8080) |
| `epr-register-enrol-frontend` | Node.js | EPR registration frontend (port 3000) |

Infrastructure (all via Docker Compose):
- **MongoDB** — persistent storage (port 27017)
- **Redis** — session cache (port 6379)
- **Floci** — local AWS emulator (LocalStack-compatible, port 4566)

## Conventions & Patterns

_Add your project-specific conventions here_
