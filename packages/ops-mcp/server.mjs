// ops-mcp v2 — the crew's hands and eyes on the REAL world.
// Read-only tools query live Prometheus / docker logs / deploys.json;
// destructive tools execute the real deploy.sh / docker restart — annotated
// destructiveHint:true so TrueForge's native approval gate fires on them.
// Run: node server.mjs → http://localhost:7311/mcp (streamable HTTP, stateless)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const exec = promisify(execFile);
const WORLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../world');
const PROM = process.env.PROM_URL || 'http://localhost:9090';

const text = t => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
const err = m => ({ content: [{ type: 'text', text: `ERROR: ${m}` }], isError: true });

async function promQuery(query) {
  const r = await fetch(`${PROM}/api/v1/query?query=${encodeURIComponent(query)}`);
  const d = await r.json();
  return d.data?.result ?? [];
}
async function promRange(query, mins = 30, stepSec = 60) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - mins * 60;
  const r = await fetch(
    `${PROM}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&step=${stepSec}`,
  );
  const d = await r.json();
  return d.data?.result ?? [];
}
const round = v => (v == null || Number.isNaN(+v) ? null : Math.round(+v * 1000) / 1000);

// All deploys/compose mutations go through this promise chain so two overlapping
// calls (agent rollback racing a /demo click) can never interleave the
// read-modify-write on deploys.json and corrupt it. deploy.sh adds an flock on
// hosts that have it (the Linux VM); this covers macOS, where flock is absent.
let deployChain = Promise.resolve();
const serializeDeploy = fn => {
  const run = deployChain.then(fn, fn);
  deployChain = run.then(() => {}, () => {});
  return run;
};

function build() {
  const srv = new McpServer({ name: 'ops', version: '0.2.0' });

  srv.registerTool('service_status', {
    description: 'Live status of the payments-api stack: scrape targets, current error rate, active deploy.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => {
    try {
      const up = await promQuery('up');
      const errRate = await promQuery(
        'sum(rate(http_requests_total{job="api",route="/checkout",status="500"}[2m])) / sum(rate(http_requests_total{job="api",route="/checkout"}[2m]))',
      );
      const deploys = JSON.parse(await readFile(path.join(WORLD, 'deploys.json'), 'utf8'));
      const rate = round(errRate[0]?.value?.[1]) ?? 0;
      return text({
        targets: up.map(r => ({ job: r.metric.job, up: r.value[1] === '1' })),
        checkout_error_rate: rate,
        status: rate > 0.05 ? 'DEGRADED — checkout error rate above 5%' : 'OK',
        current_deploy: deploys.current,
      });
    } catch (e) { return err(String(e)); }
  });

  srv.registerTool('get_metrics', {
    description: 'Run a PromQL query. Use `range:true` for a time series over the window; omit for an instant value. Useful series: http_requests_total{job,route,status}, http_request_duration_seconds_bucket.',
    inputSchema: {
      query: z.string().describe('PromQL, e.g. sum(rate(http_requests_total{job="api",status="500"}[2m]))'),
      range: z.boolean().optional().describe('true = time series over window_minutes'),
      window_minutes: z.number().optional().describe('range window, default 30'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ query, range, window_minutes }) => {
    try {
      if (range) {
        const res = await promRange(query, window_minutes ?? 30);
        return text(res.map(s => ({
          series: s.metric,
          points: s.values.map(([t, v]) => ({ t: new Date(t * 1000).toISOString().slice(11, 16), v: round(v) })),
        })));
      }
      const res = await promQuery(query);
      return text(res.map(s => ({ series: s.metric, value: round(s.value?.[1]) })));
    } catch (e) { return err(String(e)); }
  });

  srv.registerTool('get_logs', {
    description: 'Recent logs from a service container (api | payments). Returns the last N lines, newest last.',
    inputSchema: {
      service: z.enum(['api', 'payments']).describe('which service'),
      lines: z.number().optional().describe('how many lines, default 40, max 200'),
      grep: z.string().optional().describe('only lines containing this substring (case-insensitive)'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ service, lines, grep }) => {
    try {
      const n = Math.min(lines ?? 40, 200);
      const { stdout, stderr } = await exec('docker', ['logs', `world-${service}-1`, '--tail', String(n * 3)], { maxBuffer: 4 * 1024 * 1024 });
      let out = (stdout + stderr).split('\n').filter(Boolean);
      if (grep) out = out.filter(l => l.toLowerCase().includes(grep.toLowerCase()));
      return text(out.slice(-n).join('\n') || '(no matching lines)');
    } catch (e) { return err(String(e)); }
  });

  srv.registerTool('get_deploy_history', {
    description: 'Deployment history for payments: release, time, author, note, and which release is live.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => {
    try { return text(JSON.parse(await readFile(path.join(WORLD, 'deploys.json'), 'utf8'))); }
    catch (e) { return err(String(e)); }
  });

  srv.registerTool('rollback_deploy', {
    description: 'DESTRUCTIVE: deploy payments at a previous release (e.g. v1.4.1). Irreversibly changes what runs in production.',
    inputSchema: { release: z.string().regex(/^v\d+\.\d+\.\d+$/, 'must be a semver tag like v1.4.1').describe('release tag to deploy, e.g. v1.4.1') },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ release }) => {
    try {
      const stdout = await serializeDeploy(async () =>
        (await exec('bash', [path.join(WORLD, 'deploy.sh'), release, 'incident-crew', 'rollback'], { timeout: 120_000 })).stdout);
      return text(stdout.trim());
    } catch (e) { return err(String(e)); }
  });

  srv.registerTool('restart_service', {
    description: 'DESTRUCTIVE: restart a service container. Drops in-flight requests.',
    inputSchema: { service: z.enum(['api', 'payments']) },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ service }) => {
    try {
      await serializeDeploy(() => exec('docker', ['compose', 'restart', service], { cwd: WORLD, timeout: 120_000 }));
      return text(`restarted ${service}`);
    } catch (e) { return err(String(e)); }
  });

  return srv;
}

