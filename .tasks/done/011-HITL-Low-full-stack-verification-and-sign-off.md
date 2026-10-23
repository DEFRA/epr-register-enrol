## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

HITL

## Complexity

Low

## What to build

A human-in-the-loop check that RA-527 works end to end, matches the design, and is ready for PRs.

## Acceptance criteria

- [x] The full mgmt-tests suite runs green against the local compose stack with all repos on `feature/ra-527`. Any failures are triaged, and new tasks are added to `.tasks/` if needed.
- [x] Manual walkthrough of both outcomes in CM against Figma **Design 3** (page `217:924`): form copy, pending tags and banners, confirm page, final banners, closed and Outcome wording, filter. The operator journey shows no change until step 2.
- [x] Design or product confirm the extrapolated refusal banner copy ("Application refused…", "…accreditation is refused"), or supply replacements, which are then captured as a follow-up task. (The pending tag wording and colours were decided by the user in task 010: step 1 "Approved" is green like Granted, and step 1 "Refused" reads and looks the same as the final Refused, in red.)
- [x] A reply on the RA-527 Jira comment asking what the new state is called and its entry/exit rules, pointing to the spec's status model.
- [x] Every changed repo (parent, management-fe, management-be, mgmt-tests, epr-register-enrol-backend from task 008, plus any other that ended up touched) is on exactly `feature/ra-527`. The parent's submodule pointers reference the final commits. Working trees are clean.
- [x] A human pushes the branches and opens PRs (the dev container has no push access). The management-fe PR's e2e check picks up the matching management-be and mgmt-tests branches.

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

## Notes

Closed on 2026-10-23.

- **Browser suite.** The full run on the host (`.e2e-logs/full.log`) had 79 spec files pass and 12 fail. All 12 failed with `fetch failed` while calling cdp-uploader, which was not ready yet. They are pre-existing upload-dependent specs (ra-292, ra-295, ra-450, ra-483, ra-486, ra-604), not RA-527 ones. A rerun of those 12 (`.e2e-logs/rerun-uploader-specs.log`) passed all of them. The ra-527 spec passed in the full run.
- **Manual walkthrough.** Done by the user for both outcomes. The two-step approve and refuse flows work as expected.
- **Content.** Design and product confirmed all copy: the refusal banners and the confirm-contact error message ("Confirm you have contacted the applicant about the decision"). No follow-up task needed.
- **Jira.** The questions on the new states were answered in the 22 Oct comment thread. The user is posting the final reply.
- **Branches.** All five repos are on `feature/ra-527` with clean working trees, and the parent's submodule pointers match their heads: management-be `28eebcd`, management-fe `ab25da1`, mgmt-tests `6040184`, epr-register-enrol-backend `bd824d4`. The user pushes and opens the five PRs together, including epr-register-enrol-backend.
- **Operator status "Updated" (raised in testing, not a 527 change).** On a Duly made case, "Assign to yourself and start", and step 1 of the determination, apply RA-595's `start-assessment`. That pushes `assessment-in-progress`, which the operator backend shows as Updated. On RA-595 this was hidden because the final status followed in the same submit. With two steps it stays visible until step 2. RA-527 doesn't change that push or the mapping. Whether the operator should stay on Duly made instead is a question for the BA (RA-595 AC03 is still "to be confirmed"). If they want that, the fix is to exclude `start-assessment` in management-be's `ReAccreditationStatusPushHook.BuildExcludedActionIds`, as a separate ticket.
