const test = require('node:test');
const assert = require('node:assert');
const ghlConfig = require('../config/ghl-dispatch.json');
const { DispatchCore, DispatchError, IdempotencyConflict } = require('../dispatch/dispatch-core');
const { intakeFromWorkflowWebhook, stageForStatus, stageForError } = require('../dispatch/ghl-adapter');

const LOC = ghlConfig.locationId;

// Shape of a GHL workflow "Webhook" action body (contact merge fields + Custom Data).
const webhook = (overrides = {}) => ({
  contact_id: 'cnt_123',
  first_name: 'Jane',
  last_name: 'Doe',
  full_name: 'Jane Doe',
  phone: '+13175550100',
  address1: '123 Main St',
  city: 'Fishers',
  state: 'IN',
  postal_code: '46037',
  location: { id: LOC, name: 'fronthalo' },
  customData: { request_key: 'cnt_123-2026-10-21T15:00', service: 'Roof repair', urgency: 'Routine' },
  ...overrides,
});

test('maps a GHL workflow webhook to intake args', () => {
  const { intake, ghl } = intakeFromWorkflowWebhook(webhook(), LOC);
  assert.deepStrictEqual(intake, {
    tenant: LOC,
    sourceKey: 'cnt_123-2026-10-21T15:00',
    customer: 'Jane Doe',
    phone: '+13175550100',
    address: '123 Main St, Fishers, IN, 46037',
    service: 'Roof repair',
    urgency: 'routine',
  });
  assert.deepStrictEqual(ghl, { locationId: LOC, contactId: 'cnt_123' });
});

test('end to end: webhook -> intake -> pipeline stage, and GHL retry is deduplicated', () => {
  const d = new DispatchCore();
  const first = d.intake(intakeFromWorkflowWebhook(webhook(), LOC).intake);
  const retry = d.intake(intakeFromWorkflowWebhook(webhook(), LOC).intake);
  assert.strictEqual(first.created, true);
  assert.deepStrictEqual(retry, { id: first.id, created: false });
  assert.strictEqual(stageForStatus(d.state(LOC, first.id).status).pipelineStageId, ghlConfig.pipeline.stages.newRequest);
});

test('emergency webhook lands in "Human review needed"', () => {
  const d = new DispatchCore();
  const body = webhook({ customData: { request_key: 'k-emerg', service: 'Burst pipe', urgency: 'EMERGENCY' } });
  const { id } = d.intake(intakeFromWorkflowWebhook(body, LOC).intake);
  assert.strictEqual(stageForStatus(d.state(LOC, id).status).pipelineStageId, ghlConfig.pipeline.stages.humanReviewNeeded);
});

test('body location must match the authenticated location', () => {
  assert.throws(() => intakeFromWorkflowWebhook(webhook({ location: { id: 'someOtherLocation' } }), LOC), /does not match/);
  assert.throws(() => intakeFromWorkflowWebhook(webhook(), undefined), /Unauthenticated/);
});

test('missing request_key or service is rejected by the core', () => {
  const d = new DispatchCore();
  assert.throws(() => d.intake(intakeFromWorkflowWebhook(webhook({ customData: { service: 'x' } }), LOC).intake), DispatchError);
  assert.throws(() => d.intake(intakeFromWorkflowWebhook(webhook({ customData: { request_key: 'k' } }), LOC).intake), DispatchError);
});

test('invalid urgency from GHL is rejected, not silently defaulted', () => {
  const d = new DispatchCore();
  const body = webhook({ customData: { request_key: 'k', service: 's', urgency: 'ASAP' } });
  assert.throws(() => d.intake(intakeFromWorkflowWebhook(body, LOC).intake), /Invalid urgency/);
});

test('every core status maps to a real FH MASTER stage id', () => {
  const ids = new Set(Object.values(ghlConfig.pipeline.stages));
  for (const s of ['pending_review', 'human_escalation', 'confirmed', 'cancelled']) {
    const m = stageForStatus(s);
    assert.strictEqual(m.pipelineId, 'DbgrLtWXnSiW4FVGbDp0');
    assert.ok(ids.has(m.pipelineStageId));
  }
  assert.throws(() => stageForStatus('nonsense'), DispatchError);
});

test('idempotency conflicts route to "Exception / reconcile"', () => {
  assert.strictEqual(stageForError(new IdempotencyConflict('x')).pipelineStageId, ghlConfig.pipeline.stages.exceptionReconcile);
  assert.strictEqual(stageForError(new Error('x')), null);
});
