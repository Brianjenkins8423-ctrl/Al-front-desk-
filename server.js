// AI Front Desk — main server
// Handles: incoming SMS, missed calls (auto-text-back), and AI-generated replies.

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { generateReply } = require('./claude-agent');
const { saveMessage, getConversation, saveLead, isNewConversation } = require('./storage');
const businessConfig = require('./config/business-config.json');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ---------------------------------------------------------------------------
// 1) INCOMING SMS — a lead texts the business number
// ---------------------------------------------------------------------------
app.post('/webhook/sms', async (req, res) => {
  try {
    const from = req.body.From;       // lead's phone number
    const to = req.body.To;           // your Twilio business number
    const body = (req.body.Body || '').trim();

    console.log(`[SMS IN] ${from}: ${body}`);

    saveMessage(from, 'lead', body);

    const conversation = getConversation(from);
    const firstTouch = isNewConversation(from);

    const aiReply = await generateReply({
      businessConfig,
      conversationHistory: conversation,
      incomingMessage: body,
      isFirstMessage: firstTouch,
    });

    saveMessage(from, 'ai', aiReply.text);

    if (aiReply.bookingDetected) {
      saveLead({
        phone: from,
        name: aiReply.leadName || 'Unknown',
        requestedService: aiReply.serviceRequested || 'Unspecified',
        preferredTime: aiReply.preferredTime || 'Unspecified',
        notes: aiReply.notes || '',
        source: 'SMS',
        timestamp: new Date().toISOString(),
      });
      console.log(`[LEAD CAPTURED] ${from}`);
      // Optional: trigger an email/SMS notification to the business owner here.
    }

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(aiReply.text);
    res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('Error handling incoming SMS:', err);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Thanks for reaching out! We're having a technical hiccup — someone from our team will text you back shortly.");
    res.type('text/xml').send(twiml.toString());
  }
});

// ---------------------------------------------------------------------------
// 2) MISSED CALL — Twilio call-status webhook fires when a call isn't answered
//    Set this URL as the "Status Callback" on your Twilio number's Voice config,
//    OR as the fallback/no-answer action on your call-forwarding flow.
// ---------------------------------------------------------------------------
app.post('/webhook/missed-call', async (req, res) => {
  try {
    const callerNumber = req.body.From;
    const callStatus = req.body.CallStatus; // 'no-answer', 'busy', 'failed'

    console.log(`[CALL] ${callerNumber} status: ${callStatus}`);

    if (['no-answer', 'busy', 'failed'].includes(callStatus)) {
      const missedCallText = businessConfig.missedCallMessage
        .replace('{business_name}', businessConfig.businessName);

      await twilioClient.messages.create({
        body: missedCallText,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: callerNumber,
      });

      saveMessage(callerNumber, 'ai', missedCallText);
      console.log(`[AUTO-TEXT SENT] to ${callerNumber}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Error handling missed call:', err);
    res.sendStatus(200); // always 200 so Twilio doesn't retry loop
  }
});

// ---------------------------------------------------------------------------
// 3) Simple dashboard endpoint to see captured leads (for the business owner)
// ---------------------------------------------------------------------------
app.get('/leads', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const leadsFile = path.join(__dirname, 'data', 'leads.json');
  if (!fs.existsSync(leadsFile)) return res.json([]);
  res.json(JSON.parse(fs.readFileSync(leadsFile, 'utf-8')));
});

app.get('/', (req, res) => {
  res.send(`AI Front Desk is running for ${businessConfig.businessName}. Webhook endpoints: /webhook/sms and /webhook/missed-call`);
});

app.listen(PORT, () => {
  console.log(`AI Front Desk server running on port ${PORT}`);
});
