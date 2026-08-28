# The Pit — canonical build & test plan

One source of truth to the submission. Synthesized from six independent planning
agents run on **mixed models** (so the reasoning cross-checks itself) plus live
verification against the running stack.

| Agent | Model | Owns |
|---|---|---|
| build-planner | Opus 4.8 | build sequence + cutlines |
| test-architect | Opus 4.8 | the five test layers |
| mcp-verifier | Opus 4.8 | ops-mcp correctness/security |
| sandbox-analyst | Sonnet 5 | the sandbox code-execution beat |
| deploy-planner | Sonnet 5 | live judges-page runbook |
| reliability-planner | Fable 5 | 48h resilience: fallback, SSE, gate |

**Deadline:** Sun 30 Aug 2026, 20:00 London. Solo build.

---

## 0. Ground truth (verified live, 2026-08-28)

- **World, ops-mcp, TrueForge are up**; the incident loop is proven headless via the API.
- **Sandbox runs real code.** A `config.sandbox.enabled:true` session gives the agent a
  built-in `exec` tool → `sandbox.created` (Daytona VM) → `tool.response{exitCode,result}`.
  Proven twice (API + the TrueForge UI on ling-free); see `docs/sandbox-proof.md`. Daytona
  bug #461 was a missing `write:snapshots` key scope, now fixed. Wallet: ~$100 credit,
  $0.02 spent — each run is a fraction of a cent.
- **Model health is uneven.** `minimax-free` and `ling-free` run clean; `glm-free` (429),
  `nemotron-free` (empty), and the **Vertex proxy** (resets on inference, `HTTP 000`) fail.
  → the demo must **rotate among the working free models**, and the Vertex backup needs a
  proxy fix before it can be trusted.
- **The one gap:** no UI has ever touched the real stream. `sseSource.ts` is imported by
  nothing; `src/App.tsx` still runs `mockSource`; `demo/console-mock.html` is static.

## 1. What the harness already handles (so we don't rebuild it)

- **The approval gate is native.** A tool annotated `destructiveHint:true` is paused by
  TrueForge before it runs (`tool.approval_required`); we resume with a typed
  `user.tool_approval` turn. Verified: the gate fires on exactly our two destructive tools.
  → We never build our own approval machinery; we *reach* it by calling the tool.
- **The sandbox is a managed tool.** `exec` + `sandbox.created` are the harness's; we render
  them, we don't implement code execution.
- **SSE is a per-turn resumable stream** (id = sequence number, Last-Event-ID resume,
  5-min post-completion replay TTL, 10-min server close). Our client already loops correctly.
- **Turns form a tree.** A model error ends a turn cleanly (`turn.done{status:error}`); the
  session survives and a new turn from the last good turn forks past it.

**What the harness does NOT handle, and we must:** model *fallback* (spec is bound per
session, no per-turn override — client-orchestrated only); auth (standalone has none);
approval idempotency across double-clicks; late-joiner hydration.

---

## 2. Build sequence (spine: build-planner)

Ordered; each = {files · change · done-when}. Everything here is REMAINING.

1. **Merge to main.** PR #1 (skills) + PR #2 (SSE client) + PR #3 (demo controls). →
   *Done-when:* fresh clone of main runs the full stack and has `skills/` + `src/trueforge/`.
2. **`docs/loop-proof.md`** — exact curl break→gate→approve→heal (referenced but missing). →
   *Done-when:* copy-paste hits the gate live.
3. **Capture replay transcript** `demo/replay/incident-01.jsonl` — one real SSE run saved. →
   *Done-when:* it replays a full incident. **This is the video safety net — do it before the video.**
4. **Wire live UI** — `src/App.tsx`: swap `mockSource()` for `incidentSource({client,spec,prompt})`. →
   *Done-when:* the floor populates from a real run.
5. **Break lever + counter** — "Ship v1.4.2" posts `/demo/break`; live error-rate tile from
   `service_status`; the "0 UNAUTHORIZED ACTIONS" counter. → *Done-when:* click → degrade →
   crew starts; tile moves.
6. **Real gate** — replace the fake Approve with `onApprovalRequired` → card → `respond(allow/deny)`. →
   *Done-when:* the run pauses on `rollback_deploy`; Allow heals the world, Deny replans.
7. **Fix PR + postmortem** — real root-cause fix to `payments/server.js` +
   `postmortems/2026-08-30-retry-queue.md`, `Closes #`. → *Done-when:* PR open with Qodo review.
