const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ghlConfig = require('../config/ghl-dispatch.json');
const { DispatchCore, SlotUnavailable, DispatchError } = require('../dispatch/dispatch-core');
const { GhlClient, GhlWritesDisabled } = require('../dispatch/ghl-client');
const { DispatchService, ServiceUnavailable } = require('../dispatch/service');
const { intakeFromWorkflowWebhook } = require('../dispatch/ghl-adapter');
const { createMockGhl, SLOTS } = require('./helpers/mock-ghl');

const LOC = ghlConfig.locationId;
const STAGES = ghlConfig.pipeline.stages;
const T0 = '2026-10-21T12:00:00.000Z';
const plus = (sec, from = T0) => new Date(Date.parse(from) + sec * 1000).toISOString();
const noSleep = async () => {};
const quiet = { log() {}, warn() {}, error() {} };

const mocks = [];
test.after(() => mocks.forEach((m) => m.close()));

async function setup({ writesEnabled = true, core, clock } = {}) {
  const mock = await createMockGhl({ locationId: LOC });
  mocks.push(mock);
  const ghl = new GhlClient({ locationId: LOC, token: mock.token, baseUrl: mock.baseUrl, timeoutMs: 250, writesEnabled, sleep: noSleep });
  const sent = [];
  const alerts = [];
  const notifier = { fail: false, send: async (m) => { if (notifier.fail) throw new Error('sms provider down'); sent.push(m); } };
  const alerter = { send: async (a) => alerts.push(a) };
  let t = T0;
  core = core || new DispatchCore(':memory:', { clock: () => t });
  const svc = new DispatchService({ core, ghl, notifier, alerter, calendarId: mock.calendarId, log: quiet, now: clock || (() => t) });
  return { mock, ghl, core, svc, sent, alerts, notifier, setTime: (x) => { t = x; }, close: () => mock.close() };
}

const webhook = (key, extra = {}) => ({
  contact_id: 'contact12345', full_name: 'Jane Doe', phone: '+13175550100', address1: '1 Main St', city: 'Fishers', state: 'IN', postal_code: '46037',
  location: { id: LOC }, customData: { request_key: key, service: 'Plumbing', ...extra },
});
const intake = (svc, key, extra, contactId = 'contact12345') =>
  svc.intake(intakeFromWorkflowWebhook(webhook(key, extra), LOC).intake, { contactId });
const S = (i) => ({ start: SLOTS[i], end: new Date(Date.parse(SLOTS[i]) + 30 * 60000).toISOString() });

test('E2E: webhook -> opportunity -> verified booking -> GHL appointment -> assign -> ack -> reconcile', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'e2e-1');
  assert.strictEqual(c.svc.customerStatus(id), 'received');
  await c.svc.runOnce();
  assert.strictEqual(c.mock.state.opportunities.length, 1);
  assert.strictEqual(c.mock.state.opportunities[0].pipelineStageId, STAGES.newRequest);

  const r = await c.svc.verifyAndBook({ rid: id, ...S(0) });
  assert.strictEqual(r.status, 'confirmed');
  assert.strictEqual(c.mock.state.events.length, 1);
  assert.strictEqual(c.mock.state.events[0].contactId, 'contact12345');
  assert.strictEqual(c.svc.customerStatus(id), 'confirmed');
  await c.svc.runOnce();
  assert.strictEqual(c.mock.state.opportunities[0].pipelineStageId, STAGES.appointmentConfirmed);

  assert.strictEqual(c.core.assign(LOC, id, 'tech-mike', { at: T0 }), true);
  await c.svc.runOnce();
  assert.deepStrictEqual(c.sent.map((m) => [m.to, m.kind]), [['tech-mike', 'assignment']]);
  assert.strictEqual(c.core.acknowledgeAssignment(LOC, id, 'tech-mike', plus(60)), true);
  assert.strictEqual(c.core.assignment(LOC, id).status, 'acknowledged');

  assert.deepStrictEqual(await c.svc.reconcile(id), { ok: true, mismatches: [] });
  assert.ok(c.mock.state.log.every((l) => l.auth === `Bearer ${c.mock.token}`));
  c.close();
});

test('availability: a time GHL does not offer is refused and nothing is booked or written', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'unavail');
  await assert.rejects(c.svc.verifyAndBook({ rid: id, start: '2026-10-22T03:00:00-04:00', end: '2026-10-22T03:30:00-04:00' }), SlotUnavailable);
  await assert.rejects(c.svc.verifyAndBook({ rid: id, start: SLOTS[0], end: new Date(Date.parse(SLOTS[0]) + 90 * 60000).toISOString() }), /30 minutes/);
  assert.strictEqual(c.core.state(LOC, id).status, 'pending_review');
  assert.strictEqual(c.mock.writes().length, 0);
  c.close();
});

