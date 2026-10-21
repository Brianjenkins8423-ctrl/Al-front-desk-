#!/usr/bin/env node
// Read-only verification of the dispatch integration against the REAL GoHighLevel account.
// Uses GhlClient with writesEnabled=false, so it cannot create, change, or message anything.
//
//   GHL_PRIVATE_INTEGRATION_TOKEN=pit-... node scripts/ghl-live-readcheck.js [calendarId]
// (In Claude Code cloud sessions the platform proxy supplies auth; no token is needed.)

const ghlConfig = require('../config/ghl-dispatch.json');
const { GhlClient, GhlWritesDisabled } = require('../dispatch/ghl-client');

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
  }
}

(async () => {
  const ghl = new GhlClient({ locationId: ghlConfig.locationId, writesEnabled: false });
  const calendarId = process.argv[2] || 'KSZo5xzjW4eX7Iob3I6N';
  const day = 86400e3;
  const start = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') + day;

  await check('write guard: createAppointment refused before any network call', async () => {
    try { await ghl.createAppointment({}); } catch (e) { if (e instanceof GhlWritesDisabled) return 'blocked as designed'; throw e; }
    throw new Error('write was NOT blocked');
  });
  await check('calendar readable', async () => {
    const c = await ghl.getCalendar(calendarId);
    return `${c.name} (${c.slotDuration} ${c.slotDurationUnit || 'min'} slots, ${c.calendarType})`;
  });
  await check('free-slots readable (authoritative availability)', async () => {
    const slots = await ghl.getFreeSlots(calendarId, start, start + 3 * day, ghlConfig.timezone);
    if (!slots.length) throw new Error('no slots returned');
    return `${slots.length} slots, first ${slots[0]}`;
  });
  await check('calendar events readable (conflict cross-check)', async () => {
    const ev = await ghl.getEvents(calendarId, start, start + 3 * day);
    return `${ev.length} events in window`;
  });
  await check('configured pipeline + all 8 stage ids exist in live GHL', async () => {
    const json = await ghl._request('GET', '/opportunities/pipelines', { query: { locationId: ghl.locationId }, version: '2021-07-28' });
    const p = json.pipelines.find((x) => x.id === ghlConfig.pipeline.id);
    if (!p) throw new Error('pipeline not found');
    const live = new Set(p.stages.map((s) => s.id));
    const missing = Object.entries(ghlConfig.pipeline.stages).filter(([, id]) => !live.has(id)).map(([k]) => k);
    if (missing.length) throw new Error(`stage ids missing in GHL: ${missing.join(', ')}`);
    return `${p.name}: ${p.stages.length} stages, all mapped ids present`;
  });
  await check('opportunity search readable', async () => {
    const json = await ghl._request('GET', '/opportunities/search', { query: { location_id: ghl.locationId, pipeline_id: ghlConfig.pipeline.id, limit: 1 }, version: '2021-07-28' });
    return `${(json.opportunities || []).length} returned (total ${json.meta && json.meta.total})`;
  });
  await check('custom fields readable (needs locations/customFields.readonly scope)', async () => {
    const json = await ghl._request('GET', `/locations/${ghl.locationId}/customFields`);
    return `${(json.customFields || []).length} fields`;
  });
  await check('users readable (needed for technician mapping; users.readonly scope)', async () => {
    const json = await ghl._request('GET', '/users/', { query: { locationId: ghl.locationId } });
    return `${(json.users || []).length} users`;
  });

  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
