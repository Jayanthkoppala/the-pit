import { useFleet } from '../fleet/store';
import type { AgentState } from '../fleet/types';

const STATE_LABEL: Record<AgentState, string> = {
  spawning: 'Spawning',
  thinking: 'Thinking',
  tool: 'Running a tool',
  blocked: 'Waiting on you',
  done: 'Done',
  failed: 'Failed',
};

export function Dossier() {
  const agents = useFleet((s) => s.agents);
  const selectedId = useFleet((s) => s.selectedId);
  const a = selectedId ? agents[selectedId] : null;

  if (!a) {
    return (
      <aside className="dossier">
        <div className="dossier-empty">Select an agent on the floor to open its dossier.</div>
      </aside>
    );
  }

  const children = Object.values(agents).filter((x) => x.parentId === a.id);

  return (
    <aside className="dossier">
      <header className="dossier-head">
        <div className="dossier-name">{a.name}</div>
        <div className="dossier-role">{a.role}</div>
      </header>

      <div className={`state-chip state-${a.state}`}>{STATE_LABEL[a.state]}</div>

      <div className="dossier-task">{a.task}</div>

      <dl className="dossier-stats">
        <div>
          <dt>Tool calls</dt>
          <dd>{a.toolCalls}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{a.tokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Sub-agents</dt>
          <dd>{children.length}</dd>
        </div>
      </dl>

      {a.state === 'blocked' && (
        <button className="approve-btn" onClick={() => useFleet.getState().apply({ kind: 'state', at: performance.now(), id: a.id, state: 'tool', task: 'Applying approved patch' })}>
          Approve
        </button>
      )}
    </aside>
  );
}
