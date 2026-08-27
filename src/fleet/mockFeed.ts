import type { FleetEvent, FleetSource } from './types';

// A scripted scenario: a root "Orchestrator" spins up, fans out three
// sub-agents, they run tools, one blocks on approval, then the fleet lands.
// Times are ms offsets from start. This is throwaway — the real source emits
// the same FleetEvent shape from TrueForge's SSE stream.
function script(): FleetEvent[] {
  const S: FleetEvent[] = [];
  const root = 'root';
  S.push({ kind: 'spawn', at: 300, id: root, parentId: null, name: 'Orchestrator', role: 'Lead', task: 'Plan the migration' });
  S.push({ kind: 'state', at: 900, id: root, state: 'thinking', task: 'Decomposing into 3 tracks' });
  S.push({ kind: 'tokens', at: 1400, id: root, delta: 1200 });

  const subs = [
    { id: 'a', name: 'Scout', role: 'Researcher', task: 'Find every call site' },
    { id: 'b', name: 'Mason', role: 'Editor', task: 'Rewrite the adapters' },
    { id: 'c', name: 'Warden', role: 'Verifier', task: 'Prove nothing broke' },
  ];
  subs.forEach((sub, i) => {
    const t = 1800 + i * 500;
    S.push({ kind: 'spawn', at: t, id: sub.id, parentId: root, name: sub.name, role: sub.role, task: sub.task });
    S.push({ kind: 'state', at: t + 400, id: sub.id, state: 'thinking' });
  });

  // Scout runs searches
  S.push({ kind: 'state', at: 3600, id: 'a', state: 'tool', task: 'grep across 412 files' });
  S.push({ kind: 'tool', at: 3900, id: 'a', tokens: 800 });
  S.push({ kind: 'tool', at: 4400, id: 'a', tokens: 600 });
  S.push({ kind: 'state', at: 5200, id: 'a', state: 'done', task: 'Found 37 call sites' });

  // Mason edits, then needs approval to write
  S.push({ kind: 'state', at: 4200, id: 'b', state: 'tool', task: 'Patching adapters in sandbox' });
  S.push({ kind: 'tool', at: 4700, id: 'b', tokens: 2200 });
  S.push({ kind: 'state', at: 5600, id: 'b', state: 'blocked', task: 'Approve: write 12 files?' });
  S.push({ kind: 'state', at: 9000, id: 'b', state: 'tool', task: 'Applying approved patch' });
  S.push({ kind: 'tool', at: 9500, id: 'b', tokens: 900 });
  S.push({ kind: 'state', at: 10600, id: 'b', state: 'done', task: '12 files written' });

  // Warden verifies
  S.push({ kind: 'state', at: 5400, id: 'c', state: 'thinking', task: 'Waiting on Mason' });
  S.push({ kind: 'state', at: 10800, id: 'c', state: 'tool', task: 'Running the test suite' });
  S.push({ kind: 'tool', at: 11300, id: 'c', tokens: 1500 });
  S.push({ kind: 'state', at: 12600, id: 'c', state: 'done', task: '318 passing' });

  // Root lands
  S.push({ kind: 'state', at: 13200, id: root, state: 'done', task: 'Migration complete' });
  return S.sort((x, y) => x.at - y.at);
}

export function mockSource(): FleetSource {
  return {
    label: 'mock',
    start(onEvent) {
      const events = script();
      const timers = events.map((e) => window.setTimeout(() => onEvent(e), e.at));
      return () => timers.forEach(clearTimeout);
    },
  };
}
