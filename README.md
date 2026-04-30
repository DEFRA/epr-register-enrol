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
| Case-management frontend | http://localhost:3000 |
| Case-management backend  | http://localhost:8085 |

(See each submodule's own `README.md` for ports and configuration specific to
that service.)

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
