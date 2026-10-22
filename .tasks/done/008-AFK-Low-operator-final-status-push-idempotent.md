## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

Low

## What to build

Make the operator backend's case-management status push idempotent for a repeated **final** status, so a CM retry at step 2 (confirm applicant contact) can't get permanently stuck.

**Problem.** CM's step 2 pushes the final status (`approved` or `rejected`) to the operator backend, then writes CM. If the push is delivered but the CM write fails, or the reply is lost (for example a timeout), the regulator retries. The retry carries a new `OccurredAt`, so the ordering watermark doesn't treat it as a duplicate. It then reaches the terminal-status guard in `StatusChangedFromCaseManagement` (`EprRegisterEnrolBackend/AccreditationApplication/Endpoints/AccreditationApplicationEndpoints.cs`, around lines 3300–3345). That guard returns **409 even when the push asks for the status the application already has**. CM treats the 409 as a failure, so every retry fails and the item needs manual repair. Two regulators confirming at the same moment hit the same path. The same gap existed on `main` with the old single-step decision.

**User decision (scope is deliberately narrow).** This is the **only** 200/409 behaviour change in this repo:

- `POST case-management/{workItemId}/status` whose `ToStateId` maps to the **same** terminal `ApplicationStatus` the application already has (Approved → Approved, Rejected → Rejected) → **200**, with no change to `ApplicationStatus`, and the application returned as the existing duplicate path does. Log it at Information level as an idempotent repeat of a final status.
- Decide whether the watermark (`CaseManagementStatusUpdatedAt`) should advance on this repeat, and record the decision in the task notes. Recommendation: do **not** advance it. Treat it like the existing duplicate path, with no write.
- **Everything else is unchanged from `main`:** a different terminal status (Approved → Rejected, and so on) → 409; any mapped push to a Withdrawn application → 409; the ordering guard (`OccurredAt <= lastUpdated` → 200 no-op) runs first, as now; the approve/reject legality check and unmapped-state behaviour are untouched; the accreditation-number endpoint keeps its 409 on terminal applications.

**CM side.** No CM code change should be needed. Once the push returns 200, the CM retry carries on and makes its single write. Confirm by reading `HttpOperatorBackendPushAdapter` in management-be that a 200 is treated as delivered. Update the spec's retry-safety line and story 37 (and the `ReAccreditationConfirmContactService` doc, if task 007 described the gap there) to say the gap is now closed by this change.

Repos: **epr-register-enrol-backend** (currently on `main`; create `feature/ra-527` from its current `main`), and the parent repo for the submodule pointer and spec. management-be only if a doc comment needs updating.

## Acceptance criteria

- [x] Operator backend endpoint tests: an Approved application receiving a push to `approved` with a newer `OccurredAt` → 200, status still Approved, nothing written. The same for Rejected → `rejected`.
- [x] Tests confirm these are unchanged: Approved receiving `rejected` → 409; Rejected receiving `approved` → 409; Withdrawn receiving any mapped push → 409; an older or equal `OccurredAt` → 200 no-op; the accreditation-number endpoint on a terminal application → 409.
- [x] The operator backend's own quality gates pass (its format/lint check and full test suite). Find its commands in its README or CI config.
- [x] The spec's retry-safety line and story 37 are updated.
- [x] Commits on `feature/ra-527` in epr-register-enrol-backend and the parent (submodule pointer bumped). Nothing pushed. Task 010 (sign-off) must check that this repo's PR is raised alongside the others.

## Blocked by

- `.tasks/007-AFK-Medium-step2-parity-with-single-step.md`

## Notes

Done.

- epr-register-enrol-backend (`feature/ra-527`, created from `main`): `StatusChangedFromCaseManagement` now returns 200 with the stored application, and writes nothing, when the mapped status equals the terminal status the application already has (Approved → `approved`, Rejected → `rejected`). It logs this at Information level as an idempotent repeat of a final status. The terminal guard moved into a `GuardTerminalStatus` helper, so the method's cognitive complexity (S3776) does not grow.
- **Watermark decision:** `CaseManagementStatusUpdatedAt` does **not** advance on the repeat. It is treated like the ordering guard's duplicate path, with no write at all. The test also sets `FailNextUpdate`, so any write attempt would show up as a 500.
- Unchanged and covered by tests: Approved receiving `rejected` and Rejected receiving `approved` → 409; Withdrawn receiving `approved`, `rejected`, `duly-made` or `submitted` → 409; an equal or older `OccurredAt` on a terminal application → 200 no-op; the accreditation-number endpoint on a terminal application → 409 (existing test). The existing `ApproveFromIllegalStatus_Returns409` theory loses its Approved case, which is now the 200 repeat.
- management-be: confirmed that `HttpOperatorBackendPushAdapter` treats any 2xx as delivered. Only the doc comments in `ReAccreditationConfirmContactService` changed. The warning log text written when the write fails after a push ("a retry is likely to be refused by the operator journey…") is a runtime string, so it was left unchanged and is now overly pessimistic. Reword it in a follow-up if wanted.
  - 2026-10-22: follow-up done. management-be `07eb411` rewords the warning to say a retry should complete the confirmation.
- Spec: updated story 37, the retry-safety line, the "Unchanged" OJ backend line and the Out of Scope line.
- Quality gates: backend `dotnet format style --verify-no-changes` and the full `dotnet test` (1680 passed). management-be builds and passes `dotnet format style --verify-no-changes` (comments only). `dotnet format whitespace` shows only pre-existing final-newline and charset findings across the repo; it is not a CI gate.
- No browser e2e here: the change is backend-only and is covered by the backend's full-`WebApplication` endpoint tests. The mgmt-tests full-stack spec is task 009.
- Task 010 must raise this repo's PR alongside the others.
