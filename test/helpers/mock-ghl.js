// Local stand-in for the GHL REST API, with fault injection. It mimics the behaviours the
// dispatcher depends on (slot validation on create, 4xx on a taken slot, auth header, location
// scoping). It is NOT GHL: results from it prove our client/service logic, not GHL's behaviour.

const http = require('http');
const crypto = require('crypto');

const DAY = '2026-10-22';
const SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00'].map((t) => `${DAY}T${t}:00-04:00`);

function createMockGhl({ locationId, calendarId = 'CAL1', token = 'test-token' }) {
  const state = {
    events: [],
    opportunities: [],
    log: [],
    faults: {}, // { 'POST /calendars/events/appointments': ['timeout', '500', 'commit-then-500', 'down'] }
  };

  const slotTaken = (iso) => state.events.some((e) => e.appointmentStatus !== 'cancelled' && Date.parse(e.startTime) === Date.parse(iso));

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const key = `${req.method} ${url.pathname}`;
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    state.log.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: json, auth: req.headers.authorization });
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { statusCode: 401, message: 'Invalid token' });

    const fault = (state.faults[key] || []).shift();
    if (fault === 'timeout') return; // never answer: client must time out
    if (fault === '500') return send(500, { message: 'boom' });
    if (fault === 'down') return send(503, { message: 'unavailable' });

    const p = url.pathname;
    if (req.method === 'GET' && p === `/calendars/${calendarId}`) return send(200, { calendar: { id: calendarId, slotDuration: 30, locationId } });
    if (req.method === 'GET' && p === `/calendars/${calendarId}/free-slots`) return send(200, { [DAY]: { slots: SLOTS.filter((s) => !slotTaken(s)) } });
    if (req.method === 'GET' && p === '/calendars/events') {
      if (url.searchParams.get('locationId') !== locationId) return send(403, { message: 'wrong location' });
      return send(200, { events: state.events });
    }
    let m;
    if ((m = p.match(/^\/calendars\/events\/appointments\/(.+)$/))) {
      const ev = state.events.find((e) => e.id === m[1]);
      if (!ev) return send(404, { message: 'not found' });
      if (req.method === 'GET') return send(200, { event: ev });
      if (req.method === 'PUT') { Object.assign(ev, { appointmentStatus: json.appointmentStatus }); return send(200, { event: ev }); }
    }
    if (req.method === 'POST' && p === '/calendars/events/appointments') {
      if (json.locationId !== locationId) return send(403, { message: 'wrong location' });
      if (slotTaken(json.startTime)) return send(400, { message: 'The slot you have selected is no longer available' });
      const ev = { id: 'EV' + crypto.randomBytes(8).toString('hex'), calendarId: json.calendarId, contactId: json.contactId, startTime: json.startTime, endTime: json.endTime, appointmentStatus: json.appointmentStatus };
      state.events.push(ev); // committed
      if (fault === 'commit-then-500') return send(500, { message: 'lost response' });
      return send(201, ev);
    }
    if (req.method === 'GET' && p === '/opportunities/search') {
      return send(200, { opportunities: state.opportunities.filter((o) => o.contactId === url.searchParams.get('contact_id') && o.pipelineId === url.searchParams.get('pipeline_id')) });
    }
    if (req.method === 'POST' && p === '/opportunities/') {
      const o = { id: 'OP' + crypto.randomBytes(8).toString('hex'), status: 'open', ...json };
      state.opportunities.push(o);
      return send(201, { opportunity: o });
    }
    if ((m = p.match(/^\/opportunities\/(.+)$/))) {
      const o = state.opportunities.find((x) => x.id === m[1]);
      if (!o) return send(404, { message: 'not found' });
      if (req.method === 'PUT') Object.assign(o, json);
      return send(200, { opportunity: o });
    }
    return send(404, { message: `unmocked ${key}` });
  }

  const server = http.createServer((req, res) => handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }));
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({
      state, token, calendarId, slots: SLOTS,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      close: () => { server.closeAllConnections(); server.close(); },
      writes: () => state.log.filter((l) => l.method !== 'GET'),
    }))
  );
}

module.exports = { createMockGhl, SLOTS };
