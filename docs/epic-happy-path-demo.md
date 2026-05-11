# Epic: Case Management — End-to-End Happy Path Demo

## Summary
Deliver a demoable end-to-end happy path through the EPR Register & Enrol case management system, from operator submission to approved accreditation appearing on the public register and the operator downloading their decision letter.

## Goal
Enable a live walkthrough of the full re-accreditation journey for the wider team, proving the work-item framework, GOV.UK Notify integration and downstream publishing all hang together. This epic is **scoped to the happy path only** — edge cases are explicitly deferred to keep the slice demoable in a short timeframe.

## Background
The case management POC supports work-item creation, task completion and basic transitions, but does not yet implement nation routing, the 12-week SLA timer, GOV.UK Notify integration, accreditation ID generation, downstream publishing or the operator-facing decision letter. The BA's user-journey BPMN defines the target flow; this epic implements every node on its happy path.

## Scope (in)
The epic covers 16 stories across two stacks (.NET 10 backends + Hapi 21 / Nunjucks BFFs):

**Platform / cross-cutting**
- Swagger/OpenAPI UI on the case-management backend
- GOV.UK Notify integration (5 templates: submission confirmation, duly-made, in-assessment, SLA extended, decision)

**Intake**
- Nation routing derived from site-address postcode
- Submission audit-trail entry
- "Create a work item" page in the Mgmt FE (uses existing BE endpoint)

**Duly making**
- Start duly making → confirm duly made transitions, with duly-made email
- Tasks page consolidating tasks, status and notes off the summary page

**Assessment**
- 12-week SLA timer that starts on payment receipt, with automatic unassignment on transition into in-assessment (replaces the "payment made" task)
- Assign assessor (self or colleague)
- SLA extension and manual override

**Determination**
- Approve action that orchestrates clock stop + ID generation + publishing + notification
- Accreditation ID, start date and accreditation-year generation
- Publish to PRN/PERN service
- Publish to public register
- Archive approved cases off the active worklist

**Operator**
- Operator views and downloads the decision letter (PDF)

## Scope (out)
Explicitly deferred to a follow-up epic:
- Reject / Withdraw determinations and their reason capture
- Query loop (raise query, lock down section, free-text email body, pause/resume SLA, close query)
- Risk review and auto-flagging on intake
- Payment reconciliation guard / role-based override
- Richer duly-making payload and operator-side duly-making validations
- Bulk / team-leader assignment workflow
- Split or group work items by material
- Notes and audit-log pagination & filtering
- Appeals, cancellation, refunds
- High-level reporting dashboard
- Worklist search and advanced filtering (only nation-filter is in scope)

## Success criteria
- End-to-end demo can be performed against a deployed environment, starting from "Create a work item" in the Mgmt FE and ending with the operator downloading their decision letter PDF.
- All 16 child stories are merged, tested (unit + integration where appropriate) and deployed to the demo environment.
- GOV.UK Notify sends each of the five happy-path emails using configured templates (or the no-op client logs the intent in environments without an API key).
- A re-accreditation that reaches "Approved" produces an accreditation ID, is published to the PRN/PERN stub and the public-register stub, fires a decision email and is archived from the default worklist view after 7 days.
- The 12-week SLA clock starts on payment-received, is visible on the worklist with on-track / at-risk / breached states, can be extended by a team leader, and stops on approval.

## Affected components
- `lib/epr-register-enrol-management-be` — work-item framework, new endpoints, Notify + publisher integrations, background jobs
- `lib/epr-register-enrol-management-fe` — create-work-item page, tasks page, assignment UI, SLA UI, decision panel
- `lib/epr-register-enrol-backend` — nation resolver, decision-letter PDF endpoint
- `lib/epr-register-enrol-frontend` — operator decision view + PDF download

## Dependencies / assumptions
- A GOV.UK Notify trial account with five templates created (or `NoOpNotifyClient` is acceptable for the demo).
- PRN/PERN and public-register endpoints can be stubbed for the demo (`NoOp*Publisher` implementations are part of the epic).
- No GOV.UK Pay integration is required; payment receipt is triggered manually via the new endpoint (Swagger).
- CDP-style auth headers (`x-cdp-user-id`, `x-cdp-user-roles`) are already propagated end-to-end.

## Reference
Full story breakdown, acceptance criteria and BPMN coverage map: `docs/user-stories.md`.
