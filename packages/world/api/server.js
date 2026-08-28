// api — the public edge. /checkout fans into payments /charge; payments'
// failures surface here as 5xx, which is what the alert rule watches.
import express from 'express';
import pino from 'pino';
import client from 'prom-client';

const log = pino({ base: { service: 'api' } });
const PAYMENTS = process.env.PAYMENTS_URL || 'http://payments:7402';

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const httpReqs = new client.Counter({
  name: 'http_requests_total',
  help: 'requests by route/status',
  labelNames: ['route', 'status'],
  registers: [registry],
});
const latency = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'request latency',
  labelNames: ['route'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4],
  registers: [registry],
});

const app = express();
app.get('/healthz', (_q, r) => r.json({ ok: true }));
app.get('/metrics', async (_q, r) => r.type(registry.contentType).send(await registry.metrics()));

app.post('/checkout', async (_q, res) => {
  const end = latency.startTimer({ route: '/checkout' });
  try {
    const resp = await fetch(`${PAYMENTS}/charge`, { method: 'POST', signal: AbortSignal.timeout(4000) });
    if (!resp.ok) throw new Error(`payments ${resp.status}`);
    httpReqs.inc({ route: '/checkout', status: '200' });
    log.info({ route: '/checkout' }, 'checkout ok');
    res.json({ ok: true });
  } catch (err) {
    httpReqs.inc({ route: '/checkout', status: '500' });
    log.error({ route: '/checkout', err: String(err) }, 'checkout failed');
    res.status(500).json({ error: 'checkout failed' });
  } finally {
    end();
  }
});

app.listen(7401, () => log.info('api on :7401'));
