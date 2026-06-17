---
title: "Presigned URLs, signed-URL access control, upload validation (June 2026)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, presigned, access-control, validation, security]
researcher: ecosystem (CP123 Wave-R)
---

# Presigned URLs · Signed-URL Access Control · Upload Validation (June 2026)

## THE load-bearing gotcha: presigned PUT cannot enforce size or content-type; POST policy can

This is the single most important real-world fact in this whole domain, and most tutorials get it wrong.

- **Presigned PUT URL:** even if you sign `Content-Length` / `Content-Type` as headers, **S3 does NOT
  enforce `Content-Length` server-side for PUT.** A client can upload a 5 GB file through a URL you
  "limited" to 1 MB. You cannot reliably restrict size or type with presigned PUT.
- **Presigned POST (POST policy):** lets you attach **conditions** that S3 enforces and rejects on
  violation:
  - `["content-length-range", 1048576, 10485760]` → 1 MB–10 MB or the upload fails.
  - `["starts-with", "$Content-Type", "image/"]` → only `image/*` accepted.
  - exact-match conditions on key prefix, ACL, metadata.
Sources: <https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/foundational-best-practices.html>,
<https://oneuptime.com/blog/post/2026-02-12-generate-presigned-post-requests-s3-uploads/view> (2026-02),
<https://medium.com/@speaktoharisudhan/aws-s3-presigned-urls-2da5abeefb4a> (May 2026).

**Rule for shelf:** for *uploads where you must bound size/type at the edge → use presigned POST, not
PUT.* Use PUT only when you fully trust the client or you re-validate server-side after upload.
**Caveat:** `generate_presigned_post` `content-length-range` has had SDK bugs historically
(boto3 #2261 — condition silently ignored in some versions). Verify it actually rejects oversize in a
test, per SDK version. Source: <https://github.com/boto/boto3/issues/2261>.

## Real GitHub breakage threads (high-engagement, agent should know)

- **boto/boto3 #2261** — `generate_presigned_post()` ignoring `content-length-range` condition. The
  exact "I set a size limit and it didn't work" trap. <https://github.com/boto/boto3/issues/2261>
- **aws/aws-sdk-js #1983** — "Invalid according to Policy: Policy Condition with Content-Type when
  trying to upload via POST." The classic POST-policy condition-mismatch error (the form field order /
  exact-match vs starts-with confusion). <https://github.com/aws/aws-sdk-js/issues/1983>
- **aws/aws-sdk-go #1414** — "Can't use presigned URL with specifying Content-Length header." Confirms
  the PUT Content-Length enforcement gap across SDKs. <https://github.com/aws/aws-sdk-go/issues/1414>
- **rusoto #1503** — Content-Length-Range for pre-signed requests (same gap, Rust SDK).

## Presigned URL security best practices (AWS Prescriptive Guidance, current)

Source: <https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/> (PDF + HTML).
1. **Short expiry.** If a URL leaks (logs, screenshots, browser history, Referer header), the blast
   radius is bounded by TTL. Default to minutes, not hours, for uploads.
2. **Least privilege on the signing principal.** A presigned URL can NEVER grant more than the principal
   that signed it. So the IAM role generating URLs must be narrowly scoped (one bucket, one prefix,
   put-only). This is the real guardrail — not the URL itself.
3. **Set `Content-Type` explicitly** to stop browsers interpreting an uploaded file as an executable
   script (stored-XSS via `text/html` upload). Serve user content from a separate cookieless domain.
4. **Scope the key server-side.** Never let the client choose the full object key — you pick the prefix
   (`<user-id>/<uuid>`), client supplies at most a filename you sanitize. Prevents overwrite/traversal.
5. **Monitor.** CloudTrail data events on the bucket to detect abuse of leaked URLs.

## Signed-URL access control for *downloads* (serving private files)

- **S3/R2 presigned GET** — time-boxed read URLs. Simple, but each is unique → cache-busting hurts CDN
  hit rate. Good for one-off private downloads.
- **CDN signed URLs/cookies** — CloudFront signed URLs/cookies, **Cloudflare signed URLs** (via Workers
  / Images / Stream), Bunny token authentication. These let a CDN serve private content with edge
  caching intact — the right pattern for "private but high-traffic." Cloudflare Images supports signed
  URLs for private variants. (Verify exact Cloudflare signing mechanism at build time — it's
  Workers/Access-based, not an S3-style query signature.)
- **Capability vs identity:** a signed URL is a *bearer capability* — anyone with the link has access
  until expiry. For per-user revocable access, gate at your app/edge (check session → 302 to short-TTL
  signed URL), don't hand out long-lived signed URLs.

## Upload validation pipeline (what "validate an upload" actually means in 2026)

A correct pipeline has FIVE checks, and the agent must not skip the post-upload ones:
1. **Pre-sign-time:** authn/authz the requester; decide prefix; (POST policy) bound size + content-type.
2. **At-edge (POST policy):** S3 rejects oversize/wrong-type. (Edge defense, not sufficient alone.)
3. **Post-upload magic-byte sniff:** **never trust the client `Content-Type` or file extension.** Read
   the first bytes and detect the real type (libmagic / `file-type` npm / Apache Tika). An attacker
   renames `evil.html` → `cat.png`; the extension lies. This is the #1 missed step.
4. **Post-upload size/integrity:** confirm actual object size server-side (HEAD); verify checksum
   (S3 trailing CRC32C/SHA256) against an expected value if the client supplied one.
5. **Async scan + quarantine** (virus/malware — see ecosystem-04). Until clean, the object lives in a
   `quarantine/` prefix or is tagged `scan-status=pending` and is NOT served.

**Fleet alignment:** this mirrors Energy's "disk-first, server-confirmed" memory rule
(`feedback_chrome_mcp_durable_storage`) — *the client is never the source of truth; the object store +
server-side re-validation is.* Presigned-POST-then-confirm is the storage analog of that lesson.

## GAPS / unconfirmed
- Cloudflare's exact current signed-URL mechanism for R2 private objects (Workers-mediated vs native) —
  verify in CF docs; it's not an S3-query-string signature like AWS.
- Whether the boto3 `content-length-range` bug is fully fixed in the latest 2026 botocore — must test.
