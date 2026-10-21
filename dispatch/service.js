// dispatch/service.js
// Orchestrates the dispatch core, the GHL client, notifications and the retry outbox.
//
// End-to-end flow:
//   intake -> (outbox) ensure GHL opportunity -> verifyAndBook (live GHL availability, then GHL
//   create-appointment, which re-validates the slot) -> markSynced -> (outbox) stage sync
//   -> assign technician -> acknowledgment / escalation clock -> reconcile against GHL.
//
// Nothing here sends to customers. Staff and customer messages go through the injected
// `notifier`, which is a stub unless the caller supplies a real one.

const ghlConfig = require('../config/ghl-dispatch.json');
const { DispatchError, SlotUnavailable, toUtc } = require('./dispatch-core');
const { GhlError, GhlWritesDisabled } = require('./ghl-client');
const { stageForStatus } = require('./ghl-adapter');

class ServiceUnavailable extends DispatchError {}

const STAGE_FOR_EXCEPTION = ghlConfig.pipeline.stages.exceptionReconcile;

class DispatchService {
  constructor({ core, ghl, notifier, alerter, calendarId, log = console, now = () => new Date().toISOString() }) {
    if (ghl.locationId !== ghlConfig.locationId && !ghl.allowOtherLocation) {
      // The stage ids in config belong to one location; refuse to run against another.
      throw new Error(`GHL client location ${ghl.locationId} does not match configured location ${ghlConfig.locationId}`);
    }
    Object.assign(this, { core, ghl, notifier, alerter, calendarId, log, now, tenant: ghl.locationId });
  }

  // ---- intake -----------------------------------------------------------------------------
  intake(args, { contactId } = {}) {
    if (args.tenant !== this.tenant) throw new DispatchError('Tenant does not match this service');
    const res = this.core.intake(args);
    if (contactId) this.core.setRef(this.tenant, res.id, 'ghl_contact', contactId);
    // Durable: the opportunity is created/synced by the outbox worker with retries.
    this.core.enqueue(this.tenant, res.id, 'ghl.sync_stage', { rid: res.id }, `stage:${res.id}:${this.core.state(this.tenant, res.id).status}`);
    return res;
  }

  // ---- booking: only after live availability is verified ------------------------------------
  async verifyAndBook({ rid, start, end, title = 'Service appointment' }) {
    const startUtc = toUtc(start, 'start');
    const endUtc = toUtc(end, 'end');
    const contactId = this.core.getRef(this.tenant, rid, 'ghl_contact');
    if (!contactId) throw new DispatchError('Request has no GHL contact; cannot create an appointment');

    // 1) Authoritative availability (read-only, retried). Fails closed if GHL cannot be reached.
    let calendar, slots;
    try {
      calendar = await this.ghl.getCalendar(this.calendarId);
      const from = Date.parse(startUtc) - 3600e3;
      slots = await this.ghl.getFreeSlots(this.calendarId, from, Date.parse(endUtc) + 3600e3, ghlConfig.timezone);
    } catch (err) {
      throw new ServiceUnavailable(`Cannot verify availability right now: ${err.message}`);
    }
    const wanted = Date.parse(startUtc);
    if (!slots.some((s) => Date.parse(s) === wanted)) throw new SlotUnavailable('That time is not available on the calendar');
    const minutes = (Date.parse(endUtc) - wanted) / 60000;
    if (calendar.slotDuration && minutes !== Number(calendar.slotDuration)) {
      throw new DispatchError(`Appointment must be ${calendar.slotDuration} minutes for this calendar`);
    }

    // 2) Local reservation (serialises our own concurrent attempts; emergencies are refused here).
    const created = this.core.book(this.tenant, rid, { resource: this.calendarId, start: startUtc, end: endUtc, availabilityVerified: true });
    if (!created) return { status: this.core.syncState(this.tenant, rid).sync_state === 'synced' ? 'confirmed' : 'pending_sync', created: false };

    // 3) GHL creates the appointment and re-validates the slot.
    const payload = { rid, calendarId: this.calendarId, contactId, startTime: startUtc, endTime: endUtc, title };
    try {
      const ev = await this.ghl.createAppointment(payload);
      this.core.markSynced(this.tenant, rid, ev.id);
      this.core.enqueue(this.tenant, rid, 'ghl.sync_stage', { rid }, `stage:${rid}:confirmed`);
      return { status: 'confirmed', created: true, externalId: ev.id };
    } catch (err) {
      if (err instanceof GhlError && !err.retryable && !(err instanceof GhlWritesDisabled)) {
        this.core.releaseBooking(this.tenant, rid, `calendar refused: ${err.message}`);
        throw new SlotUnavailable('The calendar rejected that time');
      }
      // Outcome unknown (timeout / 5xx / writes disabled): keep the hold, retry durably.
      this.core.enqueue(this.tenant, rid, 'ghl.create_appointment', payload, `appt:${rid}:${startUtc}`);
      return { status: 'pending_sync', created: true };
    }
  }

