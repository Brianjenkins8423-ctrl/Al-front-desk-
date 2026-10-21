# Dispatch core (Front Halo AI Office)

Audited and ported from the "Front Halo Dispatch Prototype" (Python) on 2026-10-21.

**Status: library only. Not wired into `server.js`, no HTTP routes, no GoHighLevel API calls,
no SMS/voice. It cannot receive or send live traffic.**

Run the tests: `npm test` (Node >= 22.5; uses built-in `node:sqlite`, no new dependencies).

## What it does (verified by tests)

| Area | Behaviour |
|---|---|
| Duplicate prevention | `(tenant, sourceKey)` is unique. Same key + same details returns the existing request. Same key + different details throws `IdempotencyConflict`. Safe under concurrent retries from separate DB connections. |
| Appointment conflicts | Bookings are time windows (`start`/`end`, ISO-8601 with offset, as GHL sends them), normalised to UTC. Any overlap for the same tenant + resource throws `SlotUnavailable`. Back-to-back is allowed. Naive, inverted, free-text and impossible dates are rejected. |
| Emergency escalation | `urgency: 'emergency'` goes to `human_escalation` and can never be auto-booked, auto-cancelled or rescheduled. A retry that raises urgency to emergency escalates the existing request. Urgency is never downgraded. `escalate()` exists for mid-conversation escalation. |
| Client data isolation | Every read and write requires the tenant (GHL `locationId`). Another tenant's request id returns nothing. |
| Failure recovery | Every write is one `BEGIN IMMEDIATE` transaction. A crash mid-write rolls back fully, and a retry succeeds. |

## GoHighLevel mapping (`ghl-adapter.js`, `config/ghl-dispatch.json`)

Tenant = GHL `locationId`. Status → stage in **FH MASTER | Office Requests** (ids read from the
live account):

| Core status | GHL stage |
|---|---|
| `pending_review` | 01 New request |
| `human_escalation` | 02 Human review needed |
| `confirmed` | 03 Appointment confirmed |
| `cancelled` | 07 Closed / resolved |
| `IdempotencyConflict` | 08 Exception / reconcile |

`intakeFromWorkflowWebhook(body, authenticatedLocationId)` reads a GHL workflow Webhook body.
The workflow must add Custom Data `request_key` (stable across retries), `service`, and
optionally `urgency`. The location must come from the verified credential, not the body.

## Not implemented (do not go live until these exist)

- HTTP endpoint + authentication for GHL webhooks (GHL workflow webhooks are unsigned: needs a
  per-location shared secret).
- Real availability: `availabilityVerified: true` is a placeholder. It must be replaced by a
  check against the GHL calendar (free-slots / hold) inside the booking transaction.
- Writing to GHL: creating/moving opportunities, creating appointments, tagging contacts.
- Storing the GHL `contactId` / opportunity id against a request.
- Human emergency transfer, paging, telephony, notifications, retries/queue, monitoring.
- Stages 04–06 (dispatch pending / acknowledged / work completed): there are no core states for them.
- Encryption at rest, retention/deletion, audit access controls. Use Postgres + row-level
  security for production.
