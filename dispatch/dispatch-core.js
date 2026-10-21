// dispatch/dispatch-core.js
// Front Halo dispatch core: tenant-separated service requests, idempotent intake, emergency
// escalation, and conflict-free appointment booking on SQLite (Node's built-in node:sqlite).
//
// Ported from the audited Python prototype (front_halo_ai_office/dispatch_core.py) and kept
// behaviour-identical. NOT wired into server.js: no routes, no GHL calls, no messages sent.
// A "tenant" is a GoHighLevel locationId. Requires Node >= 22.5.

const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const URGENCY_RANK = { routine: 0, priority: 1, emergency: 2 };
const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const DEFAULT_CHAIN = [
  { target: 'dispatcher', afterSec: 0 },
  { target: 'backup', afterSec: 300 },
  { target: 'owner', afterSec: 600 },
];

class DispatchError extends Error {}
class SlotUnavailable extends DispatchError {}
class IdempotencyConflict extends DispatchError {}

function now() {
  return new Date().toISOString();
}

// GHL sends appointment times as ISO-8601 with an offset, e.g. 2026-10-22T09:00:00-04:00.
// Normalised to UTC so overlap checks compare instants, not strings.
function toUtc(value, name) {
  const m = typeof value === 'string' && value.match(ISO_WITH_OFFSET);
  if (!m) throw new DispatchError(`${name} must be an ISO-8601 timestamp with a UTC offset`);
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || '0'].map(Number);
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    throw new DispatchError(`${name} is not a valid calendar date/time`);
  }
  return new Date(value).toISOString();
}

function clean(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new DispatchError(`Missing required field: ${name}`);
  return value.trim();
}