test('availability: GHL unreachable fails closed (no booking, no write)', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'down');
  c.mock.state.faults[`GET /calendars/${c.mock.calendarId}/free-slots`] = ['down', 'down', 'down'];
  await assert.rejects(c.svc.verifyAndBook({ rid: id, ...S(0) }), ServiceUnavailable);
  assert.strictEqual(c.core.state(LOC, id).status, 'pending_review');
  assert.strictEqual(c.mock.writes().length, 0);
  c.close();
});

test('availability: a transient 500 on read is retried transparently', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'flaky-read');
  c.mock.state.faults[`GET /calendars/${c.mock.calendarId}/free-slots`] = ['500'];
  assert.strictEqual((await c.svc.verifyAndBook({ rid: id, ...S(0) })).status, 'confirmed');
  c.close();
});

test('simultaneous bookings for one slot: exactly one wins, GHL holds exactly one appointment', async () => {
  const c = await setup();
  const ids = Array.from({ length: 6 }, (_, i) => intake(c.svc, `race-${i}`, {}, `contact${i}0000`).id);
  const results = await Promise.allSettled(ids.map((rid) => c.svc.verifyAndBook({ rid, ...S(1) })));
  assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof SlotUnavailable));
  assert.strictEqual(c.mock.state.events.length, 1);
  const states = ids.map((rid) => c.core.state(LOC, rid).status).sort();
  assert.deepStrictEqual(states, ['confirmed', ...Array(5).fill('pending_review')]);
  c.close();
});

test('simultaneous bookings from two service instances sharing one database file', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'svc-')), 'd.db');
  const a = await setup({ core: new DispatchCore(file, { clock: () => T0 }) });
  const core2 = new DispatchCore(file, { clock: () => T0 });
  const svc2 = new DispatchService({ core: core2, ghl: a.ghl, notifier: a.notifier, alerter: a.alerter, calendarId: a.mock.calendarId, log: quiet, now: () => T0 });
  const r1 = intake(a.svc, 'x1', {}, 'contactAAAAA').id;
  const r2 = intake(a.svc, 'x2', {}, 'contactBBBBB').id;
  const res = await Promise.allSettled([a.svc.verifyAndBook({ rid: r1, ...S(2) }), svc2.verifyAndBook({ rid: r2, ...S(2) })]);
  assert.strictEqual(res.filter((r) => r.status === 'fulfilled').length, 1);
  assert.strictEqual(a.mock.state.events.length, 1);
  a.close();
});

test('GHL rejects the slot after our check (someone booked it directly): local hold is released', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'late-conflict');
  const orig = c.ghl.getFreeSlots.bind(c.ghl);
  c.ghl.getFreeSlots = async (...a) => { const s = await orig(...a); c.mock.state.events.push({ id: 'EVmanual0001', startTime: SLOTS[3], appointmentStatus: 'confirmed' }); return s; };
  await assert.rejects(c.svc.verifyAndBook({ rid: id, ...S(3) }), SlotUnavailable);
  assert.strictEqual(c.core.state(LOC, id).status, 'pending_review');
  assert.strictEqual(c.core.booking(LOC, id), null);
  assert.strictEqual(c.mock.state.events.length, 1);
  c.close();
});

test('timeout on create: held, not told "confirmed", retried later with no duplicate', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'timeout');
  c.mock.state.faults['POST /calendars/events/appointments'] = ['timeout'];
  const r = await c.svc.verifyAndBook({ rid: id, ...S(0) });
  assert.strictEqual(r.status, 'pending_sync');
  assert.strictEqual(c.svc.customerStatus(id), 'being_confirmed');
  assert.strictEqual(c.mock.state.events.length, 0);
  await c.svc.runOnce();
  assert.strictEqual(c.mock.state.events.length, 1);
  assert.strictEqual(c.svc.customerStatus(id), 'confirmed');
  await c.svc.runOnce();
  assert.strictEqual(c.mock.state.events.length, 1);
  c.close();
});

test('response lost AFTER GHL committed: retry finds the appointment instead of creating a second', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'lost-response');
  c.mock.state.faults['POST /calendars/events/appointments'] = ['commit-then-500'];
  assert.strictEqual((await c.svc.verifyAndBook({ rid: id, ...S(0) })).status, 'pending_sync');
  assert.strictEqual(c.mock.state.events.length, 1);
  await c.svc.runOnce();
  assert.strictEqual(c.mock.state.events.length, 1);
  assert.strictEqual(c.core.syncState(LOC, id).external_id, c.mock.state.events[0].id);
  assert.deepStrictEqual(await c.svc.reconcile(id), { ok: true, mismatches: [] });
  c.close();
});

