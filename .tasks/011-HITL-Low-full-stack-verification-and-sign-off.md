## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

HITL

## Complexity

Low

## What to build

A human-in-the-loop check that RA-527 works end to end, matches the design, and is ready for PRs.

## Acceptance criteria

- [ ] The full mgmt-tests suite runs green against the local compose stack with all repos on `feature/ra-527`. Any failures are triaged, and new tasks are added to `.tasks/` if needed.
- [ ] Manual walkthrough of both outcomes in CM against Figma **Design 3** (page `217:924`): form copy, pending tags and banners, confirm page, final banners, closed and Outcome wording, filter. The operator journey shows no change until step 2.
- [ ] Design or product confirm the extrapolated refusal banner copy ("Application refused…", "…accreditation is refused"), or supply replacements, which are then captured as a follow-up task. (The pending tag wording and colours were decided by the user in task 010: step 1 "Approved" is green like Granted, and step 1 "Refused" reads and looks the same as the final Refused, in red.)
- [ ] A reply on the RA-527 Jira comment asking what the new state is called and its entry/exit rules, pointing to the spec's status model.
- [ ] Every changed repo (parent, management-fe, management-be, mgmt-tests, epr-register-enrol-backend from task 008, plus any other that ended up touched) is on exactly `feature/ra-527`. The parent's submodule pointers reference the final commits. Working trees are clean.
- [ ] A human pushes the branches and opens PRs (the dev container has no push access). The management-fe PR's e2e check picks up the matching management-be and mgmt-tests branches.

## Running the browser suite

The Claude dev container has no Docker access, by design: it isn't given `--privileged` or the Docker socket, because either would let it escape to the host. A human runs the stack on the host, and Claude reads the log from the mounted repo folder.

From `D:\Git\Defra\epr-register-enrol` in PowerShell on the host:

```powershell
docker compose down -v                      # fresh volumes, so new seed fixtures load
docker compose up --build -d                # build and start the stack from the checked-out branches
mkdir .e2e-logs -Force | Out-Null

# Full suite
docker compose --profile tests run --build --rm mgmt-tests 2>&1 | Tee-Object .e2e-logs\full.log

# RA-527 spec only
docker compose --profile tests run --build --rm --entrypoint npx mgmt-tests wdio run wdio.conf.js --spec test/specs/ra-527-two-step-determination.e2e.js 2>&1 | Tee-Object .e2e-logs\ra-527.log
```

Notes:

- **Keep `--build` on the `run` line.** Without it, Compose reuses a stale `mgmt-tests` image built from older test code.
- **Read the test summary, not just the exit code.** The default entrypoint also runs `npm run report:publish` after the tests, which may fail locally even when every test passes. The single-spec command skips it.
- **Logs:** they land in `.e2e-logs\`, which Claude sees as `/epr-register-enrol/.e2e-logs/`, so it can read them and triage failures. Don't commit them.
- **Step 2 retry:** the retry case from task 008 can't be exercised by the browser suite. The operator backend's endpoint tests cover it; see task 009's notes.

## Blocked by

- `.tasks/001-AFK-Low-remove-bespoke-approve-endpoint.md`
- `.tasks/008-AFK-Low-operator-final-status-push-idempotent.md`
- `.tasks/009-AFK-Medium-e2e-two-step-determination-spec.md`
- `.tasks/010-AFK-Low-pending-state-labels-and-colours.md`