class DispatchCore {
  // escalationChain: ordered human contacts for emergencies, e.g.
  //   [{ target: 'dispatcher', afterSec: 0 }, { target: 'backup', afterSec: 300 }, { target: 'owner', afterSec: 600 }]
  // exhaustAfterSec: how long after the last level is notified, with no acknowledgment, before an
  // "escalation exhausted" alert is raised.
  constructor(file = ':memory:', { escalationChain = DEFAULT_CHAIN, exhaustAfterSec = 600, maxAttempts = 6, clock = now } = {}) {
    this.clock = clock;
    this.chain = escalationChain;
    this.exhaustAfterSec = exhaustAfterSec;
    this.maxAttempts = maxAttempts;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec('PRAGMA busy_timeout=10000');
    this._tx(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, source_key TEXT NOT NULL, fingerprint TEXT NOT NULL, customer TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, service TEXT NOT NULL, urgency TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(tenant,source_key))');
      this.db.exec('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL, created TEXT NOT NULL, FOREIGN KEY(request_id) REFERENCES requests(id))');
      this.db.exec('CREATE TABLE IF NOT EXISTS bookings (tenant TEXT NOT NULL, resource TEXT NOT NULL, start_utc TEXT NOT NULL, end_utc TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, sync_state TEXT NOT NULL DEFAULT \'pending\', external_id TEXT, UNIQUE(tenant,resource,start_utc), FOREIGN KEY(request_id) REFERENCES requests(id))');
      this.db.exec('CREATE TABLE IF NOT EXISTS external_refs (request_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(request_id, kind), FOREIGN KEY(request_id) REFERENCES requests(id))');
      this.db.exec('CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, request_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT \'pending\', attempts INTEGER NOT NULL DEFAULT 0, next_attempt TEXT NOT NULL, lease_until TEXT, last_error TEXT, created TEXT NOT NULL)');
      this.db.exec('CREATE TABLE IF NOT EXISTS assignments (request_id TEXT PRIMARY KEY, tenant TEXT NOT NULL, technician TEXT NOT NULL, status TEXT NOT NULL, ack_deadline TEXT NOT NULL, assigned_at TEXT NOT NULL, acked_at TEXT, FOREIGN KEY(request_id) REFERENCES requests(id))');
      this.db.exec('CREATE TABLE IF NOT EXISTS escalations (request_id TEXT NOT NULL, level INTEGER NOT NULL, target TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending\', notified_at TEXT, PRIMARY KEY(request_id, level), FOREIGN KEY(request_id) REFERENCES requests(id))');
      this.db.exec('CREATE INDEX IF NOT EXISTS bookings_resource ON bookings(tenant,resource,start_utc,end_utc)');
    });
  }

  // BEGIN IMMEDIATE takes the write lock up front, so check-then-write is safe across
  // processes sharing the file. fn must be synchronous.
  _tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  _event(rid, event, detail = '') {
    this.db.prepare('INSERT INTO events(request_id,event,detail,created) VALUES (?,?,?,?)').run(rid, event, detail, this.clock());
  }

  _row(tenant, rid) {
    return this.db.prepare('SELECT status,urgency FROM requests WHERE id=? AND tenant=?').get(rid, tenant);
  }

  _booking(rid) {
    return this.db.prepare('SELECT resource,start_utc,end_utc FROM bookings WHERE request_id=?').get(rid);
  }

  _checkFree(tenant, resource, start, end, rid) {
    const clash = this.db
      .prepare('SELECT request_id FROM bookings WHERE tenant=? AND resource=? AND start_utc<? AND end_utc>? AND request_id<>?')
      .get(tenant, resource, end, start, rid);
    if (clash) throw new SlotUnavailable('Resource already booked for an overlapping time');
  }

  _escalate(rid, reason, at = this.clock()) {
    this.db.prepare("UPDATE requests SET urgency='emergency', status='human_escalation' WHERE id=?").run(rid);
    this._event(rid, 'escalation_required', reason);
    // The notification schedule is written in the same transaction as the escalation itself,
    // so an escalated request can never exist without a durable plan to reach a human.
    const ins = this.db.prepare('INSERT OR IGNORE INTO escalations(request_id,level,target,due_at) VALUES (?,?,?,?)');
    this.chain.forEach((c, i) => ins.run(rid, i, c.target, new Date(Date.parse(at) + c.afterSec * 1000).toISOString()));
  }

  _interval(resource, start, end) {
    resource = clean(resource, 'resource');
    start = toUtc(start, 'start');
    end = toUtc(end, 'end');
    if (end <= start) throw new DispatchError('end must be after start');
    return [resource, start, end];
  }

  // Returns { id, created }. Re-sending the same sourceKey with the same details is a no-op;
  // with different details it throws IdempotencyConflict; with higher urgency it escalates.
  intake({ tenant, sourceKey, customer, phone, address, service, urgency = 'routine' }) {
    tenant = clean(tenant, 'tenant');
    sourceKey = clean(sourceKey, 'sourceKey');
    const fields = [clean(customer, 'customer'), clean(phone, 'phone'), clean(address, 'address'), clean(service, 'service')];
    if (!(urgency in URGENCY_RANK)) throw new DispatchError('Invalid urgency');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');

    return this._tx(() => {
      const existing = this.db.prepare('SELECT id,fingerprint,urgency FROM requests WHERE tenant=? AND source_key=?').get(tenant, sourceKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new IdempotencyConflict('sourceKey already used for a different request');
        if (URGENCY_RANK[urgency] > URGENCY_RANK[existing.urgency]) {
          if (urgency === 'emergency') {
            this._escalate(existing.id, 'Escalated on re-intake; human dispatcher must be contacted');
          } else {
            this.db.prepare('UPDATE requests SET urgency=? WHERE id=?').run(urgency, existing.id);
            this._event(existing.id, 'urgency_raised', urgency);
          }
        }
        return { id: existing.id, created: false };
      }
      const id = crypto.randomUUID();
      const status = urgency === 'emergency' ? 'human_escalation' : 'pending_review';
      this.db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, tenant, sourceKey, fingerprint, ...fields, urgency, status, this.clock());
      this._event(id, 'created', urgency);
      if (urgency === 'emergency') this._escalate(id, 'Human dispatcher must be contacted');
      return { id, created: true };
    });
  }

  escalate(tenant, rid, reason = 'Escalated by operator') {
    return this._tx(() => {
      const row = this._row(tenant, rid);
      if (!row) throw new DispatchError('Request not found for tenant');
      if (row.status === 'human_escalation') return false;
      this._escalate(rid, reason);
      return true;
    });
  }

  // availabilityVerified is a placeholder guard only: production must validate a hold token
  // from the authoritative calendar (GHL free-slots) inside this transaction.
  book(tenant, rid, { resource, start, end, availabilityVerified = false }) {
    if (availabilityVerified !== true) throw new DispatchError('Authoritative availability verification required');
    [resource, start, end] = this._interval(resource, start, end);
    return this._tx(() => {
      const row = this._row(tenant, rid);
      if (!row) throw new DispatchError('Request not found for tenant');
      if (row.urgency === 'emergency') throw new DispatchError('Emergency requires human dispatch');
      if (row.status === 'confirmed') {
        const b = this._booking(rid);
        if (b && b.resource === resource && b.start_utc === start && b.end_utc === end) return false;
        throw new DispatchError('Already booked; use reschedule');
      }
      if (row.status !== 'pending_review') throw new DispatchError('Invalid status');
      this._checkFree(tenant, resource, start, end, rid);
      this.db.prepare('INSERT INTO bookings(tenant,resource,start_utc,end_utc,request_id) VALUES (?,?,?,?,?)').run(tenant, resource, start, end, rid);
      this.db.prepare("UPDATE requests SET status='confirmed' WHERE id=?").run(rid);
      this._event(rid, 'booking_confirmed', JSON.stringify({ resource, start, end }));
      return true;
    });
  }

  reschedule(tenant, rid, { resource, start, end, availabilityVerified = false }) {
    if (availabilityVerified !== true) throw new DispatchError('Authoritative availability verification required');
    [resource, start, end] = this._interval(resource, start, end);
    return this._tx(() => {
      const row = this._row(tenant, rid);
      if (!row || row.status !== 'confirmed') throw new DispatchError('Not a confirmed booking for tenant');
      const b = this._booking(rid);
      if (b && b.resource === resource && b.start_utc === start && b.end_utc === end) return false;
      this._checkFree(tenant, resource, start, end, rid);
      this.db.prepare('UPDATE bookings SET resource=?,start_utc=?,end_utc=? WHERE request_id=?').run(resource, start, end, rid);
      this._event(rid, 'rescheduled', JSON.stringify({ resource, start, end }));
      return true;
    });
  }

  cancel(tenant, rid) {
    return this._tx(() => {
      const row = this._row(tenant, rid);
      if (!row) throw new DispatchError('Not found');
      if (row.status === 'cancelled') return false;
      if (!['pending_review', 'confirmed'].includes(row.status)) throw new DispatchError('Human review required');
      this.db.prepare('DELETE FROM bookings WHERE request_id=?').run(rid);
      this.db.prepare("UPDATE requests SET status='cancelled' WHERE id=?").run(rid);
      this._event(rid, 'cancelled');
      return true;
    });
  }

  // Tenant is mandatory on every read: no cross-client lookups by request id alone.
  state(tenant, rid) {
    const row = this._row(tenant, rid);
    return row ? { status: row.status, urgency: row.urgency } : null;
  }

  booking(tenant, rid) {
    return this.state(tenant, rid) ? this._booking(rid) || null : null;
  }

  events(tenant, rid) {
    return this.db
      .prepare('SELECT e.event,e.detail FROM events e JOIN requests r ON r.id=e.request_id WHERE r.id=? AND r.tenant=? ORDER BY e.id')
      .all(rid, tenant)
      .map((e) => ({ event: e.event, detail: e.detail }));
  }

  // ---- ids of the matching objects in external systems (GHL contact / opportunity) ------------
  setRef(tenant, rid, kind, value) {
    return this._tx(() => {
      if (!this._row(tenant, rid)) throw new DispatchError('Request not found for tenant');
      this.db.prepare('INSERT INTO external_refs VALUES (?,?,?) ON CONFLICT(request_id,kind) DO UPDATE SET value=excluded.value').run(rid, clean(kind, 'kind'), clean(value, 'value'));
    });
  }

  getRef(tenant, rid, kind) {
    if (!this._row(tenant, rid)) return null;
    const r = this.db.prepare('SELECT value FROM external_refs WHERE request_id=? AND kind=?').get(rid, kind);
    return r ? r.value : null;
  }

  // ---- booking <-> external calendar sync -------------------------------------------------
  // A booking is only "synced" once the authoritative calendar (GHL) has confirmed it.
  // Customers must not be told "confirmed" before that.
  markSynced(tenant, rid, externalId) {
    return this._tx(() => {
      if (!this._row(tenant, rid)) throw new DispatchError('Request not found for tenant');
      const r = this.db.prepare("UPDATE bookings SET sync_state='synced', external_id=? WHERE request_id=?").run(externalId, rid);
      if (!r.changes) throw new DispatchError('No booking to mark synced');
      this._event(rid, 'booking_synced', JSON.stringify({ externalId }));
      return true;
    });
  }

  // Undo a local booking that the calendar definitively refused: slot freed, request reopened.
  releaseBooking(tenant, rid, reason) {
    return this._tx(() => {
      const row = this._row(tenant, rid);
      if (!row) throw new DispatchError('Request not found for tenant');
      if (row.status !== 'confirmed') return false;
      this.db.prepare('DELETE FROM bookings WHERE request_id=?').run(rid);
      this.db.prepare("UPDATE requests SET status='pending_review' WHERE id=?").run(rid);
      this._event(rid, 'booking_released', String(reason || ''));
      return true;
    });
  }

  syncState(tenant, rid) {
    const b = this.booking(tenant, rid);
    if (!b) return null;
    return this.db.prepare('SELECT sync_state,external_id FROM bookings WHERE request_id=?').get(rid);
  }

  // ---- transactional outbox: durable retries -----------------------------------------------
  // Jobs are written in the same transaction as the state change that needs them, so a crash
  // cannot lose a notification or an external-system update.
  _enqueue(tenant, rid, type, payload, dedupeKey, at = this.clock()) {
    this.db
      .prepare('INSERT OR IGNORE INTO outbox(tenant,request_id,type,payload,dedupe_key,next_attempt,created) VALUES (?,?,?,?,?,?,?)')
      .run(tenant, rid, type, JSON.stringify(payload), dedupeKey, at, this.clock());
  }

  enqueue(tenant, rid, type, payload, dedupeKey, at) {
    return this._tx(() => this._enqueue(tenant, rid, type, payload, dedupeKey, at));
  }

  // Claims due jobs with a lease. A worker that crashes mid-job loses its lease and the job is
  // picked up again, so handlers must be idempotent.
  claimDue({ at = this.clock(), limit = 10, leaseSec = 60 } = {}) {
    return this._tx(() => {
      const rows = this.db
        .prepare("SELECT * FROM outbox WHERE (status='pending' AND next_attempt<=?) OR (status='running' AND lease_until<=?) ORDER BY id LIMIT ?")
        .all(at, at, limit);
      const lease = new Date(Date.parse(at) + leaseSec * 1000).toISOString();
      for (const r of rows) this.db.prepare("UPDATE outbox SET status='running', lease_until=? WHERE id=?").run(lease, r.id);
      return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
    });
  }

  completeJob(id) {
    this._tx(() => this.db.prepare("UPDATE outbox SET status='done', lease_until=NULL WHERE id=?").run(id));
  }

  // Exponential backoff (30s, 60s, 120s ... capped at 1h). After maxAttempts the job is 'dead',
  // an audit event is written, and an alert job is queued so a human is told.
  failJob(id, error, at = this.clock()) {
    return this._tx(() => {
      const job = this.db.prepare('SELECT * FROM outbox WHERE id=?').get(id);
      const attempts = job.attempts + 1;
      const msg = String(error && error.message ? error.message : error).slice(0, 500);
      if (attempts >= this.maxAttempts) {
        this.db.prepare("UPDATE outbox SET status='dead', attempts=?, last_error=?, lease_until=NULL WHERE id=?").run(attempts, msg, id);
        if (job.request_id) this._event(job.request_id, 'job_dead', JSON.stringify({ type: job.type, error: msg }));
        if (!job.type.startsWith('alert.')) {
          this._enqueue(job.tenant, job.request_id, 'alert.job_dead', { type: job.type, jobId: id, error: msg }, `dead:${id}`, at);
        }
        return 'dead';
      }
      const delay = Math.min(30 * 2 ** (attempts - 1), 3600);
      this.db
        .prepare("UPDATE outbox SET status='pending', attempts=?, last_error=?, lease_until=NULL, next_attempt=? WHERE id=?")
        .run(attempts, msg, new Date(Date.parse(at) + delay * 1000).toISOString(), id);
      return 'retry';
    });
  }

  outboxStats() {
    const out = { pending: 0, running: 0, done: 0, dead: 0 };
    for (const r of this.db.prepare('SELECT status,count(*) n FROM outbox GROUP BY status').all()) out[r.status] = r.n;
    return out;
  }

  // Runs due jobs through handlers[type](job). Never throws: failures are recorded and retried.
  async processOutbox(handlers, opts = {}) {
    const result = { done: 0, retried: 0, dead: 0 };
    for (const job of this.claimDue(opts)) {
      const handler = handlers[job.type];
      try {
        if (!handler) throw new Error(`No handler for job type ${job.type}`);
        await handler(job);
        this.completeJob(job.id);
        result.done++;
      } catch (err) {
        result[this.failJob(job.id, err, opts.at) === 'dead' ? 'dead' : 'retried']++;
      }
    }
    return result;
  }

  // ---- technician assignment + acknowledgment ------------------------------------------------
  assign(tenant, rid, technician, { ackWithinSec = 600, at = this.clock() } = {}) {
    technician = clean(technician, 'technician');
    return this._tx(() => {
      const row = this._row(tenant, rid);
      if (!row) throw new DispatchError('Request not found for tenant');
      if (row.status !== 'confirmed') throw new DispatchError('Only a confirmed appointment can be assigned');
      const sync = this.db.prepare('SELECT sync_state FROM bookings WHERE request_id=?').get(rid);
      if (!sync || sync.sync_state !== 'synced') throw new DispatchError('Appointment is not confirmed in the calendar yet');
      const cur = this.db.prepare('SELECT technician,status FROM assignments WHERE request_id=?').get(rid);
      if (cur && cur.technician === technician && cur.status !== 'timed_out') return false;
      const deadline = new Date(Date.parse(at) + ackWithinSec * 1000).toISOString();
      this.db
        .prepare("INSERT INTO assignments(request_id,tenant,technician,status,ack_deadline,assigned_at) VALUES (?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET technician=excluded.technician,status='assigned',ack_deadline=excluded.ack_deadline,assigned_at=excluded.assigned_at,acked_at=NULL")
        .run(rid, tenant, technician, 'assigned', deadline, at);
      this._event(rid, 'technician_assigned', JSON.stringify({ technician, deadline }));
      this._enqueue(tenant, rid, 'notify.technician', { technician, deadline }, `assign:${rid}:${technician}:${at}`, at);
      return true;
    });
  }

  acknowledgeAssignment(tenant, rid, technician, at = this.clock()) {
    return this._tx(() => {
      if (!this._row(tenant, rid)) throw new DispatchError('Request not found for tenant');
      const a = this.db.prepare('SELECT technician,status FROM assignments WHERE request_id=?').get(rid);
      if (!a || a.technician !== technician) throw new DispatchError('Not assigned to this technician');
      if (a.status === 'acknowledged') return false;
      if (a.status !== 'assigned') throw new DispatchError(`Assignment is ${a.status}; needs human dispatch`);
      this.db.prepare("UPDATE assignments SET status='acknowledged', acked_at=? WHERE request_id=?").run(at, rid);
      this._event(rid, 'assignment_acknowledged', technician);
      return true;
    });
  }

  assignment(tenant, rid) {
    return this._row(tenant, rid) ? this.db.prepare('SELECT technician,status,ack_deadline,acked_at FROM assignments WHERE request_id=?').get(rid) || null : null;
  }

  // ---- escalation clock ------------------------------------------------------------------------
  // Call periodically (e.g. every 30s). Idempotent: each level is notified once; unacknowledged
  // assignments past their deadline escalate to the human chain.
  tick(at = this.clock()) {
    return this._tx(() => {
      const out = { escalated: 0, notified: 0, exhausted: 0 };
      for (const a of this.db.prepare("SELECT request_id,tenant,technician FROM assignments WHERE status='assigned' AND ack_deadline<=?").all(at)) {
        this.db.prepare("UPDATE assignments SET status='timed_out' WHERE request_id=?").run(a.request_id);
        this._event(a.request_id, 'assignment_timeout', a.technician);
        this._escalate(a.request_id, `Technician ${a.technician} did not acknowledge in time`, at);
        out.escalated++;
      }
      const due = this.db
        .prepare("SELECT e.request_id,e.level,e.target,r.tenant FROM escalations e JOIN requests r ON r.id=e.request_id WHERE e.status='pending' AND e.due_at<=? ORDER BY e.request_id,e.level")
        .all(at);
      for (const e of due) {
        this.db.prepare("UPDATE escalations SET status='notified', notified_at=? WHERE request_id=? AND level=?").run(at, e.request_id, e.level);
        this._enqueue(e.tenant, e.request_id, 'notify.escalation', { target: e.target, level: e.level }, `esc:${e.request_id}:${e.level}`, at);
        this._event(e.request_id, 'escalation_notified', JSON.stringify({ target: e.target, level: e.level }));
        out.notified++;
      }
      const stuck = this.db
        .prepare("SELECT r.id,r.tenant FROM requests r WHERE r.status='human_escalation' AND EXISTS (SELECT 1 FROM escalations WHERE request_id=r.id) AND NOT EXISTS (SELECT 1 FROM escalations WHERE request_id=r.id AND status IN ('pending','acked')) AND (SELECT max(notified_at) FROM escalations WHERE request_id=r.id)<=?")
        .all(new Date(Date.parse(at) - this.exhaustAfterSec * 1000).toISOString());
      for (const s of stuck) {
        this._enqueue(s.tenant, s.id, 'alert.escalation_exhausted', {}, `exhausted:${s.id}`, at);
        this._event(s.id, 'escalation_exhausted', 'No human acknowledged the emergency');
        out.exhausted++;
      }
      return out;
    });
  }

  // A human takes ownership: remaining escalation levels are cancelled.
  acknowledgeEscalation(tenant, rid, by, at = this.clock()) {
    by = clean(by, 'by');
    return this._tx(() => {
      if (!this._row(tenant, rid)) throw new DispatchError('Request not found for tenant');
      const already = this.db.prepare("SELECT 1 FROM escalations WHERE request_id=? AND status='acked'").get(rid);
      if (already) return false;
      this.db.prepare("UPDATE escalations SET status='acked' WHERE request_id=? AND status IN ('pending','notified')").run(rid);
      this._event(rid, 'escalation_acknowledged', JSON.stringify({ by, at }));
      return true;
    });
  }

  escalationStatus(tenant, rid) {
    return this._row(tenant, rid) ? this.db.prepare('SELECT level,target,due_at,status FROM escalations WHERE request_id=? ORDER BY level').all(rid) : [];
  }

  close() {
    this.db.close();
  }
}

module.exports = { DispatchCore, DispatchError, SlotUnavailable, IdempotencyConflict, toUtc };
