// secrets.js — startup validation of configuration and log redaction.
// Reports problems by variable NAME only; values are never printed.

const REQUIRED = {
  always: ['ANTHROPIC_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'PUBLIC_BASE_URL', 'ADMIN_API_TOKEN'],
  dispatch: ['DISPATCH_WEBHOOK_SECRETS', 'DISPATCH_DB_PATH', 'GHL_PRIVATE_INTEGRATION_TOKEN', 'GHL_CALENDAR_ID'],
};
const MIN_LENGTH = { ADMIN_API_TOKEN: 24 };

function validateEnv(env = process.env) {
  const names = [...REQUIRED.always, ...(env.DISPATCH_ENABLED === 'true' ? REQUIRED.dispatch : [])];
  const problems = [];
  for (const n of names) {
    if (!env[n]) problems.push(`${n} is not set`);
    else if (MIN_LENGTH[n] && env[n].length < MIN_LENGTH[n]) problems.push(`${n} is shorter than ${MIN_LENGTH[n]} characters`);
  }
  if (env.PUBLIC_BASE_URL && !/^https:\/\//.test(env.PUBLIC_BASE_URL)) problems.push('PUBLIC_BASE_URL must start with https://');
  if (env.DISPATCH_ENABLED === 'true' && env.DISPATCH_DB_PATH === ':memory:') problems.push('DISPATCH_DB_PATH must be a persistent file (use a mounted volume), not :memory:');
  return problems;
}

const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'TWILIO_AUTH_TOKEN', 'ADMIN_API_TOKEN', 'GHL_PRIVATE_INTEGRATION_TOKEN', 'DISPATCH_WEBHOOK_SECRETS'];

// Replaces any configured secret value appearing in text (e.g. an error message) with [REDACTED].
function redact(text, env = process.env) {
  let out = String(text);
  for (const n of SECRET_NAMES) {
    const v = env[n];
    if (v && v.length >= 8) out = out.split(v).join('[REDACTED]');
  }
  return out;
}

module.exports = { validateEnv, redact };
