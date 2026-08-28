// payments — the dependency service. The "bad deploy" is real code, gated by
// RELEASE: v1.4.2 ships a retry-queue lookup against a queue that was never
// migrated, so ~35% of charges 500 after a slow timeout. v1.4.1 is healthy.
import express from 'express';
import pino from 'pino';
import client from 'prom-client';

const RELEASE = process.env.RELEASE || 'v1.4.1';
const BAD = RELEASE === 'v1.4.2';
const log = pino({ base: { service: 'payments', release: RELEASE } });

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
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.get('/healthz', (_q, r) => r.json({ ok: true, release: RELEASE }));
app.get('/metrics', async (_q, r) => r.type(registry.contentType).send(await registry.metrics()));

app.post('/charge', async (req, res) => {
  const end = latency.startTimer({ route: '/charge' });
  if (BAD && Math.random() < 0.35) {
    // the bug: enqueue against retry_v2, which doesn't exist in this environment
    await sleep(2400 + Math.random() * 800); // timeout waiting on the missing queue
    log.error({ route: '/charge', err: "queue 'retry_v2' not found — did migration run?" }, 'enqueue failed');
    httpReqs.inc({ route: '/charge', status: '500' });
    end();
    return res.status(500).json({ error: 'retry-queue enqueue timeout' });
  }
  await sleep(120 + Math.random() * 90);
  log.info({ route: '/charge', ms: 150 }, 'charge ok');
  httpReqs.inc({ route: '/charge', status: '201' });
  end();
  res.status(201).json({ charged: true, release: RELEASE });
});

app.post('/refund', async (_q, res) => {
  const end = latency.startTimer({ route: '/refund' });
  await sleep(140 + Math.random() * 80);
  log.info({ route: '/refund' }, 'refund ok');
  httpReqs.inc({ route: '/refund', status: '200' });
  end();
  res.json({ refunded: true });
});

app.listen(7402, () => log.info(`payments ${RELEASE} on :7402 (bad=${BAD})`));
