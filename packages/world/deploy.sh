#!/usr/bin/env bash
# deploy.sh <release> — "deploys" payments at the given release and records it.
# The deploy history (deploys.json) is what the agents read via the ops MCP.
set -euo pipefail
cd "$(dirname "$0")"
REL="${1:?usage: deploy.sh <release e.g. v1.4.2>}"
BY="${2:-dev-bot}"
NOTE="${3:-}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$REL" "$BY" "$NOTE" "$TS" <<'EOF'
import json, sys, pathlib
rel, by, note, ts = sys.argv[1:5]
p = pathlib.Path('deploys.json')
d = json.loads(p.read_text()) if p.exists() else {"service": "payments", "deploys": []}
d["deploys"].append({"id": f"d-{100+len(d['deploys'])+1}", "release": rel, "at": ts, "by": by, "note": note})
d["current"] = rel
p.write_text(json.dumps(d, indent=1))
print("recorded:", rel, "by", by)
EOF

PAYMENTS_RELEASE="$REL" docker compose up -d payments
echo "deployed payments@$REL"
