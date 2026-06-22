#!/usr/bin/env bash
# scripts/serve.sh — launch the shelf cockpit (G1, the local cockpit).
#
# The cockpit is a zero-dependency Node stdlib server (web/server.mjs) + a vanilla-JS SPA
# (web/index.html + web/app.js + web/styles.css). No build step for the SPA. The cockpit is
# READ-MOSTLY — it shells the read-only `shelf brain`/`shelf explain`/`shelf backend pick`/
# `shelf cost estimate` CLI and reads brain/*.md + logs/runs.jsonl + eval/golden/*.json; it never
# mints a presigned URL against a live bucket, uploads, migrates, or touches creds from the browser.
#
# Usage: bash scripts/serve.sh            # serves on http://127.0.0.1:7779
#        SHELF_WEB_PORT=8080 bash scripts/serve.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SHELF_WEB_PORT:-7779}"

# The data views shell the compiled CLI (dist/index.js, the package.json bin entry). Warn (don't
# fail) if dist/ is absent so the chairman knows to build — the server still boots and returns an
# honest 502 on the data endpoints until then.
if [ ! -f "$REPO/dist/index.js" ]; then
  echo "shelf: dist/ not built — the brain/explain/backend/cost views will 502 until you run: pnpm build" >&2
fi

echo "shelf cockpit → http://127.0.0.1:${PORT}  (Ctrl-C to stop)"
exec node "$REPO/web/server.mjs"
