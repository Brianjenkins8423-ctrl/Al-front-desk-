# Front Halo dispatch (AI Office)

**Status: NOT production-ready. No live customer traffic has been, or should yet be, routed through this.**
Dispatch is off by default (`DISPATCH_ENABLED=false`) and, even when on, writes nothing to GoHighLevel
unless `GHL_WRITES_ENABLED=true`.

Run tests: `npm test` (Node >= 22.5, no extra dependencies).
Read-only live GHL check: `node scripts/ghl-live-readcheck.js` (needs `NODE_USE_ENV_PROXY=1` and
`NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` inside the Claude cloud sandbox).

## What exists

| Module | Purpose |
|---|---|
| `dispatch-core.js` | SQLite store: idempotent intake, overlap-safe booking (UTC intervals), tenant-scoped reads/writes, emergency escalation chain, technician assignment + acknowledgment, transactional outbox with backoff/dead-letter/lease recovery, audit `events`. |
| `ghl-client.js` | GHL REST client bound to one location. Timeouts; retries on reads only; **writes disabled by default**; writes never auto-retried. |
| `service.js` | Orchestration: verify live availability → local hold → GHL creates appointment (GHL re-validates slot) → mark synced → stage sync; search-before-create on retry; reconcile against GHL. |
| `routes.js` | `POST /dispatch/ghl/intake`, `POST /dispatch/ghl/ack`, `GET /dispatch/admin/health`. Per-location secret; tenant comes from the secret, never the body. |
| `worker.js` | Runs escalation clock + outbox every 15s, non-overlapping. |
| `ghl-adapter.js` | GHL webhook body → intake; status → "FH MASTER \| Office Requests" stage. |

## Test results (74 automated tests, all passing)

| Area | Evidence |
|---|---|
| Duplicate prevention | Same key twice, 8 concurrent connections, GHL redelivery, key reuse with different data (409), duplicate Twilio `MessageSid`/`CallSid` |
| Appointment conflicts | Overlap, same instant in different offsets, 6 simultaneous requests for one slot → exactly 1 wins and GHL holds 1 appointment; two service instances on one DB; GHL rejecting a slot after our check → hold released |
| Emergency | Immediate page, backup at +5 min, owner at +10 min, ack stops escalation, exhausted chain raises alert, notifier outage → backoff → dead job → alert, worker crash → lease recovery, never auto-booked |
| Failure recovery | Mid-transaction crash rollbacks; GHL timeout; response lost *after* GHL committed (no duplicate appointment); definitive refusal on retry; GHL down → fail closed; stale jobs cannot regress stage |
| Security | Unsigned/forged/tampered/replayed Twilio requests; `/leads` auth; fail-closed when secrets unset; cross-tenant secret isolation; log redaction |
| Sensitivity check | 12 deliberate regressions each caught by at least one test |

**Live GHL read-only check (fronthalo, 2026-10-21): 6/8 pass.**
Pass: write guard, calendar, free-slots (66 slots), events, all 8 pipeline stage ids present, opportunity search.
Fail (token scope, needs you in GHL): custom fields (`locations/customFields.readonly`), users (`users.readonly`).

## What was NOT tested (no way to do it safely from here)

- **Any GHL write** (contact, opportunity, appointment, cancel). fronthalo is the live account (337 contacts) and has no sandbox; creating records can fire workflows that text real people. The write paths are tested only against a local mock (`test/helpers/mock-ghl.js`) that imitates GHL's documented behaviour. **Real GHL write semantics are unverified.**
- Real phone calls, Voice AI, SMS/email to customers or staff.
- Real emergency transfer. Escalation produces notifier jobs; no real notifier exists.
- Load, long-running soak, multi-instance deployment.

## Security audit

Fixed on this branch:
| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | `/leads` returned all customer PII with no auth | Critical | Bearer `ADMIN_API_TOKEN`, timing-safe, fails closed |
| 2 | Twilio webhooks unauthenticated (anyone could trigger SMS sends / AI calls) | Critical | `X-Twilio-Signature` validation against `PUBLIC_BASE_URL`, fails closed |
| 3 | Twilio retries caused duplicate AI replies / duplicate texts | High | `MessageSid`/`CallSid` processed once; failed send releases key |
| 4 | Full phone numbers and message bodies in logs | Medium | Masked |
| 5 | No `.gitignore`: `.env` and `data/` (customer PII) committable | High | Added |
| 6 | Inbound message sent to the model twice; first-message detection always false | Medium | Fixed |
| 7 | Non-atomic JSON writes could corrupt data on crash | Medium | temp file + rename |
| 8 | Cross-client reads by request id | High | Tenant required on every operation; per-location secrets |

Open (not fixed):
- **Production Railway variables are misnamed**: `ILIO_AUTH_TOKEN`, `LIO_PHONE_NUMBER` (should be `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`). Live SMS is probably failing today. Not changed: it is your production config.
- **Merging this branch to `main` auto-deploys it** (Railway tracks `main`). The existing webhooks then return 503 until `PUBLIC_BASE_URL` and `ADMIN_API_TOKEN` are set and the Twilio variables are renamed. That is intentional (fail closed), but plan the cutover.
- No rate limiting / abuse throttling on public endpoints.
- GHL webhook auth is a static bearer secret (TLS-protected, replayable if leaked). No rotation tooling.
- Prompt-injection: SMS text goes to the model and its output is stored as a "lead". Not a dispatch input yet; keep it that way until reviewed.
- Single-replica only. JSON file storage and SQLite are not multi-instance safe.
- Staff/customer notifier unimplemented; alerts only log.

## Remaining blockers before go-live

1. Add GHL token scopes (custom fields, users read; and for writes: contacts, opportunities, calendars/events, conversations/message write), then re-run `scripts/ghl-live-readcheck.js`.
2. **Approve one supervised write test** against a clearly named test contact (after confirming no workflow fires on contact creation), to verify real appointment create/cancel/double-book rejection and opportunity moves.
3. Real notifier (staff paging via SMS/call, with a delivery confirmation) and a customer-confirmation sender gated on `customerStatus === 'confirmed'`.
4. Connect the AI agent (SMS + Voice AI) to `intake`/`verifyAndBook`. Today the SMS agent still only records a lead; **nothing calls dispatch**.
5. Persistent storage: Railway volume at minimum, or PostgreSQL (see below). No volume appears in the service config, so JSON/SQLite data would be lost on redeploy.
6. Technician directory (GHL users → technicians) and reschedule-with-GHL-sync (not implemented; `core.reschedule` is local only).
7. Resolve calendar hours: GHL `free-slots` returned slots to 19:30 though the calendar's configured open hours are 08:00–17:00. Check the calendar's timezone/availability settings before trusting slots for real customers.
8. End-to-end rehearsal (real call → AI → GHL → dispatcher notified → customer confirmation), then a staged pilot.

## PostgreSQL?

Not required for correctness today (BEGIN IMMEDIATE gives serialised writes, tested across connections). It becomes necessary if you run more than one replica, need point-in-time backups, or want database-enforced tenant isolation (row-level security). Decide after confirming the deployment model. If staying on SQLite: mount a Railway volume, single replica, scheduled backups.

## Production readiness assessment

**Not ready.** Engineering of the core is solid and well tested, security of the existing endpoints is now fail-closed, and read access to the real GHL account is verified. But the one transaction that matters (real call → AI → GHL appointment → dispatcher notified → customer told → all systems agree) has **not** been run end to end, GHL writes are unverified against the real API, notification delivery does not exist, and the AI agent is not connected to dispatch.
