// dispatch/ghl-adapter.js
// Pure translation between GoHighLevel workflow webhooks and the dispatch core.
// Makes NO network calls and sends nothing: callers decide if/when to touch GHL.

const ghlConfig = require('../config/ghl-dispatch.json');
const { DispatchError, IdempotencyConflict } = require('./dispatch-core');

const STATUS_TO_STAGE = {
  pending_review: 'newRequest',
  human_escalation: 'humanReviewNeeded',
  confirmed: 'appointmentConfirmed',
  cancelled: 'closedResolved',
};

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Translates the body of a GHL workflow "Webhook" action into dispatch intake args.
//
// authenticatedLocationId must come from the caller's verified credential (e.g. a per-location
// shared secret checked by the HTTP layer), never from the body: the body's location.id is
// attacker-controlled, so it is only accepted when it matches.
//
// The workflow must add Custom Data: request_key (unique per request, stable across retries),
// service, and optionally urgency (routine | priority | emergency).
function intakeFromWorkflowWebhook(body, authenticatedLocationId) {
  if (!authenticatedLocationId) throw new DispatchError('Unauthenticated: no location bound to credential');
  if (!body || typeof body !== 'object') throw new DispatchError('Invalid webhook body');
  const bodyLocation = str(body.location && body.location.id);
  if (bodyLocation && bodyLocation !== authenticatedLocationId) {
    throw new DispatchError('Webhook location does not match authenticated location');
  }
  const custom = body.customData || {};
  const urgency = str(custom.urgency).toLowerCase() || 'routine';
  const customer = str(body.full_name) || [str(body.first_name), str(body.last_name)].filter(Boolean).join(' ');
  const address = str(body.full_address) || [str(body.address1), str(body.city), str(body.state), str(body.postal_code)].filter(Boolean).join(', ');

  return {
    intake: {
      tenant: authenticatedLocationId,
      sourceKey: str(custom.request_key),
      customer,
      phone: str(body.phone),
      address,
      service: str(custom.service),
      urgency,
    },
    ghl: { locationId: authenticatedLocationId, contactId: str(body.contact_id) || null },
  };
}

// Pipeline stage for a dispatch status, in the "FH MASTER | Office Requests" pipeline.
// Integrity failures (key reuse with different data) route to "08 Exception / reconcile".
function stageForStatus(status) {
  const key = STATUS_TO_STAGE[status];
  if (!key) throw new DispatchError(`No GHL stage mapped for status: ${status}`);
  return { pipelineId: ghlConfig.pipeline.id, pipelineStageId: ghlConfig.pipeline.stages[key], stage: key };
}

function stageForError(err) {
  if (err instanceof IdempotencyConflict) {
    return { pipelineId: ghlConfig.pipeline.id, pipelineStageId: ghlConfig.pipeline.stages.exceptionReconcile, stage: 'exceptionReconcile' };
  }
  return null;
}

module.exports = { intakeFromWorkflowWebhook, stageForStatus, stageForError, STATUS_TO_STAGE };
