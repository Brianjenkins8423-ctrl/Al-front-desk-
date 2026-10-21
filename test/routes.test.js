const test = require('node:test');
const assert = require('node:assert');
const ghlConfig = require('../config/ghl-dispatch.json');
const { createApp } = require('../app');
const { DispatchCore } = require('../dispatch/dispatch-core');
const { GhlClient } = require('../dispatch/ghl-client');
const { DispatchService } = require('../dispatch/service');
const { parseSecrets } = require('../dispatch/routes');
const { validateEnv, redact } = require('../secrets');

const LOC = ghlConfig.locationId;
const SECRET = 'dispatch-secret-for-fronthalo-0123456789';
const OTHER_LOC = 'OtherClientLocation01';
const OTHER_SECRET = 'dispatch-secret-for-other-client-9876543210';
const ADMIN = 'admin-token-that-is-long-enough-123456';
const quiet = { log() {}, warn() {}, error() {} };

async function start({ withOther = false, secrets } = {}) {
  const mk = (loc) => {
    const core = new DispatchCore(':memory:');
    const ghl = new GhlClient({ locationId: loc, writesEnabled: false, baseUrl: 'http://127.0.0.1:1' });
    ghl.allowOtherLocation = true;
    return new DispatchService({ core, ghl, calendarId: 'CAL', notifier: { send: async () => {} }, alerter: { send: async () => {} }, log: quiet });
  };
  const services = { [LOC]: mk(LOC), ...(withOther ? { [OTHER_LOC]: mk(OTHER_LOC) } : {}) };
  const sec = secrets || { [LOC]: SECRET, ...(withOther ? { [OTHER_LOC]: OTHER_SECRET } : {}) };
  const app = createApp({
    env: { ADMIN_API_TOKEN: ADMIN, TWILIO_AUTH_TOKEN: 'x', PUBLIC_BASE_URL: 'https://x.example' },
    storage: {}, generateReply: async () => ({}), sendSms: async () => {}, businessConfig: {}, log: quiet,
    dispatch: { services, secrets: sec },
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, services, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
const call = (ctx, path, { body, secret, method = 'POST' } = {}) =>
  fetch(ctx.url + path, { method, headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const hook = (key, extra = {}) => ({ contact_id: 'contact12345', full_name: 'Jane Doe', phone: '+13175550100', address1: '1 Main St', city: 'Fishers', location: { id: LOC }, customData: { request_key: key, service: 'Plumbing', ...extra } });

test('intake: no/wrong/other-scheme secret -> 401 and nothing is stored', async () => {
  const ctx = await start();
  assert.strictEqual((await call(ctx, '/dispatch/ghl/intake', { body: hook('k1') })).status, 401);
  assert.strictEqual((await call(ctx, '/dispatch/ghl/intake', { body: hook('k1'), secret: 'wrong-secret-wrong-secret-wrong-1234' })).status, 401);
  assert.strictEqual((await call(ctx, '/dispatch/ghl/intake', { body: hook('k1'), secret: ADMIN })).status, 401); // admin token is not a webhook secret
  assert.strictEqual(ctx.services[LOC].core.db.prepare('SELECT count(*) n FROM requests').get().n, 0);
  ctx.server.close();
});

test('intake: valid secret creates a request; GHL redelivery is a 200 duplicate', async () => {
  const ctx = await start();
  const a = await call(ctx, '/dispatch/ghl/intake', { body: hook('k2'), secret: SECRET });
  assert.strictEqual(a.status, 201);
  const first = await a.json();
  assert.strictEqual(first.status, 'received');
  const b = await call(ctx, '/dispatch/ghl/intake', { body: hook('k2'), secret: SECRET });
  assert.strictEqual(b.status, 200);
  assert.deepStrictEqual(await b.json(), { ...first, created: false });
  ctx.server.close();
});

test('intake: same key with different details -> 409, original untouched', async () => {
  const ctx = await start();
  await call(ctx, '/dispatch/ghl/intake', { body: hook('k3'), secret: SECRET });
  const r = await call(ctx, '/dispatch/ghl/intake', { body: { ...hook('k3'), full_name: 'Someone Else' }, secret: SECRET });
  assert.strictEqual(r.status, 409);
  ctx.server.close();
});

test('intake: emergency is escalated immediately', async () => {
  const ctx = await start();
  const r = await call(ctx, '/dispatch/ghl/intake', { body: hook('k4', { urgency: 'emergency' }), secret: SECRET });
  assert.strictEqual((await r.json()).status, 'a_person_will_contact_you');
  ctx.server.close();
});

test('client isolation: a body naming another location cannot cross tenants', async () => {
  const ctx = await start({ withOther: true });
  // Client A's secret, but the body claims client B's location.
  const spoof = await call(ctx, '/dispatch/ghl/intake', { body: { ...hook('k5'), location: { id: OTHER_LOC } }, secret: SECRET });
  assert.strictEqual(spoof.status, 400);
  // Each secret writes only into its own tenant.
  await call(ctx, '/dispatch/ghl/intake', { body: hook('shared-key'), secret: SECRET });
  await call(ctx, '/dispatch/ghl/intake', { body: { ...hook('shared-key'), location: { id: OTHER_LOC } }, secret: OTHER_SECRET });
  assert.strictEqual(ctx.services[LOC].core.db.prepare('SELECT count(*) n FROM requests').get().n, 1);
  assert.strictEqual(ctx.services[OTHER_LOC].core.db.prepare('SELECT count(*) n FROM requests').get().n, 1);
  // A request id from A is invisible to B's ack endpoint.
  const idA = ctx.services[LOC].core.db.prepare('SELECT id FROM requests').get().id;
  const r = await call(ctx, '/dispatch/ghl/ack', { body: { request_id: idA, kind: 'escalation', by: 'x' }, secret: OTHER_SECRET });
  assert.strictEqual(r.status, 400);
  ctx.server.close();
});

test('ack endpoint: escalation acknowledgment requires the secret and validates kind', async () => {
  const ctx = await start();
  const { id } = await (await call(ctx, '/dispatch/ghl/intake', { body: hook('k6', { urgency: 'emergency' }), secret: SECRET })).json();
  assert.strictEqual((await call(ctx, '/dispatch/ghl/ack', { body: { request_id: id, kind: 'escalation', by: 'dispatcher' } })).status, 401);
  const ok = await call(ctx, '/dispatch/ghl/ack', { body: { request_id: id, kind: 'escalation', by: 'dispatcher' }, secret: SECRET });
  assert.deepStrictEqual(await ok.json(), { ok: true, changed: true });
  assert.strictEqual((await call(ctx, '/dispatch/ghl/ack', { body: { request_id: id, kind: 'bogus', by: 'x' }, secret: SECRET })).status, 400);
  ctx.server.close();
});

test('weak or shared secrets are dropped, so the router rejects everything (fail closed)', async () => {
  assert.deepStrictEqual(parseSecrets(JSON.stringify({ a: 'short', b: SECRET, c: SECRET })), { b: SECRET });
  assert.deepStrictEqual(parseSecrets('not json'), {});
  const ctx = await start({ secrets: {} });
  assert.strictEqual((await call(ctx, '/dispatch/ghl/intake', { body: hook('k7'), secret: SECRET })).status, 401);
  ctx.server.close();
});

test('admin health: requires admin token; reports 503 when a job is dead', async () => {
  const ctx = await start();
  assert.strictEqual((await fetch(ctx.url + '/dispatch/admin/health')).status, 401);
  assert.strictEqual((await fetch(ctx.url + '/dispatch/admin/health', { headers: { Authorization: 'Bearer ' + SECRET } })).status, 401);
  const ok = await fetch(ctx.url + '/dispatch/admin/health', { headers: { Authorization: 'Bearer ' + ADMIN } });
  assert.strictEqual(ok.status, 200);
  const core = ctx.services[LOC].core;
  core.enqueue(LOC, null, 'x.test', {}, 'd1');
  const job = core.claimDue()[0];
  for (let i = 0; i < 6; i++) core.failJob(job.id, 'boom');
  const bad = await fetch(ctx.url + '/dispatch/admin/health', { headers: { Authorization: 'Bearer ' + ADMIN } });
  assert.strictEqual(bad.status, 503);
  ctx.server.close();
});

test('dispatch routes do not exist unless explicitly mounted', async () => {
  const app = createApp({ env: {}, storage: {}, generateReply: async () => ({}), sendSms: async () => {}, businessConfig: {}, log: quiet });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/dispatch/ghl/intake`, { method: 'POST' });
  assert.strictEqual(res.status, 404);
  server.close();
});

test('secrets: validateEnv reports names only; redact strips configured secret values', () => {
  const problems = validateEnv({ DISPATCH_ENABLED: 'true', ADMIN_API_TOKEN: 'short', PUBLIC_BASE_URL: 'http://insecure', DISPATCH_DB_PATH: ':memory:' });
  assert.ok(problems.includes('ANTHROPIC_API_KEY is not set'));
  assert.ok(problems.some((p) => p.startsWith('ADMIN_API_TOKEN is shorter')));
  assert.ok(problems.includes('PUBLIC_BASE_URL must start with https://'));
  assert.ok(problems.some((p) => p.startsWith('DISPATCH_DB_PATH must be a persistent file')));
  assert.ok(!problems.join(' ').includes('short'.repeat(2)));
  assert.strictEqual(redact('failed with token pit-abcdef123456 here', { GHL_PRIVATE_INTEGRATION_TOKEN: 'pit-abcdef123456' }), 'failed with token [REDACTED] here');
});
