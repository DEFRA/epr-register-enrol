# EPR Register & Enrol

Umbrella repository for the EPR Register & Enrol services. The four services
are tracked here as **git submodules** under `lib/`:

| Submodule | Purpose |
| --- | --- |
| [`lib/epr-register-enrol-frontend`](lib/epr-register-enrol-frontend) | Public-facing register & enrol frontend |
| [`lib/epr-register-enrol-backend`](lib/epr-register-enrol-backend) | Public-facing register & enrol backend |
| [`lib/epr-register-enrol-management-fe`](lib/epr-register-enrol-management-fe) | Internal case-management frontend |
| [`lib/epr-register-enrol-management-be`](lib/epr-register-enrol-management-be) | Internal case-management backend |

## Cloning

Clone the repo together with all submodules in one go:

```bash
git clone --recurse-submodules git@github.com:DEFRA/epr-register-enrol.git
cd epr-register-enrol
```

If you have already cloned without `--recurse-submodules`, initialise them:

```bash
git submodule update --init --recursive
```

## Pulling the latest `main` for every submodule

To bring the umbrella repo and every submodule up to date with the latest
`main` from their respective remotes:

```bash
# 1. Update the umbrella repo
git pull --rebase

# 2. Fetch and check out the latest main in every submodule
git submodule foreach 'git fetch origin && git checkout main && git pull --ff-only origin main'

# 3. (Optional) sync the umbrella's pinned submodule SHAs to whatever you just pulled
git submodule update --remote --merge
```

If you only need to sync to the SHAs already pinned in this repo (i.e. you do
**not** want the bleeding edge of each submodule's `main`), run instead:

```bash
git submodule update --init --recursive
```

## Running locally

Set secrets as environment variables:

```bash
cp .env.example .env
```

Edit the .env file, adding secrets as required.

A root [`compose.yml`](compose.yml) brings up all four services plus their
shared dependencies (MongoDB, Redis, and the Floci AWS emulator) on a single
Docker network.

Start the full stack with hot-reload:

```bash
docker compose up --watch
```

With `--watch`:

- **Backend services** run `dotnet watch` inside the container; edits to `.cs`
  / `.json` files are synced and trigger an in-process rebuild. Edits to a
  `.csproj` or `.sln` rebuild the image.
- **Frontend services** run `nodemon` inside the container; edits under `src/`
  are synced and trigger a restart. Edits to `package*.json` or the bundler
  config rebuild the image.

Other useful commands:

```bash
docker compose up --build -d   # plain run (no hot-reload)
docker compose logs -f         # tail logs from all services
docker compose down -v         # stop and remove containers + volumes
```

### Service URLs

| Service | URL |
| --- | --- |
| Case-management frontend        | http://localhost:5001 |
| Case-management backend         | http://localhost:8085 |
| EPR Register & Enrol frontend   | http://localhost:3000 |
| EPR Register & Enrol backend    | http://localhost:8080 |

(See each submodule's own `README.md` for ports and configuration specific to
that service.)

## Running the frontend E2E journey tests locally

The `epr-register-enrol-fe-tests` submodule carries its own Docker Compose
stack and a WebdriverIO suite. Running it the way described here mirrors CI:
Linux containers, the same Selenium Chrome image, and a real backend.

**The test runner must run inside a Linux container.** The suite's
`esm-module-alias` loader does not work on Windows, so running `npx wdio`
directly on a Windows host will fail regardless of how the stack is configured.

### 1. Free the ports

The root stack and the fe-tests stack both bind 3000, 8080 and 4444, so only
one can run at a time. Stop the root stack first:

```bash
docker compose down
```

If a previous fe-tests run left containers up and unhealthy, clear them:

```bash
cd lib/epr-register-enrol-fe-tests && docker compose down -v
```

### 2. Build the service images from local source

So the tests exercise your working copy rather than a published image:

```bash
docker build -t defradigital/epr-register-enrol-frontend:local lib/epr-register-enrol-frontend
docker build -t defradigital/epr-register-enrol-backend:local  lib/epr-register-enrol-backend
```

### 3. Start the test stack

From the fe-tests submodule. This brings up MongoDB, Redis, the Floci AWS
emulator, the CDP uploader, both services and Selenium Chrome:

```bash
cd lib/epr-register-enrol-fe-tests
EPR_REGISTER_ENROL_FRONTEND=local \
EPR_REGISTER_ENROL_BACKEND=local \
docker compose up --wait --wait-timeout 300 -d
```

Every container must reach `Up` or `(healthy)`. Check with `docker ps`, and on
a failure read that service's logs with `docker compose logs <service>`.

### 4. Build the test runner image

```bash
docker build -t epr-fe-tests .
```

Skip this if the image exists and the suite hasn't changed since it was built
(`docker image inspect epr-fe-tests --format '{{.Created}}'`).

### 5. Run the suite

The runner must join the same Docker network as the stack. Compose names it
after the project directory, so it is `epr-register-enrol-fe-tests_cdp-tenant`:

```bash
docker run --rm \
  --network epr-register-enrol-fe-tests_cdp-tenant \
  --entrypoint bash \
  -e CHROMEDRIVER_URL=selenium-chrome \
  -e BASE_URL=http://epr-register-enrol-frontend:3000 \
  epr-fe-tests -c "rm -rf allure-results allure-report && npx wdio run wdio.github.conf.js"
```

Append `--spec test/specs/<name>.e2e.js` to the `wdio run` command to run a
single spec — for example `operator-accreditation` (the reprocessor journey),
`exporter-accreditation`, or `query-resubmit`.

### 6. Tear down

The stack is deliberately left running so you can re-run or debug. When
finished:

```bash
docker compose down -v          # from lib/epr-register-enrol-fe-tests
cd ../.. && docker compose up --wait -d   # restart the root dev stack
```

## Troubleshooting

- **Submodule directory is empty** — run
  `git submodule update --init --recursive`.
- **Submodule shows as "modified" in `git status`** — the checked-out SHA
  differs from the one pinned in this repo. Either commit the new SHA
  (`git add lib/<submodule> && git commit`) or reset it back with
  `git submodule update --init --recursive`.
- **`docker compose up --watch` doesn't pick up changes** — ensure
  `DOTNET_USE_POLLING_FILE_WATCHER=1` is set (already configured for backends)
  and that you are editing files inside the synced paths declared in
  `compose.yml`.
- **E2E tests fail immediately with a module-resolution error** — the suite is
  being run on the host rather than inside a container. The `esm-module-alias`
  loader only works on Linux; use the `docker run` invocation above.
- **E2E stack won't start, ports already allocated** — the root stack is still
  up. Run `docker compose down` at the repo root first; the two stacks both
  bind 3000, 8080 and 4444.
- **E2E tests can't reach the frontend** — the runner isn't on the stack's
  network. It must be started with
  `--network epr-register-enrol-fe-tests_cdp-tenant`, and `BASE_URL` must use
  the container name (`http://epr-register-enrol-frontend:3000`), not
  `localhost`.
