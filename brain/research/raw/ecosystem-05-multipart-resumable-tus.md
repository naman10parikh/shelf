---
title: "Multipart & Resumable Uploads — tus protocol, tusd, S3 multipart (June 2026)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, upload, tus, multipart, resumable]
researcher: ecosystem (CP123 Wave-R)
---

# Multipart & Resumable Uploads (June 2026 state of the art)

## The two distinct mechanisms (do not conflate)

1. **S3 multipart upload** — server/SDK-side chunking of ONE large object into parts (5 MiB–5 GiB each,
   max 10,000 parts, object max 5 TiB). Solves "object too big for one PUT" + parallel part upload.
   NOT inherently resumable across a browser refresh unless you persist the `UploadId` + part ETags
   client-side. Native to S3, R2, Tigris, B2 (all S3-compatible). Source: AWS S3 multipart limits are
   long-stable; <https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html> (limits unchanged
   through 2026).
2. **tus** (resumable upload protocol) — an HTTP-layer protocol (PATCH with `Upload-Offset`) that makes
   uploads *resumable across network drops / page reloads*. This is the thing you reach for when the
   client is flaky (mobile, big video). tus can sit IN FRONT of S3 (tusd's `s3store` backend uploads
   to S3 multipart under the hood). Source: <https://tus.io/protocols/resumable-upload> (1.0.x).

The agent-relevant mental model: **multipart = "big file, one session"; tus = "any file, survives
interruption."** They compose: tusd `s3store` = tus on the wire, S3 multipart at rest.

## tusd (reference Go server) — versions & last-6-months deltas

`tusd` is THE reference server. Verified via `gh api repos/tus/tusd/releases` on 2026-06-16:

| Version | Date | What changed (load-bearing) |
|---|---|---|
| **v2.10.0** | **2026-06-16** (today) | hooks: option to disable TLS verification (#1359); azurestore: fix `InvalidHeaderValue` from empty sentinel block (#1379); cli: fix HTTP/2 encrypted-connection bug (90f7b8e). |
| v2.9.2 | 2026-03-11 | patch |
| v2.9.1 | 2026-02-21 | patch |
| **v2.9.0** | **2026-02-21** | **hooks: add timeout + size limit to HTTP hooks, enforce Content-Type (#1279)** — directly relevant to the upload-validation flow (you can now bound how long a validation hook runs); azurestore: Entra ID token auth; cli/handler: option to disable the concatenation extension (#1281, attack-surface reduction); s3store: corrected part-deletion metric label (#1331); handler: fix panic in hook-emitting logic (#1337). |
| v2.8.0 | 2025-04-02 | (prior major-minor) |

Source for all rows: `gh api repos/tus/tusd/releases/tags/<tag> --jq '.body'` (run 2026-06-16);
release list at <https://github.com/tus/tusd/releases>.

**v2 (Sept 2023) is still the current major.** tusd v2's headline was reworked hooks (pre-create,
post-finish, post-terminate, pre-finish) + network resilience; "battle-tested at scale at Transloadit",
"no breaking changes in the HTTP interface — v1 clients keep working." Source:
<https://tus.io/blog/2023/09/20/tusd-200> (Sept 20 2023). **Gotcha:** the v1→v2 break was in the *hook
config/CLI surface*, not the wire protocol — migrations that fail usually fail on hook scripts, not
clients.

### Cloudflare maintains a tusd fork
`github.com/cloudflare/tusd` exists — Cloudflare Stream's resumable upload is tus-based. Signal that
tus is the de-facto standard for resumable video ingest, not a niche. Source:
<https://github.com/cloudflare/tusd>.

## tus clients

- **tus-js-client** v4.3.1 (2025-01-16, `gh api` verified) — the canonical browser/Node client. NOTE:
  it has NOT shipped a release in ~17 months as of June 2026. Stable/mature, but flag staleness:
  contributors are active on issues but cadence is slow. <https://github.com/tus/tus-js-client>.
- UploadThing's `createUpload` (v7) implements resumable flows *without* tus — it's presigned-URL +
  client-tracked offset (see ecosystem-02 UploadThing). So "resumable" in 2026 has two camps:
  tus-protocol (open, portable) vs vendor-resumable (UploadThing, Uppy+companion).
- **Uppy** (Transloadit) remains the dominant *front-end* widget; its `@uppy/tus` plugin speaks tus,
  `@uppy/aws-s3` speaks S3 multipart directly. Uppy is the "batteries-included" UI most teams adopt.

## S3 multipart gotchas an agent must know (real breakage)

1. **Orphaned multipart uploads cost money silently.** If a multipart upload is started but never
   completed/aborted, the parts persist and are billed as storage, and they are INVISIBLE in a normal
   `ListObjects`. You must `ListMultipartUploads` + `AbortMultipartUpload`, OR set a lifecycle rule
   "abort incomplete multipart uploads after N days." This is the #1 surprise S3 bill. (R2 has the same
   trap; R2 lifecycle supports `AbortIncompleteMultipartUpload`.) — well-documented AWS footgun;
   confirm per-provider lifecycle support before relying on it.
2. **Min part size = 5 MiB for all parts except the last.** A common bug: chunking at 1 MB → S3 rejects
   `CompleteMultipartUpload` with `EntityTooSmall`.
3. **ETag of a multipart object is NOT the MD5 of the file** — it's `MD5(concat(part MD5s))-N`. Code
   that verifies integrity by comparing ETag to a local md5sum breaks for multipart objects. Use
   checksums (S3 now supports CRC32/CRC32C/SHA1/SHA256 trailing checksums) instead.
4. **Presigned multipart is 3 calls, not 1:** presign `CreateMultipartUpload` (or do it server-side),
   presign EACH `UploadPart`, then presign/complete `CompleteMultipartUpload`. Many "presigned upload"
   tutorials only cover single-PUT and silently cap you at the single-PUT ceiling.

## What an AGENT operating uploads needs

- There is **no first-party tus MCP server** as of June 2026 (searched; none canonical). An agent
  drives tusd via its HTTP API (POST to create, PATCH to append) or via `tus-js-client` in a Node
  script. For S3 multipart, the **AWS CLI** (`aws s3 cp` auto-multiparts >8MB) and the AWS SDK are the
  agent's hands; `rclone` is the best multi-backend CLI (does multipart + resumable-ish chunking across
  S3/R2/B2/Tigris).
- Practical agent rule: for files <100 MB and a stable connection, a single presigned PUT is simplest.
  Reach for multipart >100 MB; reach for tus only when resumability across interruptions is required.

## GAPS / unconfirmed
- Could not confirm an exact IETF RFC number for the resumable-uploads draft graduating (still
  `draft-ietf-httpbis-resumable-upload` as of last check; flag as "draft, not RFC yet").
- Could not confirm a 2026 tus-js-client release — last is Jan 2025; treat client as mature-but-slow.
