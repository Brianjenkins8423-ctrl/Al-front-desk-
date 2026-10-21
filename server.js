// AI Front Desk — entry point. All logic lives in app.js (see there for the security model).

require('dotenv').config();
const twilio = require('twilio');
const { createApp } = require('./app');
const { generateReply } = require('./claude-agent');
const storage = require('./storage');
const businessConfig = require('./config/business-config.json');

const PORT = process.env.PORT || 3000;
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = createApp({
  storage,
  generateReply,
  businessConfig,
  sendSms: ({ to, body }) => twilioClient.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to }),
});

app.listen(PORT, () => {
  console.log(`AI Front Desk server running on port ${PORT}`);
});