test('retry hits a definitive refusal: hold released, human alerted, no retry loop', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'refused-on-retry');
  c.mock.state.faults['POST /calendars/events/appointments'] = ['500'];
  await c.svc.verifyAndBook({ rid: id, ...S(0) });
  c.mock.state.events.push({ id: 'EVstolen0001', startTime: SLOTS[0], appointmentStatus: 'confirmed' });
  await c.svc.runOnce();
  await c.svc.runOnce();
  assert.strictEqual(c.core.state(LOC, id).status, 'pending_review');
  assert.strictEqual(c.alerts.filter((a) => a.type === 'alert.booking_refused').length, 1);
  assert.strictEqual(c.core.outboxStats().pending, 0);
  c.close();
});

test('writes are disabled by default: no POST/PUT ever reaches GHL', async () => {
  const c = await setup({ writesEnabled: false });
  const { id } = intake(c.svc, 'dry-run');
  const r = await c.svc.verifyAndBook({ rid: id, ...S(0) });
  assert.strictEqual(r.status, 'pending_sync');
  await c.svc.runOnce();
  assert.strictEqual(c.mock.writes().length, 0);
  await assert.rejects(c.ghl.createAppointment({}), GhlWritesDisabled);
  c.close();
});

test('duplicate webhook deliveries create one request and one opportunity', async () => {
  const c = await setup();
  const a = intake(c.svc, 'dup-1'), b = intake(c.svc, 'dup-1');
  assert.deepStrictEqual([a.created, b.created], [true, false]);
  await c.svc.runOnce(); await c.svc.runOnce();
  assert.strictEqual(c.mock.state.opportunities.length, 1);
  c.close();
});

test('stale stage jobs cannot regress GHL: stage always follows current local status', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'stale');
  await c.svc.runOnce();
  await c.svc.verifyAndBook({ rid: id, ...S(0) });
  c.svc.cancel(id);
  c.core.enqueue(LOC, id, 'ghl.sync_stage', { rid: id }, 'stale-replay-1');
  await c.svc.runOnce();
  assert.strictEqual(c.mock.state.opportunities[0].pipelineStageId, STAGES.closedResolved);
  assert.strictEqual(c.mock.state.events[0].appointmentStatus, 'cancelled');
  await c.svc.runOnce();
  assert.strictEqual(c.mock.state.opportunities[0].pipelineStageId, STAGES.closedResolved);
  c.close();
});

test('reconcile detects drift between GHL and local records', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'drift');
  await c.svc.runOnce();
  await c.svc.verifyAndBook({ rid: id, ...S(0) });
  await c.svc.runOnce();
  c.mock.state.events[0].appointmentStatus = 'cancelled';
  c.mock.state.opportunities[0].pipelineStageId = STAGES.closedResolved;
  const r = await c.svc.reconcile(id);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.mismatches.length, 2);
  await c.svc.runOnce();
  assert.strictEqual(c.alerts.length, 1);
  c.close();
});

test('tenant isolation: a service/client for another location is refused and cannot read this tenant', async () => {
  const c = await setup();
  const other = new GhlClient({ locationId: 'OTHERLOC', baseUrl: c.mock.baseUrl, token: c.mock.token });
  assert.throws(() => new DispatchService({ core: c.core, ghl: other, calendarId: 'x' }), /does not match configured location/);
  assert.throws(() => c.svc.intake({ tenant: 'OTHERLOC', sourceKey: 'k', customer: 'a', phone: 'b', address: 'c', service: 'd' }), /Tenant does not match/);
  const { id } = intake(c.svc, 'iso');
  assert.strictEqual(c.core.state('OTHERLOC', id), null);
  assert.throws(() => c.core.setRef('OTHERLOC', id, 'x', 'y'), DispatchError);
  c.close();
});

// ---- emergency & escalation ------------------------------------------------------------------
test('emergency: dispatcher paged immediately, backup after 5 min, owner after 10; never auto-booked', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'em-1', { urgency: 'emergency' });
  assert.strictEqual(c.svc.customerStatus(id), 'a_person_will_contact_you');
  await assert.rejects(c.svc.verifyAndBook({ rid: id, ...S(0) }), /Emergency requires human dispatch/);
  c.setTime(T0); await c.svc.runOnce();
  assert.deepStrictEqual(c.sent.map((m) => m.to), ['dispatcher']);
  c.setTime(plus(299)); await c.svc.runOnce();
  assert.strictEqual(c.sent.length, 1);
  c.setTime(plus(300)); await c.svc.runOnce();
  assert.deepStrictEqual(c.sent.map((m) => m.to), ['dispatcher', 'backup']);
  c.setTime(plus(600)); await c.svc.runOnce();
  assert.deepStrictEqual(c.sent.map((m) => m.to), ['dispatcher', 'backup', 'owner']);
  c.setTime(plus(1300)); await c.svc.runOnce(); await c.svc.runOnce();
  assert.strictEqual(c.alerts.filter((a) => a.type === 'alert.escalation_exhausted').length, 1);
  assert.strictEqual(c.core.outboxStats().pending, 0);
  c.close();
});

