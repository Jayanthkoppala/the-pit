// Normalizes TrueForge's SSE stream into the UI's FleetEvent shape and drives
// the floor. This is the drop-in replacement for mockFeed's FleetSource: the
// canvas never learns it went from scripted to real.
//
// Attribution model (verified): every content event carries thread_id; the root
// agent is 'main', each sub-agent its own id. thread.created carries parent
// topology. So thread_id → character, one-to-one.

import type { FleetEvent, FleetSource, AgentState } from '../fleet/types';
import { TrueForgeClient, type TfEvent, type AgentSpec } from './client';

/** A pending human decision surfaced to the UI (the walk-to-your-desk moment). */
export interface PendingApproval {
  threadId: string;
  toolCallId: string;
  /** the tool being gated, resolved from the model.message that requested it */
  toolName: string;
  args: string;
}

export interface IncidentSourceOptions {
  client: TrueForgeClient;
  spec: AgentSpec;
  /** the alert text that opens the incident */
  prompt: string;
  /** roles by thread — a lightweight label map; falls back to agent_info.name */
  roleFor?: (threadId: string, name?: string) => string;
  /** called when the run pauses on a destructive tool — the UI shows the gate */
  onApprovalRequired?: (p: PendingApproval) => void;
  onTurnEnd?: (status: 'done' | 'error' | 'cancelled', detail?: string) => void;
}

const toState = (s: string): AgentState =>
  s === 'error' ? 'failed' : s === 'done' ? 'done' : 'thinking';

/** The live source plus the one action the mock never had: answering the gate. */
export interface IncidentSource extends FleetSource {
  /** Answer a pending approval; hot-swaps the subscription to the resumed turn. */
  respond(p: PendingApproval, decision: { status: 'allow' } | { status: 'deny'; reason?: string }): Promise<void>;
}

export function incidentSource(opts: IncidentSourceOptions): IncidentSource {
  const { client, spec, prompt } = opts;
  // shared across start()'s closure and respond(); set once the run begins.
  let respondImpl: IncidentSource['respond'] = async () => {
    throw new Error('respond() called before the incident started');
  };

  const source: IncidentSource = {
    label: 'trueforge@live',
    respond: (p, d) => respondImpl(p, d),
    start(emit: (e: FleetEvent) => void) {
      let stop = () => {};
      let cancelled = false;
      // remember the tool name/args each model.message requested, so an
      // approval event (which only carries a source_event_id) can be enriched.
      const toolByEvent = new Map<string, { name: string; args: string }>();
      let sessionId = '';

      (async () => {
        sessionId = await client.createSession(spec);
        if (cancelled) return;
        const turnId = await client.createTurn(sessionId, prompt);
        if (cancelled) return;

        const subscribe = (tid: string) => {
          stop = client.subscribeTurn(
            sessionId,
            tid,
            (evt: TfEvent) => handle(evt),
            (state) => {
              if (state.status === 'done' && state.required_actions?.length) return; // gate pending, keep waiting
              opts.onTurnEnd?.(state.status, 'message' in state ? state.message : (state as { reason?: string }).reason);
            },
          );
        };

        const handle = (evt: TfEvent) => {
          const at = performance.now();
          switch (evt.type) {
            case 'thread.created':
              emit({
                kind: 'spawn',
                at,
                id: evt.thread_id,
                parentId: evt.parent?.thread_id ?? null,
                name: evt.agent_info?.name ?? evt.title ?? evt.thread_id,
                role: opts.roleFor?.(evt.thread_id, evt.agent_info?.name) ?? evt.agent_info?.name ?? 'agent',
                task: evt.agent_info?.input ?? '',
              });
              break;
            case 'model.message.delta':
              emit({ kind: 'state', at, id: evt.thread_id, state: 'thinking' });
              if (evt.usage?.output_tokens) emit({ kind: 'tokens', at, id: evt.thread_id, delta: evt.usage.output_tokens });
              break;
            case 'model.message':
              // tool calls live INSIDE model.message — record them and mark 'tool'
              for (const tc of evt.tool_calls ?? []) {
                toolByEvent.set(evt.id, { name: tc.function.name, args: tc.function.arguments });
                emit({ kind: 'state', at, id: evt.thread_id, state: 'tool', task: tc.function.name });
                emit({ kind: 'tool', at, id: evt.thread_id, tokens: evt.usage?.output_tokens });
              }
              if (!evt.tool_calls?.length && evt.content)
                emit({ kind: 'state', at, id: evt.thread_id, state: 'thinking', task: evt.content.slice(0, 60) });
              break;
            case 'tool.response':
              emit({ kind: 'state', at, id: evt.thread_id, state: 'thinking' });
              break;
            case 'tool.approval_required': {
              const call = evt.tool_calls[0];
              const enriched = toolByEvent.get(call.source_event_id) ?? { name: 'destructive action', args: '' };
              emit({ kind: 'state', at, id: evt.thread_id, state: 'blocked', task: enriched.name });
              opts.onApprovalRequired?.({
                threadId: evt.thread_id,
                toolCallId: call.id,
                toolName: enriched.name,
                args: enriched.args,
              });
              break;
            }
            case 'thread.done':
              emit({ kind: 'state', at, id: evt.thread_id, state: toState(evt.state.status) });
              break;
            default:
              break; // turn.created / sandbox.created / mcp.initialize — no character change
          }
        };

        subscribe(turnId);

        // Answering the gate opens a NEW turn; the subscription hot-swaps to it.
        // Missing this swap is the #1 integration footgun — so it lives here,
        // sharing the session/subscribe closure rather than being re-derived.
        respondImpl = async (p, decision) => {
          stop();
          const nextTurn = await client.respondToApproval(sessionId, p.threadId, p.toolCallId, decision);
          subscribe(nextTurn);
        };
      })().catch((err) => opts.onTurnEnd?.('error', String(err)));

      return () => {
        cancelled = true;
        stop();
        if (sessionId) client.cancel(sessionId).catch(() => {});
      };
    },
  };

  return source;
}
