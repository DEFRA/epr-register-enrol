## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

Medium

## What to build

Align the two-step determination with what the old single-step approve and refuse did on `main`, following decisions the user made after reviewing tasks 003–005. The rule is: **step 2 (confirm applicant contact) does what the old single step did**, apart from the differences listed below. Every state change writes an audit entry, consistent with the existing code.

A read-only comparison of `main` against management-be `75e475d` and management-fe `e204fb9` found the gaps fixed here. Its findings, with BEFORE meaning `main` and AFTER meaning those commits:

### 1. Restore the existing-accreditation-number guard at step 1 (management-be)

On `main`, `ReAccreditationApprovalService.ApproveAsync` (around lines 198–236) refused to issue a number for an item that already had a real-format `accreditationId` without being approved. It logged "refusing to re-issue" and returned InvalidTransition "… Manual investigation required." A known legacy-format id was treated as unset. Task 003 dropped this check, so step 1 (`RecordApprovedDeterminationAsync`) now overwrites any existing id.

- Restore it on the step 1 path, before the mint, so nothing is minted or written when it trips. Legacy-format ids are still treated as unset.
- The number is created once at step 1 and **never overwritten** afterwards. Make determination: Approved replayed on `approved-pending-contact` returns 200 with no change and no re-mint (already true). Confirm contact reuses the step 1 number (already true). Pin both with tests.
- This mirrors `main`, where approving an already-approved item that had a number was a no-op.

### 2. Start date and year are set at step 2, not step 1 (management-be + management-fe)

- **Step 1:** mint the number (the mint request still needs the configured accreditation year, `_accreditationConfig.CurrentYear`) and stamp **only** `accreditationId` on the payload. Do **not** stamp `accreditationStartDate` or `accreditationYear`.
- **Step 2:** in the single confirm-contact write, stamp `accreditationYear` (configured current year) and `accreditationStartDate`, using `ComputeAccreditationStartDate` with the step 2 `appliedAt`. The step 2 `accreditation-issued` audit entry reports these values. The Decision email and publishing use them as they did on `main`.
- **Edge case to document, not over-engineer:** if the configured year changes between step 1 and step 2, the number was minted with the old year and the stamped year is the new one. Keep the behaviour simple. Log a warning if you can detect the mismatch cheaply (for example, if the year is visible in the number format). Record what you did in the task notes.
- **management-fe:** while an item is `approved-pending-contact`, show the Accreditation ID (banner and row) but **not** the Accreditation start date or Accreditation year rows. Once Granted, show all three, as before.
- Items in dev/test databases that are already in `approved-pending-contact` with a step 1 start date or year: step 2 overwrites both. No migration is needed.

### 3. Refusal step 2 does not stop the SLA clock (management-be)

The old single-step refuse (generic engine `reject`) wrote only `action-applied`. It did not set payload `slaClock.stoppedAt` and wrote no `sla-clock-stopped` entry. Task 005's `RefuseAsync` does both. **Remove both** from the refusal step 2. Keep `action-applied` (`confirm-contact-rejected`) and `applicant-contacted`. Approval step 2 keeps its SLA stop, because the old approve stopped the clock.

### 4. Push-failure audit: keep, as on `main` (no code change)

When the step 2 push fails, the code appends the red `status-push-failed` "Status failed to send to the Registration & Accreditation service" entry and returns 500, with nothing else changed. `main` did exactly this. **Keep it.** Only the wording changes; see 7. Note: this entry is shown to regulators, not support-only, so correct any comment that says otherwise.

### 5. Run every step 2 refusal check before the push (management-be)

Step 2 currently reads or deserialises the payload, to stop the SLA clock or stamp it, only **after** the push. A corrupt payload therefore returns 409 after the operator journey has already been told. Move that read and validation into the pre-push checks, so every rule that can refuse the write runs before the push. This matches the `ReAccreditationConfirmContactService` doc claim, which should then be true. Approval step 2 now needs the payload to stamp the start date and year, so this applies to both outcomes.

### 6. Replay and 409 rules (changed by the user during this task, 2026-10-22)

> **Changed 2026-10-22, user decision relayed during the task: every CM response code matches `main`.** The same outcome on its own final state goes back to `main`'s 200 idempotent replay. A 200 replay never changes state, so nothing moves back to step 1. The original rule and row are kept below, struck through, so the change is visible.

~~User-confirmed rules. **Same state = 200 no-op; moving to an earlier state or the other outcome = 409.**~~

Rules now: **same outcome on its pending state or its own final state = 200 no-op; the other outcome, withdrawn, or a non-pending state for confirm-contact = 409.**

