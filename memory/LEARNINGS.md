# shelf — LEARNINGS (append-only)

Every error → root cause → rule. Auto-compressed when >500 lines (memory-compress.sh).

## 2026-06-20 · A check that prints nothing is not a pass

- **What broke:** the presign verify line counted as green while it printed 0 bytes, because no backend
  environment was set.
- **Root cause:** the check asserted only the exit code, and presign needs `S3_ENDPOINT` (or R2 keys) to mint a URL.
- **Rule:** run presign checks with a backend env set (CI uses throwaway MinIO values), and assert on real output,
  not only the exit code. Tests that need a backend skip out loud when `S3_ENDPOINT` is unset.

## 2026-06-22 · The hook must gate code, not prose

- **What broke:** the PreToolUse footgun hook (P-13) blocked edits to shelf's own docs, because they quote
  `ACL:'public-read'` as something to refuse.
- **Root cause:** the pattern matched the footgun's text anywhere, including Markdown inline code.
- **Rule:** hook patterns match the shape of code that does the wrong thing, never prose that names it. Test every
  new pattern against `identity/`, `brain/` and `skills/` before wiring it.

## 2026-06-22 · MinIO rejects an abort-only lifecycle rule

- **What broke:** `shelf lifecycle set` failed against MinIO with a raw "XML not well-formed" error.
- **Root cause:** MinIO accepts a lifecycle rule only with an Expiration or Transition action; every `Filter`
  variant of an abort-incomplete-multipart-only rule fails. S3 and R2 accept it.
- **Rule:** when a backend rejects the abort-only rule, say so plainly and point to applying it on R2 or S3. Never
  surface a provider's raw schema error as the answer, and keep `NoSuchBucket` and `AccessDenied` loud.

## 2026-09-22 · Never pin a model ID

- **What broke:** `scripts/budget-manager.sh apply` wrote a fixed model ID into local settings, which froze new
  sessions on an old model.
- **Root cause:** the script set `ANTHROPIC_MODEL` instead of leaving the choice to Claude Code.
- **Rule:** never write a model ID into a setting, flag or script; Claude Code's default model upgrades itself.

## 2026-10-19 · An npx bin is a symlink

- **What broke:** `npx -y -p github:naman10parikh/shelf shelf-mcp` exited at once with no output, so the plugin and
  every MCP client got no server.
- **Root cause:** the "run only when invoked directly" guard matched `process.argv[1]` against `server.js`, but npx
  starts the bin through the `node_modules/.bin/shelf-mcp` symlink.
- **Rule:** resolve `argv[1]` with `realpathSync` before any main-module check, and prove every bin through npx from
  GitHub, not only with `node dist/...`.

## 2026-10-20 · Pin the third-party image a gate depends on

- **What broke:** every acceptance run since 20 October failed at "Start MinIO": `pull access denied for
  minio/minio, repository does not exist`. The last green run was on 1 July.
- **Root cause:** the workflow pulled the unpinned upstream `minio/minio` image, which is no longer on Docker Hub;
  `quay.io/minio/minio` refuses anonymous pulls.
- **Rule:** pin the image a gate pulls to a tag that still exists (`bitnamilegacy/minio:2025.7.23-debian-12-r5`),
  say in the workflow why it is pinned, and read the push's CI result before calling a change done.
