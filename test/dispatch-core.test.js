const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { DispatchCore, DispatchError, SlotUnavailable, IdempotencyConflict } = require('../dispatch/dispatch-core');

const S1 = { start: '2026-10-22T09:00:00-04:00', end: '2026-10-22T11:00:00-04:00' };
const S2 = { start: '2026-10-22T13:00:00-04:00', end: '2026-10-22T15:00:00-04:00' };
const slot = (s, resource = 'tech') => ({ resource, ...s, availabilityVerified: true });

function make(d, sourceKey = 'a', tenant = 't', urgency = 'routine') {
  return d.intake({ tenant, sourceKey, customer: 'Jane', phone: '5551231234', address: '123 Main St', service: 'plumbing', urgency });
}

function tmpDb() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-')), 'test.db');
}

function crashOnEvent(d, fn) {
  const real = d._event;
  d._event = () => {
    throw new Error('simulated crash');
  };
  try {
    assert.throws(fn, /simulated crash/);
  } finally {
    d._event = real;
  }
}

function runWorkers(n, data) {
  const code = `
    const { workerData, parentPort } = require('worker_threads');
    const { DispatchCore } = require(${JSON.stringify(path.join(__dirname, '../dispatch/dispatch-core'))});
    const d = new DispatchCore(workerData.file);
    const view = new Int32Array(workerData.gate);
    Atomics.add(view, 0, 1);
    while (Atomics.load(view, 0) < workerData.n) {}
    try {
      const out = workerData.op === 'intake'
        ? d.intake({ tenant: 't', sourceKey: 'dup', customer: 'Jane', phone: '5551231234', address: '123 Main St', service: 'plumbing' })
        : d.book('t', workerData.rid, { resource: 'tech', start: workerData.start, end: '2026-10-22T10:30:00-04:00', availabilityVerified: true });
      parentPort.postMessage({ ok: out });
    } catch (e) {
      parentPort.postMessage({ err: e.constructor.name, msg: e.message });
    }
    d.close();`;
  const gate = new SharedArrayBuffer(4);
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      new Promise((resolve, reject) => {
        const w = new Worker(code, { eval: true, workerData: { ...data(i), gate, n } });
        w.once('message', resolve);
        w.once('error', reject);
      })
    )
  );
}

// --- original prototype tests, ported ---
test('idempotency', () => {
  const d = new DispatchCore();
  const a = make(d), b = make(d);
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(b.created, false);
});

test('tenant isolation on book', () => {
  const d = new DispatchCore();
  assert.throws(() => d.book('other', make(d).id, slot(S1)), DispatchError);
});

test('no unverified booking', () => {
  const d = new DispatchCore();
  assert.throws(() => d.book('t', make(d).id, { resource: 'tech', ...S1 }), /verification required/);
});

test('double booking rejected', () => {
  const d = new DispatchCore();
  const a = make(d).id, b = make(d, 'b').id;
  d.book('t', a, slot(S1));
  assert.throws(() => d.book('t', b, slot(S1)), SlotUnavailable);
});

test('repeat booking is idempotent', () => {
  const d = new DispatchCore();
  const a = make(d).id;
  assert.strictEqual(d.book('t', a, slot(S1)), true);
  assert.strictEqual(d.book('t', a, slot(S1)), false);
});

test('emergency goes to human escalation and cannot be auto-booked', () => {
  const d = new DispatchCore();
  const a = make(d, 'a', 't', 'emergency').id;
  assert.strictEqual(d.state('t', a).status, 'human_escalation');
  assert.throws(() => d.book('t', a, slot(S1)), /human dispatch/);
});

test('cancel releases slot', () => {
  const d = new DispatchCore();
  const a = make(d).id, b = make(d, 'b').id;
  d.book('t', a, slot(S1));
  d.cancel('t', a);
  assert.strictEqual(d.book('t', b, slot(S1)), true);
});

test('reschedule conflict leaves original booking', () => {
  const d = new DispatchCore();
  const a = make(d).id, b = make(d, 'b').id;
  d.book('t', a, slot(S1));
  d.book('t', b, slot(S2));
  assert.throws(() => d.reschedule('t', a, slot(S2)), SlotUnavailable);
  assert.strictEqual(d.booking('t', a).start_utc, '2026-10-22T13:00:00.000Z');
});

test('required fields', () => {
  const d = new DispatchCore();
  assert.throws(() => d.intake({ tenant: 't', sourceKey: 'a', customer: '', phone: 'p', address: 'a', service: 's' }), DispatchError);
});

test('same slot in different tenants is allowed', () => {
  const d = new DispatchCore();
  const a = make(d).id, b = make(d, 'a', 'other').id;
  d.book('t', a, slot(S1));
  assert.strictEqual(d.book('other', b, slot(S1)), true);
});

// --- regression tests for audited defects ---
test('overlapping appointment rejected', () => {
  const d = new DispatchCore();
  const a = make(d).id, b = make(d, 'b').id;
  d.book('t', a, slot(S1));
  assert.throws(() => d.book('t', b, slot({ start: '2026-10-22T10:00:00-04:00', end: '2026-10-22T12:00:00-04:00' })), SlotUnavailable);
});

test('back-to-back appointments allowed', () => {
  const d = new DispatchCore();
  const a = make(d).id, b = make(d, 'b').id;
  d.book('t', a, slot(S1));
  assert.strictEqual(d.book('t', b, slot({ start: '2026-10-22T11:00:00-04:00', end: '2026-10-22T12:00:00-04:00' })), true);
});