| Request | Item in | Result |
|---|---|---|
| Make determination: Approved | approved-pending-contact | 200, no change |
| Make determination: Refused | rejected-pending-contact | 200, no change |
| Confirm applicant contact | approved (Granted) | 200, no change |
| Confirm applicant contact | rejected (Refused) | 200, no change |
| ~~Make determination: Approved or Refused~~ | ~~approved / rejected~~ | ~~409 (would move back to step 1)~~ |
| Make determination: Approved | approved (Granted) | 200, no change (as on `main`; item stays Granted) |
| Make determination: Refused | rejected (Refused) | 200, no change (as on `main`; item stays Refused) |
| Make determination: the other outcome | approved / rejected | 409 (as on `main`) |
| Make determination: either outcome | withdrawn | 409 |
| Make determination: the other outcome | either pending state | 409 |
| Confirm applicant contact | awaiting-decision or earlier | 409 |

Pending states may move only forward to their terminal state. There is no query, withdraw or back-transition. Make sure tests cover each row (most already exist).

### 7. Documentation and cleanups

- Spec `.tasks/spec-ra-527-two-step-determination.md`:
  - **Story 36 and the step 2 "On failure … nothing written" line:** say no state, SLA, outcome audit, publishing or email changes, but the existing `status-push-failed` entry is written (as on `main`). The regulator retries by confirming again.
  - **The "any terminal state gives 409 (as today)" line:** replace it with the rules in 6. ~~Note the deliberate change from `main`, where the same outcome on a terminal state returned 200.~~ (Superseded 2026-10-22: the rules now match `main`; the line reads "same outcome on its own final state → 200 no-op (as on main); other outcome → 409".)
  - **Step 1 stamping line (around 115) and story 13:** step 1 stamps only the accreditation ID. The start date and year are stamped at step 2 and shown only once Granted.
  - **Refusal SLA lines (around lines 18, 127 and story 40):** refusals do not stop the SLA clock, matching `main`.
  - **Retry-safety line (around 129) and story 37:** state the known gap. If the push is delivered but the CM write fails, a retry sends a new `OccurredAt`, the operator journey answers 409, and the item needs manual intervention. This also happened on `main`. A follow-up is tracked separately.
- Amend the acceptance-criteria wording in `.tasks/done/004-*.md` and `.tasks/done/005-*.md` about push failure, from "audit unchanged" / "nothing written" to "no state or outcome changes; `status-push-failed` written". Add a short dated note pointing to this task.
- Fix the stale `ReAccreditationDecisionPush.cs` doc comment (lines 10–12) that says the log-decision service pushes for "a refusal, still single step".
- Correct the `ReAccreditationConfirmContactService` doc's retry-safety claim, which says the operator journey drops duplicates via its watermark, to describe the known gap.
- Fix management-fe `decision/duly-made.route.test.js` around line 193, which still says the operator's decision email reads the latest note (story 50; RA-581 removed that).

Repos: management-be, management-fe, mgmt-tests (update page objects or specs that assert step 1 start date or year rows, or a refusal `sla-clock-stopped` entry).

## Acceptance criteria

