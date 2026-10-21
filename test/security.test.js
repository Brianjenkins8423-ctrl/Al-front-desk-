const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const twilio = require('twilio');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-sec-'));
const storage = require('../storage');
const { createApp } = require('../app');

const AUTH = 'twilio-test-auth-token-0123456789';
const BASE = 'https://frontdesk.example.com';
const ADMIN = 'admin-token-that-is-long-enough-123456';
const quiet = { log() {}, warn() {}, error() {} };

function start(envOverrides = {}, deps = {}) {
  const sent = [];
  const replies = [];
  const app = createApp({
    env: { TWILIO_AUTH_TOKEN: AUTH, PUBLIC_BASE_URL: BASE, ADMIN_API_TOKEN: ADMIN, ...envOverrides },
    storage,
    log: quiet,
    businessConfig: { businessName: 'Acme', missedCallMessage: 'Sorry we missed you at {business_name}' },
    generateReply: async (a) => {
      replies.push(a);
      return { text: 'Hello!', bookingDetected: true, leadName: 'Jane', serviceRequested: 'Roof', preferredTime: 'Fri' };
    },
    sendSms: async (m) => sent.push(m),
    ...deps,
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, sent, replies }));
  });
}

function signed(p, params, token = AUTH) {
  return { 'X-Twilio-Signature': twilio.getExpectedTwilioSignature(token, BASE + p, params), 'Content-Type': 'application/x-www-form-urlencoded' };
}
const post = (ctx, p, params, headers) => fetch(ctx.url + p, { method: 'POST', headers, body: new URLSearchParams(params).toString() });

test('/leads: rejects no token, wrong token, wrong scheme; accepts the right one', async () => {
  const ctx = await start();
  storage.saveLead({ phone: '+13175550100', name: 'Jane' });
  assert.strictEqual((await fetch(ctx.url + '/leads')).status, 401);
  assert.strictEqual((await fetch(ctx.url + '/leads', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.strictEqual((await fetch(ctx.url + '/leads', { headers: { Authorization: 'Basic ' + ADMIN } })).status, 401);
  assert.strictEqual((await fetch(ctx.url + '/leads?token=' + ADMIN)).status, 401);
  const ok = await fetch(ctx.url + '/leads', { headers: { Authorization: 'Bearer ' + ADMIN } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await ok.json())[0].name, 'Jane');
  ctx.server.close();
});

test('/leads fails closed when the admin token is unset or weak', async () => {
  for (const ADMIN_API_TOKEN of [undefined, '', 'short']) {
    const ctx = await start({ ADMIN_API_TOKEN });
    assert.strictEqual((await fetch(ctx.url + '/leads', { headers: { Authorization: 'Bearer ' + (ADMIN_API_TOKEN || '') } })).status, 503);
    ctx.server.close();
  }
});

test('webhooks: unsigned, forged and tampered requests are rejected and do nothing', async () => {
  const ctx = await start();
  const p = { From: '+13175550111', Body: 'hi', MessageSid: 'SMforged' };
  assert.strictEqual((await post(ctx, '/webhook/sms', p, {})).status, 403);
  assert.strictEqual((await post(ctx, '/webhook/sms', p, signed('/webhook/sms', p, 'attacker-guessed-token'))).status, 403);
  assert.strictEqual((await post(ctx, '/webhook/sms', { ...p, Body: 'tampered' }, signed('/webhook/sms', p))).status, 403);
  assert.strictEqual((await post(ctx, '/webhook/sms', p, signed('/webhook/missed-call', p))).status, 403); // signature for another path
  const c = { From: '+13175550111', CallStatus: 'no-answer', CallSid: 'CAforged' };
  assert.strictEqual((await post(ctx, '/webhook/missed-call', c, {})).status, 403);
  assert.strictEqual(ctx.sent.length, 0, 'no SMS may be sent for spoofed calls');
  assert.strictEqual(ctx.replies.length, 0, 'AI must not be invoked for spoofed texts');
  assert.deepStrictEqual(storage.getConversation('+13175550111'), []);
  ctx.server.close();
});

test('webhooks fail closed when Twilio token or base URL is not configured', async () => {
  for (const env of [{ TWILIO_AUTH_TOKEN: undefined }, { PUBLIC_BASE_URL: undefined }]) {
    const ctx = await start(env);
    const p = { From: '+13175550112', Body: 'hi', MessageSid: 'SMx' };
    assert.strictEqual((await post(ctx, '/webhook/sms', p, signed('/webhook/sms', p))).status, 503);
    ctx.server.close();
  }
});

test('valid signed SMS is processed once; a Twilio retry (same MessageSid) is ignored', async () => {
  const ctx = await start();
  const p = { From: '+13175550113', Body: 'Need a roof inspection', MessageSid: 'SMgood1' };
  const r1 = await post(ctx, '/webhook/sms', p, signed('/webhook/sms', p));
  assert.strictEqual(r1.status, 200);
  assert.match(await r1.text(), /Hello!/);
  const r2 = await post(ctx, '/webhook/sms', p, signed('/webhook/sms', p));
  assert.strictEqual(r2.status, 200);
  assert.doesNotMatch(await r2.text(), /Hello!/);
  assert.strictEqual(ctx.replies.length, 1);
  assert.strictEqual(storage.getConversation('+13175550113').filter((m) => m.role === 'lead').length, 1);
  // history passed to the model excludes the current message (previously it was sent twice)
  assert.strictEqual(ctx.replies[0].conversationHistory.length, 0);
  assert.strictEqual(ctx.replies[0].isFirstMessage, true);
  ctx.server.close();
});

test('missed call: one text per CallSid; failed send is retryable without double-texting', async () => {
  let fail = true;
  const sent = [];
  const ctx = await start({}, { sendSms: async (m) => { if (fail) throw new Error('twilio down'); sent.push(m); } });
  const c = { From: '+13175550114', CallStatus: 'no-answer', CallSid: 'CAretry' };
  assert.strictEqual((await post(ctx, '/webhook/missed-call', c, signed('/webhook/missed-call', c))).status, 500);
  fail = false;
  assert.strictEqual((await post(ctx, '/webhook/missed-call', c, signed('/webhook/missed-call', c))).status, 200);
  assert.strictEqual((await post(ctx, '/webhook/missed-call', c, signed('/webhook/missed-call', c))).status, 200);
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].body, /Acme/);
  ctx.server.close();
});

test('missed call ignores non-missed statuses', async () => {
  const ctx = await start();
  const c = { From: '+13175550115', CallStatus: 'completed', CallSid: 'CAdone' };
  assert.strictEqual((await post(ctx, '/webhook/missed-call', c, signed('/webhook/missed-call', c))).status, 200);
  assert.strictEqual(ctx.sent.length, 0);
  ctx.server.close();
});

test('logs do not contain full phone numbers or message bodies', async () => {
  const lines = [];
  const log = { log: (...a) => lines.push(a.join(' ')), warn() {}, error() {} };
  const ctx = await start({}, { log });
  const p = { From: '+13175550116', Body: 'my secret message', MessageSid: 'SMlog' };
  await post(ctx, '/webhook/sms', p, signed('/webhook/sms', p));
  const out = lines.join('\n');
  assert.doesNotMatch(out, /13175550116/);
  assert.doesNotMatch(out, /secret message/);
  ctx.server.close();
});