test('same instant written with a different offset is a conflict', () => {
  const d = new DispatchCore();
  const a = make(d).id, b = make(d, 'b').id;
  d.book('t', a, slot(S1));
  assert.throws(() => d.book('t', b, slot({ start: '2026-10-22T13:00:00Z', end: '2026-10-22T14:00:00Z' })), SlotUnavailable);
});

test('naive, inverted, free-text and impossible times rejected', () => {
  const d = new DispatchCore();
  const a = make(d).id;
  assert.throws(() => d.book('t', a, slot({ start: '2026-10-22T09:00:00', end: '2026-10-22T10:00:00' })), DispatchError);
  assert.throws(() => d.book('t', a, slot({ start: S1.end, end: S1.start })), DispatchError);
  assert.throws(() => d.book('t', a, slot({ start: 'tomorrow', end: 'later' })), DispatchError);
  assert.throws(() => d.book('t', a, slot({ start: '2026-02-30T09:00:00Z', end: '2026-02-30T10:00:00Z' })), /calendar/);
});

test('reschedule may overlap its own current window', () => {
  const d = new DispatchCore();
  const a = make(d).id;
  d.book('t', a, slot(S1));
  const moved = slot({ start: '2026-10-22T10:00:00-04:00', end: '2026-10-22T12:00:00-04:00' });
  assert.strictEqual(d.reschedule('t', a, moved), true);
  assert.strictEqual(d.reschedule('t', a, moved), false);
});

test('book rolls back on mid-transaction failure and retry succeeds', () => {
  const d = new DispatchCore();
  const a = make(d).id;
  crashOnEvent(d, () => d.book('t', a, slot(S1)));
  assert.strictEqual(d.state('t', a).status, 'pending_review');
  assert.strictEqual(d.booking('t', a), null);
  assert.strictEqual(d.book('t', a, slot(S1)), true);
});

test('cancel rolls back on mid-transaction failure', () => {
  const d = new DispatchCore();
  const a = make(d).id;
  d.book('t', a, slot(S1));
  crashOnEvent(d, () => d.cancel('t', a));
  assert.strictEqual(d.state('t', a).status, 'confirmed');
  assert.ok(d.booking('t', a));
});

test('intake rolls back on mid-transaction failure', () => {
  const d = new DispatchCore();
  crashOnEvent(d, () => make(d));
  assert.strictEqual(make(d).created, true);
});

test('idempotency key reused with different payload is rejected', () => {
  const d = new DispatchCore();
  make(d);
  assert.throws(() => d.intake({ tenant: 't', sourceKey: 'a', customer: 'Bob', phone: '5559999999', address: '9 Other Rd', service: 'hvac' }), IdempotencyConflict);
});

test('emergency on retry escalates existing request', () => {
  const d = new DispatchCore();
  const a = make(d).id;
  assert.deepStrictEqual(make(d, 'a', 't', 'emergency'), { id: a, created: false });
  assert.deepStrictEqual(d.state('t', a), { status: 'human_escalation', urgency: 'emergency' });
  assert.ok(d.events('t', a).some((e) => e.event === 'escalation_required'));
});

test('emergency is never downgraded', () => {
  const d = new DispatchCore();
  const a = make(d, 'a', 't', 'emergency').id;
  make(d, 'a', 't', 'routine');
  assert.deepStrictEqual(d.state('t', a), { status: 'human_escalation', urgency: 'emergency' });
});

test('escalating a confirmed booking blocks automated changes', () => {
  const d = new DispatchCore();
  const a = make(d).id;
  d.book('t', a, slot(S1));
  assert.strictEqual(d.escalate('t', a, 'caller reports flooding'), true);
  assert.strictEqual(d.escalate('t', a), false);
  assert.throws(() => d.cancel('t', a), /Human review/);
  assert.throws(() => d.reschedule('t', a, slot(S2)), DispatchError);
  assert.throws(() => d.escalate('other', a), DispatchError);
});

test('reads and writes are tenant-scoped', () => {
  const d = new DispatchCore();
  const a = make(d, 'a', 'clientA').id;
  assert.strictEqual(d.state('clientB', a), null);
  assert.strictEqual(d.booking('clientB', a), null);
  assert.deepStrictEqual(d.events('clientB', a), []);
  assert.throws(() => d.cancel('clientB', a), DispatchError);
  assert.throws(() => d.reschedule('clientB', a, slot(S1)), DispatchError);
});

test('whitespace-only fields rejected', () => {
  const d = new DispatchCore();
  assert.throws(() => d.intake({ tenant: 't', sourceKey: 'k', customer: '  ', phone: ' ', address: ' ', service: ' ' }), DispatchError);
  assert.throws(() => d.intake({ tenant: ' ', sourceKey: 'k', customer: 'Jane', phone: '1', address: 'a', service: 's' }), DispatchError);
});

test('concurrent intake with the same key from separate connections creates one request', async () => {
  const file = tmpDb();
  new DispatchCore(file).close();
  const results = await runWorkers(8, () => ({ file, op: 'intake' }));
  assert.deepStrictEqual(results.filter((r) => r.err), []);
  assert.strictEqual(new Set(results.map((r) => r.ok.id)).size, 1);
  assert.strictEqual(results.filter((r) => r.ok.created).length, 1);
});

test('concurrent overlapping bookings from separate connections: exactly one wins', async () => {
  const file = tmpDb();
  const base = new DispatchCore(file);
  const rids = Array.from({ length: 8 }, (_, i) => make(base, String(i)).id);
  base.close();
  const results = await runWorkers(8, (i) => ({ file, op: 'book', rid: rids[i], start: `2026-10-22T09:0${i}:00-04:00` }));
  assert.strictEqual(results.filter((r) => r.ok === true).length, 1);
  assert.strictEqual(results.filter((r) => r.err === 'SlotUnavailable').length, 7);
});