8. **README Qodo Evidence + de-stale** — fill the empty `## Qodo Code Review Evidence`
   (submission-critical); soften claims not yet true; fix "3 failure species" (only 1 exists). →
   *Done-when:* section populated, links resolve.
9. **Generative-UI dossier (thin)** — receipts as an openui card + view-source flip (reuse
   `console-mock.html` CSS). → *Done-when:* the selected agent shows real receipts. *Cuttable.*
10. **3-min video** — shoot live (steps 5-6) or from replay (step 3); embed in README. →
    *Done-when:* watchable — real telemetry, gate holds, heal. **The graded artifact.**
11. **Submit form** — repo + video + criteria map.
12. **GCP judges page (UPSIDE, cuttable)** — see §5. → *Done-when:* a stranger can break + sign.

**Cutlines:** T-4h floor = 1-3, 7, 8, 10-on-replay (submittable). T-12h = +4-6 (video on
real data). T-0 win = +9, 12. **Biggest risk:** the live UI (4-6) is unbuilt and the graded
video rides on it — mitigate by doing **3 (replay) before 10** so the video is never blocked
by a flaky live run. The video never depends on 12.

---

## 3. Sandbox beat (sandbox-analyst) — the mandatory "runs code in the sandbox"

- Spec: `config.sandbox.enabled:true` (no `skills` array needed for the beat). The agent gets
  the `exec` tool: `{intent, command, cwd?, env?}` in a persistent VM with Python/git/curl/jq/rg.
- The beat: the crew **reproduces the incident in the sandbox** — e.g. `curl` the checkout
  endpoint and show the 500 — before proposing the fix. Render `sandbox.created` +
  the `exec` `tool.response` stdout in the UI.
- `exec` (curl/echo) is read-only → no `destructiveHint` → no gate. The gate stays on
  ops-mcp's `rollback_deploy`/`restart_service`. Clean separation: **sandbox proves the
  failure; ops-mcp (gated) proves the heal.**
- Model: do **not** pin a single free model for the beat (429 risk) — use the rotation (§4).
- Fallback: if Daytona breaks, `enabled:true` falls back to a `v1:local:` sandbox
  automatically; if both fail, show the real `exec` attempt failing live — an honest sandbox
  attempt still satisfies the requirement.

## 4. Reliability — 48h resilience (reliability-planner)

Client-orchestrated, because the model is bound per session with no per-turn override.

