// Prove the Daytona sandbox actually executes code, end to end, via the TrueForge API.
const BASE = 'http://localhost:8790/api/v1';
const MODEL = process.argv[2] || 'omniroute/glm-free';
const J = { 'Content-Type': 'application/json' };
const post = async (p, b) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: J, body: JSON.stringify(b) });
  const t = await r.text();
  if (!r.ok) throw new Error(`POST ${p} → ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
};

const MARKER = 'PIT_SBX_' + Date.now();
const spec = {
  model: { name: MODEL },
  instructions: 'You have a sandbox. When asked to run code, actually execute it in the sandbox and report the real stdout verbatim. Be terse.',
  config: { sandbox: { enabled: true } },
};
console.log('model:', MODEL, '| marker:', MARKER);

const s = await post('/sessions', { agent: { spec } });
const sid = s.data.id;
console.log('session:', sid);

const prompt = `Run this in your sandbox and report the exact stdout: a script that prints "${MARKER}", then 6*7, then the output of "uname -a". Execute it for real.`;
const t = await post(`/sessions/${sid}/turns`, {
  input: [{ type: 'user.message', content: [{ type: 'text', text: prompt }] }],
  previous_turn_id: 'auto', stream: false,
});
const tid = t.data.turn_id ?? t.data.id;
console.log('turn:', tid, '\n--- streaming ---');

const ac = new AbortController();
const to = setTimeout(() => ac.abort(), 120000);
const res = await fetch(`${BASE}/sessions/${sid}/turns/${tid}/subscribe`, {
  headers: { Accept: 'text/event-stream' }, signal: ac.signal,
});
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '', sawSandbox = false, sawExec = false, sawMarker = false, tokens = 0;
const seen = {};
outer: while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) !== -1) {
    const frame = buf.slice(0, i); buf = buf.slice(i + 2);
    const dl = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!dl) continue;
    let e; try { e = JSON.parse(dl); } catch { continue; }
    seen[e.type] = (seen[e.type] || 0) + 1;
    if (e.type === 'sandbox.created') { sawSandbox = true; console.log('🟢 sandbox.created:', e.sandbox_id || JSON.stringify(e).slice(0,120)); }
    if (e.type === 'model.message') {
      for (const tc of (e.tool_calls || [])) { sawExec = true; console.log('🔧 tool:', tc.function?.name, '→', (tc.function?.arguments||'').slice(0,150)); }
      if (e.content && e.content.includes(MARKER)) sawMarker = true;
    }
    if (e.type === 'tool.response') {
      const c = typeof e.content === 'string' ? e.content : JSON.stringify(e.content);
      if (c.includes(MARKER)) sawMarker = true;
      console.log('📤 tool.response:', c.slice(0, 220).replace(/\n/g,' ⏎ '));
    }
    if (e.usage?.output_tokens) tokens += e.usage.output_tokens;
    if (e.type === 'turn.done') { console.log('🏁 turn.done:', JSON.stringify(e.state).slice(0,200)); break outer; }
  }
}
clearTimeout(to);
console.log('\n=== VERDICT ===');
console.log('event types:', JSON.stringify(seen));
console.log('sandbox.created :', sawSandbox ? 'YES' : 'no');
console.log('exec tool call  :', sawExec ? 'YES' : 'no');
console.log('marker in output:', sawMarker ? 'YES ✅ (real execution proven)' : 'NO');
