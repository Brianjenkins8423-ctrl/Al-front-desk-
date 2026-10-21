// AI Front Desk — entry point. All logic lives in app.js (see there for the security model).

require('dotenv').config();
const twilio = require('twilio');
const { createApp } = require('./app');
const { generateReply } = require('./claude-agent');
const storage = require('./storage');
const businessConfig = require('./config/business-config.json');
const { validateEnv, redact } = require('./secrets');

const PORT = process.env.PORT || 3000;
for (const problem of validateEnv()) console.error(`[CONFIG] ${problem}`);

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Dispatch is OFF unless DISPATCH_ENABLED=true. Even then, nothing is written to GHL unless
// GHL_WRITES_ENABLED=true, and staff notifications are a stub that fails loudly (jobs retry, then
// raise an alert) until a real notifier is supplied.
let dispatch = null;
if (process.env.DISPATCH_ENABLED === 'true') {
  const { DispatchCore } = require('./dispatch/dispatch-core');
  const { GhlClient } = require('./dispatch/ghl-client');
  const { DispatchService } = require('./dispatch/service');
  const { startWorker } = require('./dispatch/worker');
  const { parseSecrets } = require('./dispatch/routes');
  const ghlConfig = require('./config/ghl-dispatch.json');

  const core = new DispatchCore(process.env.DISPATCH_DB_PATH);
  const ghl = new GhlClient({ locationId: ghlConfig.locationId, writesEnabled: process.env.GHL_WRITES_ENABLED === 'true' });
  const service = new DispatchService({
    core,
    ghl,
    calendarId: process.env.GHL_CALENDAR_ID,
    notifier: { send: async () => { throw new Error('No staff notifier configured'); } },
    alerter: { send: async (a) => console.error('[DISPATCH ALERT]', redact(JSON.stringify(a))) },
  });
  dispatch = { services: { [ghlConfig.locationId]: service }, secrets: parseSecrets(process.env.DISPATCH_WEBHOOK_SECRETS) };
  startWorker({ service });
  console.log(`[DISPATCH] enabled; GHL writes ${ghl.writesEnabled ? 'ENABLED' : 'disabled'}`);
}

const app = createApp({
  storage,
  generateReply,
  businessConfig,
  dispatch,
  sendSms: ({ to, body }) => twilioClient.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to }),
});

app.listen(PORT, () => {
  console.log(`AI Front Desk server running on port ${PORT}`);
});