- **Fallback ladder** on `onTurnEnd('error')`: (rung 0) retry same session with
  `previous_turn_id = lastGoodTurnId` (never `'auto'` — it chains to the errored turn), 2s
  backoff; (rung 1-2) new session on the next model + a one-line recap of decisions so far
  (assistant history can't be injected), UI shows a "FAILING OVER" banner. Order:
  `ling-free → minimax-free → vertex-gemini` (once Vertex is repaired). Pre-flight: a rolling
  error counter starts new incidents directly on a healthy rung.
- **SSE gaps to close:** on 412/404 the client currently returns silently → add `onGone` that
  GETs the terminal turn state; add a 45s no-bytes stall detector that aborts→reconnects; build
  `hydrateIncident(sessionId)` (GET turns → GET `/turns/{id}/events`, persisted forever) for
  late-joining judges.
- **Approval idempotency:** a double-click creates a second turn that *cancels* the resumed
  one (`CancelledForNextTurn`) and kills the incident. Guard: server-side answered-toolCallId
  set + client `inFlight` guard + optimistic button-disable. Multiple gated calls in one event
  → answer as multiple input items in **one** turn.
- **Watchdog/reset:** incident >8 min or no event 2 min → cancel + idempotent scenario reset +
  30s cooldown; `iteration_limit: 30` (default 100) and a ~5-min server exec timeout cap
  runaways; boot-time headless smoke incident; `/api/health`.

## 5. Deploy — live judges page (deploy-planner) — **security-shaped**

**Critical constraint:** TrueForge standalone has **no auth — every caller is the shared
local admin** (docs say keep it on localhost). A judge with the raw URL could add their own
model key, remove the gate, or run arbitrary code on the VM. So:

- **TrueForge is never on the public path** — no port, no subdomain, no proxy rule reaches
  `:8790`. Firewall it to localhost.
- **Public surface = the static console + a thin proxy** (~200 lines) exposing exactly 3 fixed
  verbs: `/demo/break`, `/demo/reset`, `/demo/heal` (starts a turn on a **pre-saved agent** —
  fixed model, fixed instructions, ops-mcp only). No free-text prompt, no model/connector picker.
- **One "judge seat"** token (TTL, heartbeat) so only one person drives approvals; everyone else
  spectates. The proxy fans out **one** upstream SSE to N viewers and dedups approvals server-side.
- **Do not configure Daytona for the *public* agent** — the incident agent only needs ops-mcp
  tools; no sandbox = no arbitrary-code path even if the turn is influenced. (The sandbox beat
  is shown in the *video / local* demo, not the anonymous public page.)
- VM: `e2-medium` Debian/Ubuntu, only 80/443 open, Caddy auto-HTTPS, `restart: unless-stopped`
  + systemd, a reset cron every ~15 min, teardown script ready. ~$1-2 compute for 48h + Vertex tokens.
- **Pre-flight before sharing the URL:** `curl https://<domain>:8790` must be refused (not 200).

## 6. Testing — five layers (test-architect)

Runner: Node 22 `node --test` (`.test.mjs`, `node:assert/strict`), no framework.

1. **Unit (no sandbox)** — `test/unit/`: the 6 ops-mcp tools (Prometheus/docker/bash faked,
   error-rate boundary, clamps, isError paths); the `incidentSource` normalizer (field-exact
   TfEvent→FleetEvent, tokens-once, multi-tool approval keyed by tool-call id); `parseSseStream`
   framing + chunk-boundary reassembly *(export it first)*.
2. **MCP-protocol (no sandbox)** — `test/mcp/protocol.test.mjs`: real MCP SDK client over
   Streamable HTTP → `tools/list` = 6, annotation correctness (the gate contract),
   `tools/call` returns text / `isError:true` on failure, stateless independence.
3. **Integration ops-mcp↔world (needs sandbox)** — `test/integration/heal-loop.test.mjs`:
   `/demo/reset`→`/demo/break` (healthz v1.4.1→v1.4.2), real client+`incidentSource`, poll for
   `tool` → `onApprovalRequired` → `respond(allow)` → healthz back to v1.4.1. Pin the model.
4. **Edge (mostly no sandbox)** — `test/edge/`: error-turn→retry; DENY leaves v1.4.2; double-break
   idempotent; SSE drop→reconnect with `Last-Event-ID`; 412→stop; `iteration_limit:1`; empty
   message→0 emits; wrong `tool_call_id`→422; `user.message`+approval mix→422; CORS OPTIONS→204;
   `/mcp` has no ACAO header while `/demo/*` does.
5. **E2E (needs sandbox)** — `test/e2e/pit-console.spec.mjs`: break keycap→DEGRADED; approval
   gate visible naming the tool; view-source flip renders a real openui block; approve→healthy;
   postmortem heading. *(Add `data-testid` hooks.)*

**Green board:** prom healthy → ops `/healthz` → `node --test test/mcp` → `test/unit test/edge`
→ `/demo/reset` + confirm baseline → `test/integration` (sandbox) → `/demo/break` to arm.

**Top pre-demo risk to verify:** `sseSource.ts` emits `tokens` on both `model.message.delta`
and `model.message` usage — if the live server populates delta usage, tokens double-count.
The integration suite must log every `tokens` delta to confirm.

## 7. MCP status (mcp-verifier)

- **Annotations correct — proven live.** Gate fires on exactly `rollback_deploy` +
  `restart_service`. Shell-exec tools are injection-safe (grep is a JS filter; release flows as
  `execFile` argv into a fully-quoted `deploy.sh`).
- **Qodo findings fixed (PR #3, commit 32e42f3):** deploys.json race → server-side deploy mutex
  + `flock`; wildcard CORS → localhost allowlist, moved above routes; unknown scenario → 400;
  release semver-validated; per-request `McpServer` closed.
- **Pre-public hardening (deferred to §5):** the gate is fail-*open* for any *future* unannotated
  mutating tool — add a server-side confirm-token on the destructive handlers before public exposure.

## 8. Qodo trail (per hackathon rules)

No review cap (14-day trial only). Requirement: fix every valid High, re-run review to show
resolution, and a README `## Qodo Code Review Evidence` section linking a representative merged
PR. Status: PR #1 (3 Highs) + PR #2 (3 findings) + PR #3 (Highs) all fixed, replied, re-reviewed.
Build step 8 fills the README section against a merged PR.

## 9. Open decision for Jay

**Live judges page (step 12) vs video-only.** The no-auth finding means the public page needs a
~200-line auth proxy + seat logic — real extra work under deadline. It's marked cuttable and the
graded video never depends on it. *Recommendation:* lock the video path first (steps 1-10 with
replay as the safety net); build the live page only if steps 4-6 are stable with time to spare.