  cancel(rid) {
    const sync = this.core.syncState(this.tenant, rid);
    const done = this.core.cancel(this.tenant, rid);
    if (done && sync && sync.external_id) this.core.enqueue(this.tenant, rid, 'ghl.cancel_appointment', { externalId: sync.external_id }, `cancel:${rid}`);
    if (done) this.core.enqueue(this.tenant, rid, 'ghl.sync_stage', { rid }, `stage:${rid}:cancelled`);
    return done;
  }

  // What the customer may be told. "Confirmed" only after GHL has the appointment.
  customerStatus(rid) {
    const st = this.core.state(this.tenant, rid);
    if (!st) return 'unknown';
    if (st.status === 'human_escalation') return 'a_person_will_contact_you';
    if (st.status === 'cancelled') return 'cancelled';
    const s = this.core.syncState(this.tenant, rid);
    if (st.status === 'confirmed') return s && s.sync_state === 'synced' ? 'confirmed' : 'being_confirmed';
    return 'received';
  }

  // ---- outbox handlers -----------------------------------------------------------------------
  handlers() {
    const t = this.tenant;
    return {
      // Reconciles the GHL opportunity stage with CURRENT local truth, never with stale job data,
      // so retries and out-of-order jobs cannot push a stage backwards.
      'ghl.sync_stage': async ({ payload: { rid } }) => {
        const st = this.core.state(t, rid);
        if (!st) return;
        const target = stageForStatus(st.status).pipelineStageId;
        let oppId = this.core.getRef(t, rid, 'ghl_opportunity');
        if (!oppId) {
          const contactId = this.core.getRef(t, rid, 'ghl_contact');
          if (!contactId) throw new Error('No GHL contact for request');
          const existing = (await this.ghl.searchOpportunities({ pipelineId: ghlConfig.pipeline.id, contactId }))
            .find((o) => o.status === 'open' || !o.status);
          const opp = existing || (await this.ghl.createOpportunity({ pipelineId: ghlConfig.pipeline.id, pipelineStageId: target, contactId, name: `Request ${rid.slice(0, 8)}` }));
          oppId = opp.id;
          this.core.setRef(t, rid, 'ghl_opportunity', oppId);
          if (!existing) return;
        }
        const current = await this.ghl.getOpportunity(oppId);
        if (current.pipelineStageId !== target) await this.ghl.moveOpportunity(oppId, target);
      },

      'ghl.create_appointment': async ({ payload }) => {
        const { rid, calendarId, contactId, startTime, endTime, title } = payload;
        const sync = this.core.syncState(t, rid);
        if (!sync || sync.sync_state === 'synced') return; // cancelled meanwhile, or already done
        // Search before create: the earlier attempt may have succeeded even though we saw an error.
        const events = await this.ghl.getEvents(calendarId, Date.parse(startTime) - 60e3, Date.parse(endTime) + 60e3);
        const found = events.find((e) => e.contactId === contactId && Date.parse(e.startTime) === Date.parse(startTime) && e.appointmentStatus !== 'cancelled');
        if (found) {
          this.core.markSynced(t, rid, found.id);
          this.core.enqueue(t, rid, 'ghl.sync_stage', { rid }, `stage:${rid}:confirmed`);
          return;
        }
        try {
          const ev = await this.ghl.createAppointment({ calendarId, contactId, startTime, endTime, title });
          this.core.markSynced(t, rid, ev.id);
          this.core.enqueue(t, rid, 'ghl.sync_stage', { rid }, `stage:${rid}:confirmed`);
        } catch (err) {
          if (err instanceof GhlError && !err.retryable && !(err instanceof GhlWritesDisabled)) {
            // Definitive refusal: free the hold and tell a human. Do not retry.
            this.core.releaseBooking(t, rid, `calendar refused on retry: ${err.message}`);
            this.core.enqueue(t, rid, 'alert.booking_refused', { error: err.message }, `refused:${rid}`);
            return;
          }
          throw err;
        }
      },

      'ghl.cancel_appointment': async ({ payload }) => {
        await this.ghl.cancelAppointment(payload.externalId);
      },

      'notify.technician': async ({ request_id, payload }) => {
        await this.notifier.send({ to: payload.technician, kind: 'assignment', rid: request_id, deadline: payload.deadline });
      },
      'notify.escalation': async ({ request_id, payload }) => {
        await this.notifier.send({ to: payload.target, kind: 'emergency', level: payload.level, rid: request_id });
      },
    };
  }

