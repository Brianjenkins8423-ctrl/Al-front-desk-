// storage.js
// Zero-setup storage using local JSON files. Good enough for one client's volume.
// When you're ready to scale across many clients, swap this for a real database
// (e.g. Postgres on Railway/Supabase) — the function signatures below can stay the same.
//
// Writes are atomic (temp file + rename) so a crash cannot leave a half-written file.
// DATA_DIR can be overridden (tests; Railway volume mount).

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const PROCESSED_FILE = path.join(DATA_DIR, 'processed.json');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONVERSATIONS_FILE)) fs.writeFileSync(CONVERSATIONS_FILE, '{}');
  if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]');
  if (!fs.existsSync(PROCESSED_FILE)) fs.writeFileSync(PROCESSED_FILE, '{}');
}

function readJSON(file) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJSON(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function isNewConversation(phoneNumber) {
  const all = readJSON(CONVERSATIONS_FILE);
  return !all[phoneNumber] || all[phoneNumber].length === 0;
}

function getConversation(phoneNumber) {
  const all = readJSON(CONVERSATIONS_FILE);
  return all[phoneNumber] || [];
}

function saveMessage(phoneNumber, role, text) {
  const all = readJSON(CONVERSATIONS_FILE);
  if (!all[phoneNumber]) all[phoneNumber] = [];
  all[phoneNumber].push({ role, text, timestamp: new Date().toISOString() });
  writeJSON(CONVERSATIONS_FILE, all);
}

function saveLead(lead) {
  const leads = readJSON(LEADS_FILE);
  leads.push(lead);
  writeJSON(LEADS_FILE, leads);
}

function getLeads() {
  return readJSON(LEADS_FILE);
}

// Webhook idempotency: returns true the first time a key is seen, false on a repeat.
// Synchronous read-modify-write, so safe within one Node process.
function markProcessed(key) {
  const seen = readJSON(PROCESSED_FILE);
  if (seen[key]) return false;
  seen[key] = new Date().toISOString();
  const keys = Object.keys(seen);
  if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete seen[k];
  writeJSON(PROCESSED_FILE, seen);
  return true;
}

function unmarkProcessed(key) {
  const seen = readJSON(PROCESSED_FILE);
  delete seen[key];
  writeJSON(PROCESSED_FILE, seen);
}

module.exports = { getConversation, saveMessage, saveLead, getLeads, isNewConversation, markProcessed, unmarkProcessed };
