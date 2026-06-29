# Run E2E Tests Locally

Run the frontend e2e journey tests locally, mirroring the CI/CD pipeline exactly.

## Usage

```
/e2e-tests                          # Run all e2e specs
/e2e-tests exporter                 # Run only exporter-accreditation spec
/e2e-tests <spec-name>              # Run a specific spec file
```

## Instructions

Follow these steps in order. Each step depends on the previous one succeeding.

### Paths

- Frontend source: `e:\dev\epr-register-enrol\lib\epr-register-enrol-frontend`
- Fe-tests repo: `E:\dev\epr-register-enrol-fe-tests`
- Backend source: `e:\dev\epr-register-enrol\lib\epr-register-enrol-backend`
- Docker network: `epr-register-enrol-fe-tests_cdp-tenant`

### Step 1 — Check Docker is running

```powershell
docker version --format '{{.Server.Version}}'
```

If Docker is not running, tell the user and stop.

### Step 2 — Stop conflicting containers

Check if ports 3000, 8080, or 4444 are in use by other compose stacks:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

If containers from the `epr-register-enrol` stack (not `fe-tests`) are running, stop them:

```powershell
Set-Location "e:\dev\epr-register-enrol"; docker compose down
```

If `fe-tests` containers are already running and healthy, skip to Step 5 (test runner build). If they're running but unhealthy or stale, tear them down first:

```powershell
Set-Location "E:\dev\epr-register-enrol-fe-tests"; docker compose down -v
```

### Step 3 — Build frontend Docker image

Build from local source so the tests run against your current code:

```powershell
docker build --tag defradigital/epr-register-enrol-frontend:local "e:\dev\epr-register-enrol\lib\epr-register-enrol-frontend"
docker build --tag defradigital/epr-register-enrol-backend:local "e:\dev\epr-register-enrol\lib\epr-register-enrol-backend"
```

### Step 4 — Start the Docker Compose stack

Start all services (MongoDB, Redis, LocalStack/floci, CDP uploader, backend, frontend, Selenium Chrome):

```powershell
Set-Location "E:\dev\epr-register-enrol-fe-tests"; $env:EPR_REGISTER_ENROL_FRONTEND = "local"; $env:EPR_REGISTER_ENROL_BACKEND = "local"; docker compose up --wait --wait-timeout 300 -d
```

Wait for all services to be healthy. Verify:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}"
```

All containers must show `(healthy)` or `Up`. If any container failed, check its logs with `docker compose logs <service-name>` and report the issue.

### Step 5 — Build the test runner image

The test runner must be a Linux container (the `esm-module-alias` loader does not work on Windows). Build from the fe-tests repo's Dockerfile:

```powershell
docker build -t epr-fe-tests "E:\dev\epr-register-enrol-fe-tests"
```

If the image already exists and the fe-tests repo hasn't changed since the last build, you can skip this step. Check with:

```powershell
docker image inspect epr-fe-tests --format '{{.Created}}' 2>$null
```

### Step 6 — Run the tests

Run inside a container on the same Docker network as the compose stack. This mirrors CI exactly — Linux, same network, Selenium Chrome container, real backend.

**All specs:**

```powershell
docker run --rm --network epr-register-enrol-fe-tests_cdp-tenant --entrypoint bash -e CHROMEDRIVER_URL=selenium-chrome -e BASE_URL=http://epr-register-enrol-frontend:3000 epr-fe-tests -c "rm -rf allure-results allure-report && npx wdio run wdio.github.conf.js"
```

**Single spec** (replace `<spec>` with the spec filename or a pattern):

```powershell
docker run --rm --network epr-register-enrol-fe-tests_cdp-tenant --entrypoint bash -e CHROMEDRIVER_URL=selenium-chrome -e BASE_URL=http://epr-register-enrol-frontend:3000 epr-fe-tests -c "rm -rf allure-results allure-report && npx wdio run wdio.github.conf.js --spec test/specs/<spec>"
```

Common spec mappings:
- `exporter` → `test/specs/exporter-accreditation.e2e.js`
- `reprocessor` or `accreditation` → `test/specs/accreditation.e2e.js`
- `regulator` → `test/specs/regulator*.e2e.js`

### Step 7 — Report results

After the test run completes, parse the output for the spec reporter summary. Look for lines containing `✓` (passed) and `✖` (failed), plus the final `Spec Files:` summary line.

**Delegate test failure analysis to Ollama** using `mcp__ollama__ollama_general_task` with `model: "qwen2.5-coder:7b"`:
- Send the test output (spec reporter section only — from `"spec" Reporter:` to end) to Ollama
- Ask it to summarise which tests passed/failed and suggest likely causes for any failures based on the error messages

Report back to the user:
1. Pass/fail count
2. For failures: the error message and line number from the spec file
3. Ollama's analysis of likely causes (if any failures)

### Cleanup

Do NOT automatically tear down the Docker Compose stack after tests. The user may want to re-run tests or debug. If they ask, tear down with:

```powershell
Set-Location "E:\dev\epr-register-enrol-fe-tests"; docker compose down -v
```

Then optionally restart the original dev stack:

```powershell
Set-Location "e:\dev\epr-register-enrol"; docker compose up --wait -d
```