test('emergency: acknowledgment stops further escalation', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'em-ack', { urgency: 'emergency' });
  await c.svc.runOnce();
  assert.strictEqual(c.core.acknowledgeEscalation(LOC, id, 'dispatcher', plus(30)), true);
  assert.strictEqual(c.core.acknowledgeEscalation(LOC, id, 'dispatcher', plus(31)), false);
  c.setTime(plus(900)); await c.svc.runOnce();
  assert.deepStrictEqual(c.sent.map((m) => m.to), ['dispatcher']);
  assert.strictEqual(c.alerts.length, 0);
  assert.throws(() => c.core.acknowledgeEscalation('OTHERLOC', id, 'x'), DispatchError);
  c.close();
});

test('failed escalation: notifier down -> backoff retries -> dead job raises an alert; pages not lost', async () => {
  const c = await setup();
  intake(c.svc, 'em-fail', { urgency: 'emergency' });
  c.notifier.fail = true;
  let t = T0;
  for (let i = 0; i < 9; i++) { c.setTime(t); await c.svc.runOnce(); t = plus(3700, t); }
  const dead = c.core.db.prepare("SELECT type,attempts,status FROM outbox WHERE status='dead'").all();
  assert.ok(dead.length >= 1 && dead.every((d) => d.attempts === 6));
  assert.ok(c.alerts.some((a) => a.type === 'alert.job_dead'));
  assert.strictEqual(c.sent.length, 0);
  c.close();
});

test('failed escalation: notifier recovers before max attempts -> page is delivered once', async () => {
  const c = await setup();
  intake(c.svc, 'em-recover', { urgency: 'emergency' });
  c.notifier.fail = true;
  await c.svc.runOnce();
  assert.strictEqual(c.sent.length, 0);
  c.notifier.fail = false;
  c.setTime(plus(31)); await c.svc.runOnce();
  assert.deepStrictEqual(c.sent.map((m) => m.to), ['dispatcher']);
  c.setTime(plus(120)); await c.svc.runOnce();
  assert.strictEqual(c.sent.filter((m) => m.to === 'dispatcher').length, 1);
  c.close();
});

test('worker crash mid-job: lease expires and the job is re-run', async () => {
  const c = await setup();
  intake(c.svc, 'em-crash', { urgency: 'emergency' });
  c.core.tick(T0);
  assert.strictEqual(c.core.claimDue({ at: T0, leaseSec: 60 }).length >= 1, true); // claimed, then "crash"
  assert.strictEqual(c.core.claimDue({ at: plus(30) }).length, 0);
  c.setTime(plus(61)); await c.svc.runOnce();
  assert.strictEqual(c.sent.length, 1);
  c.close();
});

test('technician never acknowledges: assignment times out and escalates to humans', async () => {
  const c = await setup();
  const { id } = intake(c.svc, 'ack-timeout');
  await c.svc.verifyAndBook({ rid: id, ...S(0) });
  c.core.assign(LOC, id, 'tech-mike', { ackWithinSec: 600, at: T0 });
  c.setTime(plus(599)); await c.svc.runOnce();
  assert.strictEqual(c.core.assignment(LOC, id).status, 'assigned');
  c.setTime(plus(601)); await c.svc.runOnce();
  assert.strictEqual(c.core.assignment(LOC, id).status, 'timed_out');
  assert.strictEqual(c.core.state(LOC, id).status, 'human_escalation');
  assert.ok(c.sent.some((m) => m.kind === 'emergency' && m.to === 'dispatcher'));
  assert.throws(() => c.core.acknowledgeAssignment(LOC, id, 'tech-mike'), /needs human dispatch/);
  c.close();
});

test('assignment rules: needs a calendar-synced booking; wrong technician cannot acknowledge', async () => {
  const c = await setup({ writesEnabled: false });
  const { id } = intake(c.svc, 'assign-rules');
  assert.throws(() => c.core.assign(LOC, id, 'tech-mike'), /confirmed appointment/);
  await c.svc.verifyAndBook({ rid: id, ...S(0) });
  assert.throws(() => c.core.assign(LOC, id, 'tech-mike'), /not confirmed in the calendar/);
  c.close();
  const d = await setup();
  const r = intake(d.svc, 'assign-rules-2').id;
  await d.svc.verifyAndBook({ rid: r, ...S(0) });
  d.core.assign(LOC, r, 'tech-mike');
  assert.throws(() => d.core.acknowledgeAssignment(LOC, r, 'tech-eve'), /Not assigned/);
  assert.throws(() => d.core.acknowledgeAssignment('OTHERLOC', r, 'tech-mike'), DispatchError);
  d.close();
});
