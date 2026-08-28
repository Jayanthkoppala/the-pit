# The Pit 🚨

**An AI incident-response crew that investigates, asks permission, and heals a real world. Built on [TrueForge](https://github.com/truefoundry/trueforge).**

> You ship the bad deploy. The crew catches it, diagnoses it with real telemetry, and walks the
> rollback to your desk — because in The Pit, **nothing irreversible happens without a human
> signature.** Deny them, and they find another way.

<!-- DEMO VIDEO: embed <10MB MP4 here before submission -->

---

## The 60-second story

1. **You break production.** Press `▶ Ship v1.4.2` — a real deploy script swaps the payments
   container to a release with a baked-in bug. Error rate climbs. The alert fires *because of you*.
2. **The crew scrambles.** A commander fans out four investigators — deploys, logs, metrics,
   dependencies — each running **real queries** (PromQL against a live Prometheus, real container
   logs, the actual deploy history).
3. **A verifier tries to kill their theory.** Fresh context, adversarial by design. Red herrings
   die before they reach you.
4. **The gate.** The rollback is a destructive tool — TrueForge's **native approval gate** freezes
   the agent and the card is walked to your desk. It will wait all night. **Deny it**, and the crew
   returns with a genuinely different plan.
5. **You sign. The world heals.** The rollback executes against the real Docker world; error rate
   recovers on the live board. The root-cause fix ships as a pull request — **reviewed by Qodo** —
   with a blameless postmortem inside it. Your approval timestamp is in the timeline.

**Counter on the wall: `0 UNAUTHORIZED ACTIONS`.** That's the product.

## Architecture

```
┌─ THE WORLD (docker compose) ────────────┐      ┌─ THE CREW (TrueForge) ─────────────┐
│ api ─▶ payments (v1.4.1 / v1.4.2-bad)   │      │ commander + 4 desks + verifier      │
│ prometheus (alert: 5xx > 5%) · loadgen  │      │  + scribe · dynamic sub-agents      │
│ deploy.sh + deploys.json                │◀────▶│ native approval gate                │
└──────────────┬──────────────────────────┘      │  (destructiveHint → pause →        │
               │ real PromQL · docker logs        │   user.tool_approval)              │
        ┌──────▼──────────┐   MCP (streamable     └──────────────┬─────────────────────┘
        │ ops-mcp v2      │◀──── HTTP) ─────────────────────────┘
        │ 4 read-only +   │                        ┌─ THE CONSOLE (UI) ────────────────┐
        │ 2 destructive   │                        │ pixel night-shift floor (SSE,     │
        │ tools           │                        │  thread_id → characters)          │
        └─────────────────┘                        │ agent-authored generative UI      │
                                                   │  (openui dossiers + approvals)    │
                                                   └───────────────────────────────────┘
```

- **The gate is TrueForge's, not ours.** Our `ops-mcp` marks `rollback_deploy` / `restart_service`
  with honest `destructiveHint` annotations; the harness pauses with `tool.approval_required` and
  resumes only on a typed `user.tool_approval` input. Proven end-to-end via pure API before any UI
  existed.
- **Generative UI:** the crew's dossiers, approval cards, and postmortems are authored by the
  agents as `openui` — every card carries a *view-source* flip showing the code the agent emitted.

## Quickstart

Prereqs: Node 22, Docker Desktop, pnpm.

```bash
# 1. the breakable world (api + payments + prometheus + loadgen)
cd packages/world && docker compose up -d --build

# 2. the crew's hands and eyes
cd ../ops-mcp && npm install && node server.mjs      # :7311/mcp

# 3. the harness
npx @truefoundry/trueforge                            # :8790 — register ops-mcp in Settings → Connectors

# 4. break it
./packages/world/deploy.sh v1.4.2 you "ship the bug" # error rate climbs, alert arms

# 5. heal it — create a session with ops mounted and watch the gate fire
#    (see docs/loop-proof.md for the exact curl sequence)
```

## What's real vs. what's staged

| Real | Staged for the demo |
|---|---|
| Docker services, live traffic, Prometheus + alert rule | The bug itself is authored (a retry-queue misdeploy) |
| PromQL queries, container logs, deploy history the agents read | The incident menu (3 curated failure species) |
| TrueForge's native approval pause + typed resume | Red-herring beat is seeded so the verifier has something to kill |
| The rollback — it genuinely heals the world | Demo video may use recorded takes |
| Qodo reviews on every PR in this repo | — |

## Judging criteria map

| Criterion | Where to look |
|---|---|
| Impact / utility | The incident loop: real telemetry → diagnosis → signed remediation → postmortem |
| Creativity | The Console: pixel night-shift war room + agent-authored generative UI |
| Technical excellence | Native gate proven via API · SSE-driven floor · ops-mcp with honest annotations |
| Sponsor tools | TrueForge runs everything; Qodo reviews every PR (§ Qodo Code Review Evidence) |
| Control & safety | The gate holds forever · deny→alternative loop · `0 unauthorized actions` counter |
| Presentation | Demo video + the artifact itself |

## Qodo Code Review Evidence

<!-- REQUIRED SECTION — populate as PRs land:
| PR | What Qodo found | How we addressed it |
|----|-----------------|---------------------|
Link the filtered PR list + one deep-link to the best review thread. -->

*Trail begins with this repository's first PR.*

## Upstream findings (contributed back)

- **openui interactive actions are inert in stock TrueForge** — `OpenUiFenceBlock` never wires
  `onAction`, so every `@ToAssistant` button silently no-ops. Found, fixed, and verified
  end-to-end; fix on branch `fix/openui-interactive-action-callback` (PR planned).

## Roadmap

*The crew remembers* (postmortem memory, deny-with-reason teaching) · *the crew earns trust*
(graduated autonomy) · *the crew reaches you* (the 2AM phone call — voice escalation that briefs
you and pushes the approval card, never approving by voice).

## Credits & licenses

Behavior-model study: [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) (MIT).
Design references: Munder Difflin, aura.build retro-98, asc11. Fonts: Silkscreen, VT323,
IBM Plex Mono (OFL, Google Fonts). Built solo by [Jayanth Koppala](https://github.com/Jayanthkoppala)
for The Agent Harness Hackathon (WeMakeDevs × TrueFoundry × Qodo), Aug 2026. MIT.
