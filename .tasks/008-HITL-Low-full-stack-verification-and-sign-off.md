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
- [ ] Design or product confirm the extrapolated refusal copy ("Application refused…", "…accreditation is refused") the provisional **"Refusing"** tag wording, and the provisional tag colours ("Approved" light blue, "Refusing" orange), or supply replacements, which are then captured as a follow-up task.
- [ ] A reply on the RA-527 Jira comment asking what the new state is called and its entry/exit rules, pointing to the spec's status model.
- [ ] Every changed repo (parent, management-fe, management-be, mgmt-tests, plus any other that ended up touched) is on exactly `feature/ra-527`. The parent's submodule pointers reference the final commits. Working trees are clean.
- [ ] A human pushes the branches and opens PRs (the dev container has no push access). The management-fe PR's e2e check picks up the matching management-be and mgmt-tests branches.

## Blocked by

- `.tasks/001-AFK-Low-remove-bespoke-approve-endpoint.md`
- `.tasks/007-AFK-Medium-e2e-two-step-determination-spec.md`
