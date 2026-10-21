// app.js — AI Front Desk HTTP app (factory, so it can be tested without real credentials).
// Security model:
//   * /webhook/*  require a valid Twilio signature (X-Twilio-Signature). Fail closed if unset.
//   * /leads      requires a bearer token (ADMIN_API_TOKEN). Fail closed if unset.
//   * Twilio retries (same MessageSid / CallSid) are processed once.

const crypto = require('crypto');
const express = require('express');
const twilio = require('twilio');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function maskPhone(p) {
  const s = String(p || '');
  return s.length > 4 ? `***${s.slice(-4)}` : '***';
}

function createApp({ env = process.env, storage, generateReply, sendSms, businessConfig, dispatch = null, log = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.json({ limit: '20kb' }));

  // --- Twilio signature check -------------------------------------------------
  // The URL Twilio signed is the public one, so it comes from PUBLIC_BASE_URL (not from
  // request headers, which a caller can forge).
  function requireTwilioSignature(req, res, next) {
    const authToken = env.TWILIO_AUTH_TOKEN;
    const base = env.PUBLIC_BASE_URL;
    if (!authToken || !base) {
      log.error('[SECURITY] TWILIO_AUTH_TOKEN or PUBLIC_BASE_URL not set: rejecting webhook');
      return res.status(503).send('Webhook not configured');
    }
    const signature = req.get('X-Twilio-Signature');
    const url = base.replace(/\/+$/, '') + req.originalUrl;
    if (!signature || !twilio.validateRequest(authToken, signature, url, req.body || {})) {
      log.warn(`[SECURITY] Rejected webhook with invalid signature: ${req.path}`);
      return res.status(403).send('Invalid signature');
    }
    next();
  }

  // --- Admin bearer token -----------------------------------------------------
  function requireAdmin(req, res, next) {
    const token = env.ADMIN_API_TOKEN;
    if (!token || token.length < 24) {
      log.error('[SECURITY] ADMIN_API_TOKEN missing or shorter than 24 chars: /leads disabled');
      return res.status(503).json({ error: 'Not configured' });
    }
    const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
    if (!m || !safeEqual(m[1], token)) {
      res.set('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  const twiml = (text) => {
    const r = new twilio.twiml.MessagingResponse();
    if (text) r.message(text);
    return r.toString();
  };

  app.post('/webhook/sms', requireTwilioSignature, async (req, res) => {
    const from = req.body.From;
    const body = (req.body.Body || '').trim();
    const sid = req.body.MessageSid;
    try {
      if (!from) return res.status(400).send('Missing From');
      if (sid && !storage.markProcessed(`sms:${sid}`)) {
        log.log(`[SMS DUP] ${sid} already processed`);
        return res.type('text/xml').send(twiml(null));
      }
      log.log(`[SMS IN] ${maskPhone(from)}: ${body.length} chars`);
      storage.saveMessage(from, 'lead', body);
      const conversation = storage.getConversation(from);
      const aiReply = await generateReply({
        businessConfig,
        conversationHistory: conversation.slice(0, -1),
        incomingMessage: body,
        isFirstMessage: conversation.length <= 1,
      });
      storage.saveMessage(from, 'ai', aiReply.text);
      if (aiReply.bookingDetected) {
        storage.saveLead({
          phone: from,
          name: aiReply.leadName || 'Unknown',
          requestedService: aiReply.serviceRequested || 'Unspecified',
          preferredTime: aiReply.preferredTime || 'Unspecified',
          notes: aiReply.notes || '',
          source: 'SMS',
          timestamp: new Date().toISOString(),
        });
        log.log(`[LEAD CAPTURED] ${maskPhone(from)}`);
      }
      res.type('text/xml').send(twiml(aiReply.text));
    } catch (err) {
      log.error('Error handling incoming SMS:', err.message);
      res.type('text/xml').send(twiml("Thanks for reaching out! We're having a technical hiccup — someone from our team will text you back shortly."));
    }
  });

  app.post('/webhook/missed-call', requireTwilioSignature, async (req, res) => {
    const callerNumber = req.body.From;
    const callStatus = req.body.CallStatus;
    const sid = req.body.CallSid;
    try {
      if (!['no-answer', 'busy', 'failed'].includes(callStatus) || !callerNumber) return res.sendStatus(200);
      if (sid && !storage.markProcessed(`call:${sid}`)) return res.sendStatus(200);
      const text = businessConfig.missedCallMessage.replace('{business_name}', businessConfig.businessName);
      try {
        await sendSms({ to: callerNumber, body: text });
      } catch (err) {
        if (sid) storage.unmarkProcessed(`call:${sid}`); // let Twilio's retry try again
        throw err;
      }
      storage.saveMessage(callerNumber, 'ai', text);
      log.log(`[AUTO-TEXT SENT] to ${maskPhone(callerNumber)}`);
      res.sendStatus(200);
    } catch (err) {
      log.error('Error handling missed call:', err.message);
      res.sendStatus(500); // non-2xx so Twilio retries; the CallSid guard prevents double texts
    }
  });

  // Dispatch API: only mounted when explicitly provided (DISPATCH_ENABLED=true in server.js).
  if (dispatch) {
    const { createDispatchRouter } = require('./dispatch/routes');
    app.use('/dispatch', createDispatchRouter({ services: dispatch.services, secrets: dispatch.secrets, requireAdmin, log }));
  }

  app.get('/leads', requireAdmin, (req, res) => res.json(storage.getLeads()));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.get('/', (req, res) => res.send('AI Front Desk is running.'));

  return app;
}

module.exports = { createApp, safeEqual, maskPhone };
