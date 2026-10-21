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
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec('PRAGMA busy_timeout=10000');
    this._tx(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, source_key TEXT NOT NULL, fingerprint TEXT NOT NULL, customer TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, service TEXT NOT NULL, urgency TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(tenant,source_key))');
      this.db.exec('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL, created TEXT NOT NULL, FOREIGN KEY(request_id) REFERENCES requests(id))');
      this.db.exec('CREATE TABLE IF NOT EXISTS bookings (tenant TEXT NOT NULL, resource TEXT NOT NULL, start_utc TEXT NOT NULL, end_utc TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, UNIQUE(tenant,resource,start_utc), FOREIGN KEY(request_id) REFERENCES requests(id))');
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
    this.db.prepare('INSERT INTO events(request_id,event,detail,created) VALUES (?,?,?,?)').run(rid, event, detail, now());
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

  _escalate(rid, reason) {
    this.db.prepare("UPDATE requests SET urgency='emergency', status='human_escalation' WHERE id=?").run(rid);
    this._event(rid, 'escalation_required', reason);
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
      this.db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, tenant, sourceKey, fingerprint, ...fields, urgency, status, now());
      this._event(id, 'created', urgency);
      if (urgency === 'emergency') this._event(id, 'escalation_required', 'Human dispatcher must be contacted');
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
      this.db.prepare('INSERT INTO bookings VALUES (?,?,?,?,?)').run(tenant, resource, start, end, rid);
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

  close() {
    this.db.close();
  }
}

module.exports = { DispatchCore, DispatchError, SlotUnavailable, IdempotencyConflict, toUtc };
