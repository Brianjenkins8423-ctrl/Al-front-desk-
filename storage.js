// storage.js
// Zero-setup storage using local JSON files. Good enough for one client's volume.
// When you're ready to scale across many clients, swap this for a real database
// (e.g. Postgres on Railway/Supabase) — the function signatures below can stay the same.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONVERSATIONS_FILE)) fs.writeFileSync(CONVERSATIONS_FILE, '{}');
  if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]');
}

function readJSON(file) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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

module.exports = { getConversation, saveMessage, saveLead, isNewConversation };
