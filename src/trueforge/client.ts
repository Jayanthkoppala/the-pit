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
   * Subscribe to a turn's SSE stream. Returns an unsubscribe fn.
   *
   * Uses a fetch-based SSE transport (not native EventSource) specifically so the
   * bearer token reaches the stream: EventSource can only set `withCredentials`
   * and cannot add an Authorization header, which would leave a deployed/OIDC
   * server's subscription unauthenticated while the POSTs succeed. We handle
   * Last-Event-ID resume and reconnection ourselves.
   */
  subscribeTurn(
    sessionId: string,
    turnId: string,
    onEvent: (evt: TfEvent) => void,
    onEnd?: (state: TfTurnDoneState) => void,
  ): () => void {
    const url = `${this.base}/api/v1/sessions/${sessionId}/turns/${turnId}/subscribe`;
    const ac = new AbortController();
    let lastEventId: string | undefined;
    let ended = false;

    const run = async () => {
      while (!ended && !ac.signal.aborted) {
        try {
          const res = await fetch(url, {
            headers: {
              ...this.headers,
              Accept: 'text/event-stream',
              ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
            },
            signal: ac.signal,
            credentials: this.headers.Authorization ? 'include' : 'same-origin',
          });
          // 412 = the replay buffer expired (turn long finished); stop, don't loop.
          if (res.status === 412 || res.status === 404) return;
          if (!res.ok || !res.body) throw new Error(`subscribe ${res.status}`);
          await parseSseStream(res.body, ac.signal, (id, dataLines) => {
            if (id) lastEventId = id;
            if (!dataLines) return;
            let data: TfEvent;
            try {
              data = JSON.parse(dataLines) as TfEvent;
            } catch {
              return;
            }
            onEvent(data);
            if (data.type === 'turn.done') {
              ended = true;
              onEnd?.(data.state);
              ac.abort();
            }
          });
        } catch (err) {
          if (ac.signal.aborted || ended) return;
          // transient drop — brief backoff, then reconnect from Last-Event-ID.
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    };
    void run();
    return () => {
      ended = true;
      ac.abort();
    };
  }
}

/** Parse an SSE byte stream into (id, data) events, respecting an abort signal. */
async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onFrame: (id: string | undefined, data: string | undefined) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // events are separated by a blank line
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let id: string | undefined;
        const dataParts: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('id:')) id = line.slice(3).trim();
          else if (line.startsWith('data:')) dataParts.push(line.slice(5).trimStart());
        }
        onFrame(id, dataParts.length ? dataParts.join('\n') : undefined);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
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
