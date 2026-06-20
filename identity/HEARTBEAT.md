# shelf — Heartbeat

> What a storage employee checks on a schedule. Heavy on the failure modes a 2am page teaches: the
> invisible orphaned-multipart bill, egress blowups, and stale safe-serve defaults. Operationalized by
> the dogfood lifecycle-audit cron (`.github/workflows/`, RSI loop) — `O-17`/`S11`/`O-01`.

## Schedule

| Check | Frequency | Action on Anomaly |
| --- | --- | --- |
| **Orphaned-multipart sweep** — `shelf lifecycle orphans` on the demo bucket | Daily | If orphans found OR no abort-incomplete rule set → run `shelf lifecycle set --abort-after-days 7` and log it (`O-17`, `P-24`) |
| **Egress drift watch** — sample egress volume, not GB stored | Daily | If egress trend spikes → flag for CDN-in-front review; never size the bill from storage (`O-01`) |
| **Tool-matrix drift** — re-verify R2/S3 pricing, boto3 `content-length-range` bug, tusd patch, CloudFront cap, R2-MCP-presign (V-entries) | Per RSI run | If a pinned number/version moved OR a tool went archived/EOL → propose a brain/skill update via the deterministic RSI loop (`O-28`, `P-39`) |
| **Eval regression** — `shelf eval` (L1+L2) | Per RSI run / pre-commit | If a golden task regresses → snap-back; do not land the diff |
| **Safe-serve defaults** — `shelf serve-config` still emits forced-type + attachment + nosniff | Weekly | If a default drifted → restore the two-sided serve headers (`O-11`/`P-08`) |
| **Run-telemetry health** — `logs/runs.jsonl` getting real `durationMs` + `trace.id` | Every run | If all-zero markers appear → fix the observability layer (not a healthy heartbeat) |

## Health Indicators

- **Healthy:** abort-incomplete rule set on every upload bucket, no orphaned multiparts, `shelf eval`
  green, runs.jsonl recording measured durations.
- **Warning:** orphaned multiparts detected, or a tool-matrix V-entry drifted from its pinned snapshot,
  or one golden task flaky (<pass^3).
- **Critical:** a bucket serving objects before scan-clean (`O-18`), or `ACL:'public-read'` /
  filename-in-key / `new Map()`-upload-state reaching a commit (the hook should have blocked it),
  or the acceptance merge gate red.

## Recovery

1. Read the failing check's evidence (`logs/runs.jsonl`, the RSI drift-watch diff, or the eval report).
2. Check `brain/KNOWN-PITFALLS.md` for the matching P-id and its documented avoidance.
3. If fixable deterministically (lifecycle rule, pin bump, config) → apply, re-run the eval gate, commit
   only if green.
4. If it needs prose/judgement (a drifted dispute, a new CVE → new golden task) → the Claude-half RSI
   path handles it once `CLAUDE_CODE_OAUTH_TOKEN` is set; until then, log to the chairman checklist.
