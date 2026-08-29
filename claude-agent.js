// claude-agent.js
// Talks to the Anthropic API to generate the AI Front Desk's replies,
// and extracts structured booking info when a lead is ready to schedule.

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function buildSystemPrompt(businessConfig) {
  return `You are the front-desk assistant for ${businessConfig.businessName}, a ${businessConfig.niche} business.

Business info:
- Services offered: ${businessConfig.services.join(', ')}
- Service area: ${businessConfig.serviceArea}
- Business hours: ${businessConfig.hours}
- Tone: ${businessConfig.tone}

Your job:
1. Respond quickly, warmly, and professionally to texts from potential customers.
2. Answer basic questions about services, pricing ranges, and availability using ONLY the info given above. If you don't know something, say a team member will follow up with exact details.
3. Your main goal is to get three things from the lead: their name, what service they need, and a preferred day/time for a callback or appointment.
4. Once you have all three, confirm the details back to them and let them know the team will reach out to finalize.
5. Keep every message under 320 characters (SMS length). No markdown, no emojis unless the business tone says otherwise.

After your reply, on a new line, output a JSON object (and nothing else after it) in this exact format:
{"booking_detected": true or false, "lead_name": "string or null", "service_requested": "string or null", "preferred_time": "string or null", "notes": "string or null"}

Set booking_detected to true only once you have captured at least the service requested AND some indication of timing or contact preference.`;
}

async function generateReply({ businessConfig, conversationHistory, incomingMessage, isFirstMessage }) {
  const systemPrompt = buildSystemPrompt(businessConfig);

  const messages = conversationHistory.map((m) => ({
    role: m.role === 'lead' ? 'user' : 'assistant',
    content: m.text,
  }));

  messages.push({ role: 'user', content: incomingMessage });

  const greetingNote = isFirstMessage
    ? '\n\nThis is the first message in the conversation — greet them briefly and ask how you can help.'
    : '';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    system: systemPrompt + greetingNote,
    messages,
  });

  const rawText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return parseAgentOutput(rawText);
}

function parseAgentOutput(rawText) {
  // The model is instructed to put a JSON object on its own line after the reply.
  const jsonMatch = rawText.match(/\{[\s\S]*\}\s*$/);
  let structured = { booking_detected: false, lead_name: null, service_requested: null, preferred_time: null, notes: null };
  let replyText = rawText;

  if (jsonMatch) {
    replyText = rawText.slice(0, jsonMatch.index).trim();
    try {
      structured = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn('Could not parse structured JSON from model output, defaulting to no booking.');
    }
  }

  return {
    text: replyText,
    bookingDetected: !!structured.booking_detected,
    leadName: structured.lead_name,
    serviceRequested: structured.service_requested,
    preferredTime: structured.preferred_time,
    notes: structured.notes,
  };
}

module.exports = { generateReply };