  // alert.* jobs go to the alerter (e.g. staff SMS/email/Slack). Registered separately so a broken
  // notifier can never block alerts about the notifier being broken.
  alertHandlers() {
    const h = {};
    for (const type of ['alert.job_dead', 'alert.escalation_exhausted', 'alert.booking_refused']) {
      h[type] = async ({ tenant, request_id, payload }) => this.alerter.send({ ...payload, type, tenant, rid: request_id });
    }
    return h;
  }

  // One worker pass: advance the escalation clock, then run due jobs.
  async runOnce() {
    const at = this.now();
    const tick = this.core.tick(at);
    const jobs = await this.core.processOutbox({ ...this.handlers(), ...this.alertHandlers() }, { at });
    return { tick, jobs };
  }

  // ---- reconciliation: do GHL and our records agree? ---------------------------------------
  async reconcile(rid) {
    const t = this.tenant;
    const st = this.core.state(t, rid);
    if (!st) throw new DispatchError('Request not found for tenant');
    const mismatches = [];
    const sync = this.core.syncState(t, rid);
    const booking = this.core.booking(t, rid);

    if (st.status === 'confirmed') {
      if (!sync || sync.sync_state !== 'synced') mismatches.push('booking confirmed locally but not synced to GHL');
      else {
        const ev = await this.ghl.getAppointment(sync.external_id).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
        if (!ev) mismatches.push('appointment missing in GHL');
        else {
          if (ev.appointmentStatus && ev.appointmentStatus !== 'confirmed') mismatches.push(`GHL appointment status is ${ev.appointmentStatus}`);
          if (ev.startTime && Date.parse(ev.startTime) !== Date.parse(booking.start_utc)) mismatches.push('GHL appointment time differs');
        }
      }
    } else if (st.status === 'cancelled' && sync && sync.external_id) {
      const ev = await this.ghl.getAppointment(sync.external_id).catch(() => null);
      if (ev && ev.appointmentStatus && ev.appointmentStatus !== 'cancelled') mismatches.push('cancelled locally but still active in GHL');
    }
    const oppId = this.core.getRef(t, rid, 'ghl_opportunity');
    if (oppId) {
      const opp = await this.ghl.getOpportunity(oppId);
      const expected = stageForStatus(st.status).pipelineStageId;
      if (opp.pipelineStageId !== expected) mismatches.push('GHL opportunity stage differs from local status');
    }
    if (mismatches.length) {
      this.core.enqueue(t, rid, 'alert.booking_refused', { error: `reconcile: ${mismatches.join('; ')}` }, `recon:${rid}:${mismatches.join('|')}`);
    }
    return { ok: mismatches.length === 0, mismatches };
  }
}

module.exports = { DispatchService, ServiceUnavailable, STAGE_FOR_EXCEPTION };