- [x] Step 1 Approved, on an item with a real-format `accreditationId` that is not approved → 409 "Manual investigation required". Nothing is minted or written. A legacy-format id is treated as unset.
- [x] The number is minted once at step 1. Step 1 replays and step 2 never re-mint or overwrite it.
- [x] Step 1 stamps only `accreditationId`. Step 2 stamps `accreditationYear` and `accreditationStartDate` (from step 2's `appliedAt`), and `accreditation-issued` reports them.
- [x] management-fe: pending-contact approval shows the Accreditation ID but no start date or year rows. Granted shows all three.
- [x] Refusal step 2: no `slaClock.stoppedAt` and no `sla-clock-stopped` entry. `action-applied` and `applicant-contacted` are still written.
- [x] Step 2 push failure → 500, `status-push-failed` written, nothing else changed (both outcomes).
- [x] Every step 2 refusal check, including payload readability, runs before the push. A corrupt payload → 409 with no push sent.
- [x] The replay/409 table in 6 is covered by tests.
- [x] Spec, done-task AC wording and the stale comments/test text in 7 are updated.
- [x] Quality gates: management-be format check and full test suite; management-fe lint, format check and tests; mgmt-tests lint and format check.
- [x] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed. Nothing pushed.

## Blocked by

- `.tasks/005-AFK-Medium-refuse-two-step.md`

## Notes

- Done.
- **Item 1, existing-number guard (management-be).**
  - New `ReAccreditationAccreditationNumber` holds the number format (moved out of the confirm-contact guard) and `RefuseIfAlreadyIssued`.
  - `RefuseIfAlreadyIssued` is `main`'s logic, restored exactly. An id of 16 characters that is not the real format is the known legacy shape: it is treated as unset and logged. Any other non-empty id, real-format or unrecognised, is refused: 409 InvalidTransition "… Manual investigation required", with a warning log "refusing to re-issue".
  - The log-decision service runs the guard before the mint and the submit-for-decision hop, so nothing is minted or written. `RecordApprovedDeterminationAsync` re-runs it on every attempt.
  - Refusals mint nothing, so they are not blocked.
  - The step 1 replay and step 2 still never re-mint or overwrite the number (pinned by tests).
- **Item 2, start date and year at step 2.**
  - Step 1 stamps only `accreditationId`. The mint still uses `CurrentYear`.
  - `ApproveAsync` stamps three things in its single write: the SLA stop, `accreditationYear` (the configured year) and `accreditationStartDate` (`ComputeAccreditationStartDate` with step 2's `appliedAt`). It overwrites any start date or year stamped at step 1 by an earlier build. `accreditation-issued` reports these values.
  - management-fe: `buildDecisionMetadata` returns `showIssuedDetails` (false for `approved-pending-contact`), and `detail-v1.njk` renders the start date and year rows only when it is true. This hides step-1-stamped values too.
  - No `templateVersion` bump. The change only affects the unreleased v17 pending state, and Granted renders exactly as before. This is noted in the template.
- **Year-mismatch edge case.** Kept simple: the approval still lands with the configured year.
  - The number's `yy` segment (`{Year % 100:D2}`, confirmed in the operator backend's `RegulatoryNumberGenerator`) is read as 20yy. If it differs from the configured year at step 2, a warning is logged after the write: `WarnOnYearMismatch`, which logs the work item, both years and the number.
  - There is no refusal and no re-mint.
- **Item 3, refusal SLA.** `RefuseAsync` no longer touches the payload. It writes no `slaClock.stoppedAt` and no `sla-clock-stopped` entry, only `action-applied` and `applicant-contacted`. `WriteStep.StopsSlaClock` and `TryStopSlaClock` are removed. The approval still stops the clock.
- **Item 4, push-failure audit.** No code change. The comments now say `status-push-failed` is regulator-visible, as on `main`.
- **Item 5, pre-push checks.** `ReAccreditationConfirmContactGuard.Check` now also refuses an unreadable payload, using the shared `ReAccreditationDecisionWrites.TryReadPayload`, for both outcomes. The check runs before the push, so a corrupt payload returns 409 with no push and no `status-push-failed` entry. The writes re-run the guard on every attempt.
- **Item 6, changed by the user mid-task.** Every CM response code now matches `main`:
  - Approved on `approved` and Refused on `rejected` are a 200 idempotent replay. The response carries the replay header, and nothing changes: no mint, push, write or email, and the item stays final.
  - The other outcome on a final item, or either outcome on withdrawn, is still 409.
  - These changes are in three places: the log-decision service and both step 1 `ValidateStepOneTarget`s.
  - Tests:
    - Endpoint: `Decision_with_the_same_outcome_on_a_final_application_is_an_idempotent_replay`, and the theory `Decision_with_the_other_outcome_on_a_closed_application_is_refused`.
    - Service theories for the log-decision, approval and refusal services.
  - The table above shows the change, with the original row struck through.
  - Dated notes were added to done tasks 003 and 005.
- **Item 7, docs.**
  - The spec was updated: the summary, stories 13/36/37/40, step 1 stamping, the replay line, the step 2 failure, write and retry-safety lines, and the testing-decisions push-failure wording.
  - Done tasks 004 and 005: the AC wording was amended and dated notes were added. Done task 003 also got a dated note.
  - Fixed: the `ReAccreditationDecisionPush` doc, the `ReAccreditationConfirmContactService` doc (run order, the push failure being regulator-visible, the known retry gap) and its "safely retried" log message.
  - Fixed: the management-be `docs/work-items.md` paragraph, and the management-fe `duly-made.route.test.js` note comment (RA-581).
- **mgmt-tests.** No existing spec asserted step 1 start date or year rows, or a refusal `sla-clock-stopped` entry. Added:
  - Page-object helpers `getAccreditationIdRow` and `decisionMetadataRowKeys`.
  - ra-527 step 1: only the "Accreditation ID" row shows.
  - re-accreditation-approval: one row after step 1, all three after step 2.
  - reject-terminal-flow: "Applicant contacted" is written, with no `sla-clock-stopped` entry.
  - These were linted and format-checked only, because the browser run needs the full stack (task 009).
- **Review-driven tidy-ups.** The duplicated payload deserialise was folded into `TryReadPayload`, the `AccreditationIdKey` alias was dropped, and unused usings were removed.
- **Left as is (judgement).** The replay/terminal state checks are still written out in three services, as before this task.
- **Quality gates.**
  - management-be: `dotnet format style --verify-no-changes` and the full `dotnet test` (2397 tests, 0 failed).
  - management-fe: lint, format:check and test.
  - mgmt-tests: lint and format:check.
- **Known gap, unchanged and tracked separately.** If a push is delivered and the CM write then fails, a retry gets 409 from the operator journey. A separate follow-up will make the operator backend's status endpoint return 200 for a push asking for the final status the application already has. `epr-register-enrol-backend` was not touched.