const app = express();
app.use(express.json());

// CORS for the /demo/* levers only, scoped to a local console origin — never '*'.
// The browser must NOT call /mcp directly: the agent reaches MCP server-side via
// TrueForge; the browser only pulls the break/reset levers. Registered before the
// routes so the headers actually apply.
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGIN.test(origin)) { res.header('Access-Control-Allow-Origin', origin); res.header('Vary', 'Origin'); }
  else if (origin === 'null') { res.header('Access-Control-Allow-Origin', 'null'); } // console opened as file://
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.post('/mcp', async (req, res) => {
  const server = build();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get('/healthz', async (_q, r) => {
  try {
    const d = JSON.parse(await readFile(path.join(WORLD, 'deploys.json'), 'utf8'));
    r.json({ ok: true, current: d.current });
  } catch { r.json({ ok: true, current: 'unknown' }); }
});

// Demo controls the USER pulls (not agent tools): break the world, or reset it.
// The agent still only heals via the destructive, gated MCP tools.
// The world has one real, honest failure mode: shipping v1.4.2 breaks checkout
// (retry-queue lookup against an unmigrated queue). We don't fake latency/oom
// variants that would just redeploy the same release under a different label.
const SCENARIOS = {
  deploy: { release: 'v1.4.2', note: 'ship the retry-queue misdeploy' },
};
async function runDeploy(release, note) {
  return serializeDeploy(async () =>
    (await exec('bash', [path.join(WORLD, 'deploy.sh'), release, 'you', note], { timeout: 120_000 })).stdout.trim());
}
app.post('/demo/break', async (req, res) => {
  const key = req.query.scenario ?? 'deploy';
  const scn = SCENARIOS[key];
  if (!scn) return res.status(400).json({ ok: false, error: `unknown scenario '${key}'; known: ${Object.keys(SCENARIOS).join(', ')}` });
  try { res.json({ ok: true, out: await runDeploy(scn.release, scn.note) }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});
app.post('/demo/reset', async (_q, res) => {
  try { res.json({ ok: true, out: await runDeploy('v1.4.1', 'reset to healthy baseline') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.listen(7311, () => console.log('ops-mcp v2 on http://localhost:7311/mcp → world at', WORLD));
