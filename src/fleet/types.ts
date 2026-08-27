// The fleet model. These types are deliberately shaped to mirror TrueForge's
// SSE event stream (thread.created with parent topology, model.message.delta,
// tool.approval_required, sandbox.created, thread.completed/failed) so the real
// server adapter is a thin mapping onto `FleetEvent`, not a rewrite.

export type AgentState =
  | 'spawning' // thread.created, not yet producing
  | 'thinking' // model is streaming a response
  | 'tool' // running a tool / sandbox call
  | 'blocked' // tool.approval_required — waiting on a human
  | 'done' // thread.completed
  | 'failed'; // thread.failed

export interface Agent {
  id: string;
  parentId: string | null; // null = root agent; else a sub-agent
  name: string;
  role: string; // short label, e.g. "Researcher"
  state: AgentState;
  task: string; // current one-line intent
  /** rolling count of tool calls, for the dossier */
  toolCalls: number;
  /** cumulative output tokens (cost proxy) */
  tokens: number;
  /** ms epoch of last state change, for animations */
  changedAt: number;
}

// A normalized event. `at` is a logical timestamp (ms) supplied by the source.
export type FleetEvent =
  | { kind: 'spawn'; at: number; id: string; parentId: string | null; name: string; role: string; task: string }
  | { kind: 'state'; at: number; id: string; state: AgentState; task?: string }
  | { kind: 'tool'; at: number; id: string; tokens?: number } // one tool call happened
  | { kind: 'tokens'; at: number; id: string; delta: number }
  | { kind: 'despawn'; at: number; id: string };

export interface FleetSource {
  /** subscribe; returns an unsubscribe fn. */
  start(onEvent: (e: FleetEvent) => void): () => void;
  label: string; // e.g. "mock" | "trueforge@localhost:8790"
}
