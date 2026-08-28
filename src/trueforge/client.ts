// Minimal TrueForge HTTP/SSE client — the real replacement for the mock feed.
// Contract verified against the running server (see docs/loop-proof.md):
//   POST /api/v1/sessions            → { data: { id } }
//   POST /api/v1/sessions/{id}/turns → stream:false returns immediately
//   GET  /api/v1/sessions/{id}/turns/{turnId}/subscribe → EventSource (auto-resume)
// The approval round-trip is itself a new turn whose input is a user.tool_approval item.

export interface AgentSpec {
  model: { name: string; params?: Record<string, unknown> };
  instructions?: string;
  mcp_servers?: Array<{ name: string; require_approval_for_tools?: string[] }>;
  config?: Record<string, unknown>;
}

export interface TrueForgeClientOptions {
  /** Base URL of the server; on the same origin as a proxy this is "". */
  baseUrl?: string;
  /** Bearer token for a deployed (OIDC) server; omitted in standalone. */
  token?: string;
}

export class TrueForgeClient {
  private base: string;
  private headers: Record<string, string>;

  constructor(opts: TrueForgeClientOptions = {}) {
    this.base = (opts.baseUrl ?? 'http://localhost:8790').replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };
    if (opts.token) this.headers.Authorization = `Bearer ${opts.token}`;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base}/api/v1${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return (await r.json()) as T;
  }

  /** Create an inline session with the given agent spec. Returns the session id. */
  async createSession(spec: AgentSpec): Promise<string> {
    const res = await this.post<{ data: { id: string } }>('/sessions', { agent: { spec } });
    return res.data.id;
  }

  /** Fire a user turn without streaming; returns the turn id to subscribe to. */
  async createTurn(sessionId: string, text: string): Promise<string> {
    const res = await this.post<{ data: { id?: string; turn_id?: string } }>(
      `/sessions/${sessionId}/turns`,
      {
        input: [{ type: 'user.message', content: [{ type: 'text', text }] }],
        previous_turn_id: 'auto',
        stream: false,
      },
    );
    // the server returns the Turn object; its id is what we subscribe to.
    return res.data.turn_id ?? res.data.id!;
  }

  /**
   * Answer a pending tool.approval_required by opening a new turn whose input is
   * the typed approval decision. Returns the new turn id.
   */
  async respondToApproval(
    sessionId: string,
    threadId: string,
    toolCallId: string,
    decision: { status: 'allow' } | { status: 'deny'; reason?: string },
  ): Promise<string> {
    const res = await this.post<{ data: { id?: string; turn_id?: string } }>(
      `/sessions/${sessionId}/turns`,
      {
        input: [{ type: 'user.tool_approval', thread_id: threadId, tool_call_id: toolCallId, approval: decision }],
        previous_turn_id: 'auto',
        stream: false,
      },
    );
    return res.data.turn_id ?? res.data.id!;
  }

  /** Cancel the running last turn (the big red STOP). */
  async cancel(sessionId: string): Promise<void> {
    await this.post(`/sessions/${sessionId}/cancel`, {});
  }

  /**
   * Subscribe to a turn's SSE stream. Returns an unsubscribe fn. EventSource
   * auto-resumes via Last-Event-ID; late joiners get the buffered replay.
   */
  subscribeTurn(
    sessionId: string,
    turnId: string,
    onEvent: (evt: TfEvent) => void,
    onEnd?: (state: TfTurnDoneState) => void,
  ): () => void {
    const url = `${this.base}/api/v1/sessions/${sessionId}/turns/${turnId}/subscribe`;
    const es = new EventSource(url, { withCredentials: !!this.headers.Authorization });
    es.onmessage = (m) => {
      let data: TfEvent;
      try {
        data = JSON.parse(m.data) as TfEvent;
      } catch {
        return;
      }
      onEvent(data);
      if (data.type === 'turn.done') {
        onEnd?.(data.state);
        es.close();
      }
    };
    es.onerror = () => {
      /* EventSource retries on its own; a permanent 412 (buffer gone) simply stops it. */
    };
    return () => es.close();
  }
}

// ---- the slice of TrueForge's TurnStreamingEvent union this UI consumes ----
export type TfEvent =
  | { type: 'turn.created'; turn_id: string }
  | { type: 'model.message.delta'; id: string; thread_id: string; content?: string; reasoning_content?: string;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
      usage?: { output_tokens?: number } }
  | { type: 'model.message'; id: string; thread_id: string; content?: string;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      usage?: { output_tokens?: number } }
  | { type: 'tool.response'; id: string; thread_id: string; tool_call_id: string; content: string }
  | { type: 'tool.approval_required'; id: string; thread_id: string;
      tool_calls: Array<{ id: string; source_event_id: string }> }
  | { type: 'thread.created'; thread_id: string; title?: string;
      parent?: { thread_id: string; tool_call_id: string };
      agent_info?: { type: string; name?: string; input?: string; model?: string } }
  | { type: 'thread.done'; thread_id: string; state: { status: 'done' | 'error'; error?: string } }
  | { type: 'sandbox.created'; sandbox_id: string }
  | { type: 'mcp.initialize'; thread_id: string }
  | { type: 'turn.done'; state: TfTurnDoneState };

export type TfTurnDoneState =
  | { status: 'done'; required_actions?: Array<{ type: string; thread_id: string; tool_calls: Array<{ id: string }> }> }
  | { status: 'error'; message: string }
  | { status: 'cancelled'; reason: string };
