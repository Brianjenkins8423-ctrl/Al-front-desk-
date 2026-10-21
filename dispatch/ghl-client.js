// dispatch/ghl-client.js
// Minimal GoHighLevel REST client (services.leadconnectorhq.com).
//
// Safety properties:
//  * Every call is bound to ONE locationId; ids from other locations are refused.
//  * Writes are disabled unless `writesEnabled: true`. With them off, write methods throw
//    GhlWritesDisabled before any network call, so tests/dry runs cannot touch live data.
//  * Reads retry on 429/5xx/network errors with backoff. Writes are NEVER retried inside the
//    client (a retried POST could double-create); callers use the outbox plus search-before-create.
//  * The token is read from the environment or injected by the platform proxy; it is never logged.

class GhlError extends Error {
  constructor(message, { status = 0, retryable = false, body } = {}) {
    super(message);
    this.name = 'GhlError';
    this.status = status;
    this.retryable = retryable; // true: outcome unknown or transient, safe to retry later
    this.body = body;
  }
}
class GhlWritesDisabled extends GhlError {}

const VERSIONS = { default: '2021-04-15', opportunities: '2021-07-28' };

class GhlClient {
  constructor({
    locationId,
    token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN, // optional in cloud sessions: the proxy injects auth
    baseUrl = 'https://services.leadconnectorhq.com',
    fetchImpl = globalThis.fetch,
    timeoutMs = 10000,
    readRetries = 2,
    writesEnabled = false,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  }) {
    if (!locationId) throw new Error('locationId is required');
    Object.assign(this, { locationId, token, baseUrl: baseUrl.replace(/\/+$/, ''), fetchImpl, timeoutMs, readRetries, writesEnabled, sleep });
  }

  async _request(method, path, { query, body, version = VERSIONS.default } = {}) {
    const isWrite = method !== 'GET';
    if (isWrite && !this.writesEnabled) throw new GhlWritesDisabled(`GHL writes are disabled (${method} ${path})`);
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Accept: 'application/json', Version: version };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const attempts = isWrite ? 1 : this.readRetries + 1;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await this.sleep(Math.min(500 * 2 ** (i - 1), 4000));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
        const text = await res.text();
        let json;
        try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 200) }; }
        if (res.ok) return json;
        // 5xx/429: transient (and for writes, outcome unknown). 4xx: definite refusal.
        const retryable = res.status === 429 || res.status >= 500;
        lastErr = new GhlError(`GHL ${method} ${path} -> ${res.status}: ${json.message || json.error || 'error'}`, { status: res.status, retryable, body: json });
        if (!retryable) throw lastErr;
      } catch (err) {
        if (err instanceof GhlError && !err.retryable) throw err;
        lastErr = err instanceof GhlError ? err : new GhlError(`GHL ${method} ${path} failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`, { retryable: true });
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  // ---- reads ------------------------------------------------------------------------------
  // Authoritative availability. Returns ISO start times, e.g. "2026-10-22T09:00:00-04:00".
  async getFreeSlots(calendarId, startMs, endMs, timezone) {
    const json = await this._request('GET', `/calendars/${calendarId}/free-slots`, { query: { startDate: startMs, endDate: endMs, timezone } });
    return Object.entries(json)
      .filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && v && Array.isArray(v.slots))
      .flatMap(([, v]) => v.slots);
  }

  async getCalendar(calendarId) {
    const json = await this._request('GET', `/calendars/${calendarId}`);
    return json.calendar || json;
  }

  async getEvents(calendarId, startMs, endMs) {
    const json = await this._request('GET', '/calendars/events', { query: { locationId: this.locationId, calendarId, startTime: startMs, endTime: endMs } });
    return json.events || [];
  }

  async getAppointment(eventId) {
    const json = await this._request('GET', `/calendars/events/appointments/${eventId}`);
    return json.event || json.appointment || json;
  }

  async getContact(contactId) {
    const json = await this._request('GET', `/contacts/${contactId}`);
    const c = json.contact || json;
    if (c.locationId && c.locationId !== this.locationId) throw new GhlError('Contact belongs to a different location');
    return c;
  }

  async searchOpportunities({ pipelineId, contactId }) {
    const json = await this._request('GET', '/opportunities/search', {
      version: VERSIONS.opportunities,
      query: { location_id: this.locationId, pipeline_id: pipelineId, contact_id: contactId },
    });
    return json.opportunities || [];
  }

  async getOpportunity(id) {
    const json = await this._request('GET', `/opportunities/${id}`, { version: VERSIONS.opportunities });
    return json.opportunity || json;
  }

  // ---- writes (disabled unless writesEnabled) -----------------------------------------------
  // GHL de-duplicates on the location's contactUniqueIdentifiers (email, phone), so upsert is safe to repeat.
  async upsertContact({ firstName, lastName, phone, email }) {
    const json = await this._request('POST', '/contacts/upsert', { body: { locationId: this.locationId, firstName, lastName, phone, email } });
    return json.contact || json;
  }

  async createOpportunity({ pipelineId, pipelineStageId, contactId, name }) {
    const json = await this._request('POST', '/opportunities/', {
      version: VERSIONS.opportunities,
      body: { locationId: this.locationId, pipelineId, pipelineStageId, contactId, name, status: 'open' },
    });
    return json.opportunity || json;
  }

  async moveOpportunity(id, pipelineStageId) {
    const json = await this._request('PUT', `/opportunities/${id}`, { version: VERSIONS.opportunities, body: { pipelineStageId } });
    return json.opportunity || json;
  }

  // ignoreFreeSlotValidation is deliberately NOT sent: GHL itself rejects a taken slot,
  // which makes GHL the atomic authority even if two systems race.
  async createAppointment({ calendarId, contactId, startTime, endTime, title }) {
    const json = await this._request('POST', '/calendars/events/appointments', {
      body: { calendarId, locationId: this.locationId, contactId, startTime, endTime, title, appointmentStatus: 'confirmed', toNotify: false },
    });
    return json.event || json;
  }

  async cancelAppointment(eventId) {
    return this._request('PUT', `/calendars/events/appointments/${eventId}`, { body: { appointmentStatus: 'cancelled', toNotify: false } });
  }
}

module.exports = { GhlClient, GhlError, GhlWritesDisabled };
