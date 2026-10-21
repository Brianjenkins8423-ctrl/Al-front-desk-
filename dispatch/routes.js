// dispatch/routes.js — HTTP surface for the dispatch service. Mounted only when DISPATCH_ENABLED=true.
//
// Auth: each GHL location has its own secret (DISPATCH_WEBHOOK_SECRETS = {"<locationId>":"<secret>"}),
// sent by the GHL workflow Webhook action as `Authorization: Bearer <secret>`. The tenant is the
// location that OWNS the secret; the request body can never choose or override it, so one client's
// secret cannot read or write another client's data.

const express = require('express');
const crypto = require('crypto');
const { DispatchError, IdempotencyConflict } = require('./dispatch-core');
const { intakeFromWorkflowWebhook } = require('./ghl-adapter');

function digest(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

function parseSecrets(raw) {
  let map;
  try { map = JSON.parse(raw || '{}'); } catch { return {}; }
  // Weak or duplicated secrets are dropped: a shared secret would let two clients reach each other.
  const seen = new Set();
  const out = {};
  for (const [loc, secret] of Object.entries(map)) {
    if (typeof secret === 'string' && secret.length >= 32 && !seen.has(secret)) { seen.add(secret); out[loc] = secret; }
  }
  return out;
}

function createDispatchRouter({ services, secrets, requireAdmin, log = console }) {
  const router = express.Router();
  const hashed = Object.entries(secrets).map(([loc, s]) => [loc, digest(s)]);

  function authenticate(req, res, next) {
    const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: 'Unauthorized' });
    const given = digest(m[1]);
    let loc = null;
    for (const [l, h] of hashed) if (crypto.timingSafeEqual(given, h)) loc = l; // no early exit
    const svc = loc && services[loc];
    if (!svc) return res.status(401).json({ error: 'Unauthorized' });
    req.tenant = loc;
    req.svc = svc;
    next();
  }

  const fail = (res, err) => {
    if (err instanceof IdempotencyConflict) return res.status(409).json({ error: err.message });
    if (err instanceof DispatchError) return res.status(400).json({ error: err.message });
    log.error('[DISPATCH] internal error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  };

  router.post('/ghl/intake', authenticate, (req, res) => {
    try {
      const { intake, ghl } = intakeFromWorkflowWebhook(req.body, req.tenant);
      const out = req.svc.intake(intake, { contactId: ghl.contactId });
      res.status(out.created ? 201 : 200).json({ id: out.id, created: out.created, status: req.svc.customerStatus(out.id) });
    } catch (err) { fail(res, err); }
  });

  // Technician or dispatcher acknowledgment (e.g. GHL workflow fired when they reply "YES").
  router.post('/ghl/ack', authenticate, (req, res) => {
    try {
      const { request_id: rid, kind, by } = req.body || {};
      const core = req.svc.core;
      const changed = kind === 'assignment' ? core.acknowledgeAssignment(req.tenant, rid, by)
        : kind === 'escalation' ? core.acknowledgeEscalation(req.tenant, rid, by)
        : (() => { throw new DispatchError('kind must be assignment or escalation'); })();
      res.json({ ok: true, changed });
    } catch (err) { fail(res, err); }
  });

  router.get('/admin/health', requireAdmin, (req, res) => {
    const tenants = Object.fromEntries(Object.entries(services).map(([loc, svc]) => [loc, svc.core.outboxStats()]));
    const dead = Object.values(tenants).reduce((n, t) => n + t.dead, 0);
    res.status(dead ? 503 : 200).json({ ok: !dead, tenants });
  });

  return router;
}

module.exports = { createDispatchRouter, parseSecrets };
