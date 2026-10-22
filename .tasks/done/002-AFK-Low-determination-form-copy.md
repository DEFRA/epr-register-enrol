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

- [x] The decision page renders the new H1, notes label and hint text exactly as above (management-fe route test via `server.inject`). The old "Contact the applicant when the determination has been made" sentence no longer appears on its own.
- [x] The breadcrumb, page title and other form elements are unchanged apart from the H1.
- [x] The RA-203 comment in the decision service is corrected. No behaviour change.
- [x] mgmt-tests: the spec asserting the exact hint text (RA-410 CTA lifecycle) and any H1/label assertions are updated to the new copy.
- [x] Quality gates pass: management-fe `npm run lint`, `npm run format:check`, `npm test`; mgmt-tests `npm run lint`, `npm run format:check`.
- [x] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed on its `feature/ra-527`.

## Blocked by

- None — can start immediately.

## Notes

- Done. H1 split from `<title>` via a new `PAGE_HEADING` constant in the decision controller, so the page title ("Make determination for this application") and the breadcrumb are unchanged.
- The stale RA-203 "reaches the operator's email" comments were corrected in the service, the template and the service/controller tests. The note is still posted before the decision, as the determination's audit note.
- Route test: `management-fe/src/server/work-items/re-accreditation/decision/form-copy.route.test.js`.
- mgmt-tests: `ra-410-cta-lifecycle.e2e.js` now asserts the H1, label and hint, using new `DecisionPage.headingText()` and `noteLabelText()` helpers. Lint and format pass. The browser spec was not run because it needs the full stack (task 008).
