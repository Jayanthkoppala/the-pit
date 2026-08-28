# Sandbox proof — the crew really runs code in an isolated VM

The hackathon requires that the agent **runs code in the sandbox**. This is the live
evidence that it does, captured against the running standalone server on 2026-08-28.

## What was proven

A sandbox-enabled session (`config.sandbox.enabled: true`) was given a script to run and
report its stdout. The provider is **Daytona** (cloud), shown Connected in Settings →
Sandbox providers after the key was regenerated with the `write:snapshots` scope.

Reproduce:

```bash
node scripts/sandbox-test.mjs omniroute/minimax-free
```

Observed SSE events (verbatim, trimmed):

```
🟢 sandbox.created: v1:daytona:default.f230a23b-bc38-4002-abbf-77d7c750642f
📤 tool.response: {"success":true,"response":{"exitCode":0,
    "result":"PIT_SBX_1787925672682\n42\n
             Linux b862eebd-…-6.8.0-85-generic … x86_64 GNU/Linux\n"}}
🏁 turn.done: {"status":"done", …}
```

Three facts make this real, not staged:
1. **`sandbox.created`** fires with a `daytona` sandbox id — a fresh cloud VM, not the host.
2. The **unique run marker** (`PIT_SBX_<epoch>`) round-trips back through `tool.response`,
   so the output is from *our* script in *that* run, not a cached or hallucinated string.
3. `uname -a` returns **Linux … x86_64** — the host running the server is macOS (arm64),
   so the code demonstrably executed somewhere else: the sandbox.

The exec surfaced as a `tool.response` shaped `{success, response:{exitCode, result}}` —
confirming the **sandbox-as-tool** model our design assumes: code runs isolated, and the
harness returns its result as a tool call the crew can reason over.

## Model health at time of capture (why the demo must rotate models)

| Model                    | Result                                            |
|--------------------------|---------------------------------------------------|
| `omniroute/minimax-free` | ✅ sandbox ran, marker returned                    |
| `omniroute/ling-free`    | ✅ sandbox ran, marker returned                    |
| `omniroute/glm-free`     | ❌ `429` upstream before any tool call             |
| `omniroute/nemotron-free`| ❌ "Provider returned empty content"               |
| `vertex/vertex-gemini`   | ❌ proxy resets connection (`HTTP 000`) on inference — backup is down |

Takeaway for the live demo: free models are individually flaky, so the run path must
**auto-rotate** across `minimax-free`/`ling-free`, and the Vertex proxy must be repaired
before it can be trusted as the paid backup. Tracked in the reliability plan.
