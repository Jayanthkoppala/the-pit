---
name: postmortem
description: Write a blameless postmortem from the incident's evidence ledger — trigger, root cause, and contributing factors as distinct fields — and ship it inside the fix PR.
---

# Write the postmortem

The postmortem is the incident's lasting artifact. It is **blameless**: it names systems,
gaps, and decisions — never fault in people. Its authority comes from the investigation's
receipts: every timeline entry links to the query that proved it.

## Required fields, in order

1. **Summary** — 1–3 sentences a non-engineer can read: what users experienced, for how long,
   and how it ended.
2. **Impact, quantified** — duration, requests/users affected, and (if known) revenue or SLO
   budget consumed. Say "not measured" rather than guessing.
3. **Timeline** — timestamped, built from the evidence ledger. Include the *investigation's own
   dead ends* ("14:32 — cache-hit drop flagged; verifier ruled it symptom, not cause") — they
   prove rigor and teach the next responder. Include the human decisions verbatim: what was
   denied, what was approved, and when.
4. **Trigger ≠ Root cause ≠ Contributing factors** — three distinct fields, never merged:
   - *Trigger*: the event that set it off (the deploy, the flag, the spike).
   - *Root cause*: why the system allowed the trigger to become an outage.
   - *Contributing factors*: everything that widened the blast or slowed the response.
5. **Detection** — how it was found, time-to-detect, and whether detection could fire earlier.
6. **Response & resolution** — mitigation vs long-term fix, clearly separated; who/what approved
   the irreversible steps.
7. **What went well / what went poorly / where we got lucky** — three honest lists.
8. **Action items** — a table: description · type (mitigate / prevent / process) · owner ·
   tracking link. Every root cause and contributing factor gets at least one item.
9. **Supporting receipts** — the raw queries, dashboards, and log excerpts the timeline cites,
   **redacted before they are committed.** These land permanently in the PR and repo history, so
   strip credentials, tokens, connection strings, cookies/headers, PII, and customer identifiers
   first — replace each with a typed placeholder (`<REDACTED:token>`). If a receipt cannot be
   safely redacted, cite it by query and result shape instead of pasting it. When in doubt, leave
   it out.

## Delivery

- The postmortem ships **inside the root-cause fix PR** as
  `postmortems/YYYY-MM-DD-<slug>.md`, so the reviewer (human and Qodo) sees the fix and its
  story together, and the repository keeps the record.
- If an incident ticket/issue exists, close it from the PR (`Closes #N`).
- Render the interactive version as generative UI (openui) where the host supports it —
  timeline as steps, impact as a table, outcomes as callouts. The markdown file remains the
  canonical record.

## Style

Plain language over jargon; past tense; no hedging in the summary (hedge in the analysis where
evidence is genuinely uncertain); short sentences. The reader is the next engineer at 3AM —
write what you would want to find.
