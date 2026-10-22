## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

Low

## What to build

The "Make determination" form shows the Figma Design 3 copy. This meets the ticket's acceptance criterion to replace the loose "Contact the applicant when the determination has been made" instruction.

- H1: "Make determination for this application" → **"Make determination"**
- Notes label: → **"Notes (optional)"**
- Notes hint: → **"The determination will be recorded in the application history (audit log). You need to contact the applicant when the determination has been made."**
- The warning "This determination is final and it cannot be changed.", the Approved/Refused radios, the "Make determination" button and Cancel are unchanged.

Also correct the outdated RA-203 comment in management-fe's decision service. It claims management-be's Decision email reads `decision_notes` from the latest work-item note, but RA-581 removed that personalisation field. Keep posting the note before the decision (it is still the determination's audit note), but make the comment state the current reason.

Repos: management-fe, mgmt-tests.

## Acceptance criteria

- [ ] The decision page renders the new H1, notes label and hint text exactly as above (management-fe route test via `server.inject`). The old "Contact the applicant when the determination has been made" sentence no longer appears on its own.
- [ ] The breadcrumb, page title and other form elements are unchanged apart from the H1.
- [ ] The RA-203 comment in the decision service is corrected. No behaviour change.
- [ ] mgmt-tests: the spec asserting the exact hint text (RA-410 CTA lifecycle) and any H1/label assertions are updated to the new copy.
- [ ] Quality gates pass: management-fe `npm run lint`, `npm run format:check`, `npm test`; mgmt-tests `npm run lint`, `npm run format:check`.
- [ ] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed on its `feature/ra-527`.

## Blocked by

- None — can start immediately.
