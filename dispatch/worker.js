// dispatch/worker.js — drives the escalation clock and the retry outbox.
// Passes never overlap, and a failing pass is logged and retried on the next interval.

function startWorker({ service, intervalMs = 15000, log = console }) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await service.runOnce();
      if (r.jobs.dead || r.tick.exhausted) log.error('[DISPATCH WORKER]', JSON.stringify(r));
    } catch (err) {
      log.error('[DISPATCH WORKER] pass failed:', err.message);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { startWorker };
