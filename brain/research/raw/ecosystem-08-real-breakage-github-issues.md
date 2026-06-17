---
title: "Real-world breakage — top GitHub issues across the storage/upload stack (June 2026)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, breakage, github-issues, gotchas]
researcher: ecosystem (CP123 Wave-R)
---

# Real-world breakage — the issues that reveal what actually breaks (June 2026)

All verified via `gh search issues` on 2026-06-16. These are the failure modes shelf's harness should
encode as known traps. Grouped by tool.

## Uppy `@uppy/aws-s3` multipart (transloadit/uppy)

- **#6292 (open) — "every part PUT to S3 silently fails on Safari 26.3.1 ('Unknown error', no HTTP
  response)."** Browser-specific multipart breakage with NO error surfaced. The lesson: **always test
  multipart on Safari/iOS**; CORS preflight + Safari's fetch quirks routinely break what works on
  Chrome. <https://github.com/transloadit/uppy/issues/6292>
- **#3783 (open, long-running) — "s3 multipart: upload never completes if computer goes to sleep."**
  Resume-after-sleep is unsolved here — the canonical reason to use tus (true resumability) over raw S3
  multipart for long/large uploads. <https://github.com/transloadit/uppy/issues/3783>
- **#5762 (open) — "Retry on failed multipart upload does not reuse already uploaded parts."** "Resumable"
  multipart that re-uploads everything on retry = not actually resumable. Verify part-reuse on retry in
  any uploader you adopt. <https://github.com/transloadit/uppy/issues/5762>
- **#5667 (open) — "s3 multipart upload parts contain all headers from part PUT requests."** Header
  leakage into stored parts — a subtle correctness/security smell. <https://github.com/transloadit/uppy/issues/5667>

## tusd (tus/tus d) — resumable server

- **#1364 (open) — "Concatenation operation is not idempotent, causing duplicate uploads on retried
  requests."** The tus *concatenation* extension (parallel-chunk-then-concat) can DUPLICATE data on
  retry. If you don't need concatenation, **disable it** (tusd v2.9.0 added the CLI flag to disable it,
  #1281 — and this issue is exactly why). <https://github.com/tus/tusd/issues/1364>
- **#1372 (open) — "filelocker: stale .lock and .stop files not cleaned up on ERR_LOCK_TIMEOUT, causing
  permanent upload failure on network filesystems (SMB/CIFS)."** tusd's default file-locker leaves
  permanent dead locks on network FS. **Lesson: don't back tusd with SMB/CIFS; use S3 store or a proper
  distributed lock.** <https://github.com/tus/tusd/issues/1372>
- **#1036 (closed) — "crash with http2."** HTTP/2 crash class — the v2.10.0 release (2026-06-16) ships
  another HTTP/2 encrypted-connection fix, so this is an ongoing fragile area; pin to v2.10.0+.
- **#1084 (open) — "s3store: Experiment with optimistic part uploads to S3."** Perf ceiling of the
  s3store backend is a live discussion — relevant if you push tusd hard.

## UploadThing (pingdotgg/uploadthing)

- **#1286 (open) — "Intermittent 400 on large (~200MB) client uploads."** The vendor-resumable path has
  large-file reliability issues — corroborates the "presigned-URL TTL bounds the resume window" risk in
  ecosystem-02. <https://github.com/pingdotgg/uploadthing/issues/1286>
- **#1244 (closed) — "Transaction pool connection limit exceeded error in production."** A *managed*
  upload service can still take down YOUR DB via its callback/webhook load — managed != worry-free.
- **#1273 / #1238 (closed)** — Expo / React Native env-var + network-request-failed breakage. Mobile is
  a distinct, fragile surface for managed uploaders.
- **#1166 (closed) — "Error 500 when uploading TIFF files."** Format-specific server-side handling bugs.

## Cloudflare R2 presigned (across many product repos — the pattern, not one repo)

Searching `R2 presigned CORS` across all of GitHub surfaces a *recurring real-world failure cluster* in
2026 app repos (crafter-station/petdex#477 "R2 PUT 401 / XML Unauthorized after presign";
deniss-muhla/voice-echo#5 "Presign + R2 CORS pack"; modernclixlearning/GrowLab#22 "image pipeline never
works"). The signal: **R2 presigned-PUT 401s and CORS failures are the single most common storage
integration bug teams hit in 2026.** Root causes are almost always: (a) signing with the wrong
endpoint/region (R2 wants `auto` region + the account-specific endpoint), (b) missing/incorrect bucket
CORS policy (R2 CORS must be set explicitly via API/dashboard — there's no default), (c) signing
headers the client doesn't send back exactly. **shelf must ship a "R2 presigned + CORS" recipe** because
this is where everyone fails. Sources: `gh search issues "R2 presigned CORS"` (2026-06-16).

## boto3 / aws-sdk presigned-POST (cross-SDK, see also ecosystem-03)

- **boto3 #2261 — `generate_presigned_post()` ignoring `content-length-range`.** Size limit silently not
  enforced. <https://github.com/boto/boto3/issues/2261>
- **aws-sdk-js #1983 — "Invalid according to Policy: Policy Condition with Content-Type."** POST-policy
  condition mismatch (exact-match vs starts-with, field ordering).
- **aws-sdk-go #1414 — "Can't use presigned URL with specifying Content-Length."** Confirms PUT can't
  enforce size across SDKs.

## The meta-lessons (what these issues collectively teach)

1. **CORS is the #1 cause of "upload doesn't work."** Every direct-to-bucket setup needs an explicit,
   correct CORS policy; R2 especially (no default CORS). Test the preflight (`OPTIONS`) explicitly.
2. **Safari/iOS breaks multipart that works on Chrome.** Always test the worst browser.
3. **"Resumable" is a spectrum** — verify part-reuse-on-retry and resume-after-sleep, don't trust the
   label. tus is the only path that reliably survives sleep/network-drop.
4. **Managed uploaders still fail on large files + mobile + your DB load.** Not a silver bullet.
5. **Presigned PUT can't enforce size/type; SDK bugs make even POST-policy size limits unreliable —
   re-validate server-side, always.**
