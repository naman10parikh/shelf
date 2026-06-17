---
title: "shelf Known Pitfalls — version-specific gotchas with detection + avoidance"
type: synthesis
created: 2026-06-16
tags: [shelf, brain, pitfalls, gotchas, version-specific]
sources:
  - "raw/ecosystem-01-storage-providers.md"
  - "raw/ecosystem-02-uploadthing-and-upload-libs.md"
  - "raw/ecosystem-03-presigned-access-control-validation.md"
  - "raw/ecosystem-04-virus-scanning.md"
  - "raw/ecosystem-05-multipart-resumable-tus.md"
  - "raw/ecosystem-06-image-optimization-cdn.md"
  - "raw/ecosystem-07-lifecycle-retention.md"
  - "raw/ecosystem-08-real-breakage-github-issues.md"
  - "raw/ecosystem-09-agent-operation-clis-mcp.md"
  - "raw/field-02-upload-security-rce-xss-ssrf.md"
  - "raw/field-04-presigned-urls-large-files-timeouts.md"
  - "raw/field-05-cdn-cache-invalidation.md"
  - "raw/field-06-2026-shifts-taste-disputes-synthesis.md"
summary: "The gotcha list. Each entry: the trap, the version/context where it bites, how to DETECT it, how to AVOID it, source. Skim before touching any storage code."
---

# shelf Known Pitfalls

> Read this before writing storage code. Each pitfall is: **Trap → When it bites → Detect → Avoid →
> Source.** Full scenarios in [[BATTLE-TESTED-SCENARIOS.md]]; the why-this-matters stances in
> [[OPINIONS.md]]; tool versions in [[TOOL-MATRIX.md]].

---

## A. Presigned-URL pitfalls

### P-01 — Presigned PUT silently ignores your size/type limit
- **Trap.** Signing `Content-Length`/`Content-Type` as headers on a presigned **PUT** does **not** bound
  the upload; S3 doesn't enforce `Content-Length` for PUT. Client uploads 5 GB through a "1 MB" URL.
- **When.** Any presigned-PUT flow; all SDKs (aws-sdk-go #1414 confirms cross-SDK).
- **Detect.** Test: generate a "1 MB" PUT URL, upload a 10 MB file — if it succeeds, you have the bug.
- **Avoid.** Use presigned **POST policy** with `["content-length-range", min, max]`; re-validate size
  server-side via HEAD after upload.
- **Source.** [[raw/ecosystem-03-presigned-access-control-validation.md]] (load-bearing gotcha).

### P-02 — `generate_presigned_post()` content-length-range silently not enforced (boto3)
- **Trap.** Even POST policy can silently ignore `content-length-range` in some boto3/botocore versions.
- **When.** boto3 — issue #2261; verify whether fixed in current 2026 botocore.
- **Detect.** Test that an oversize POST upload is actually **rejected** by S3, per SDK version.
- **Avoid.** Pin/verify the SDK version; always add server-side size re-validation as backstop.
- **Source.** [[raw/ecosystem-03-presigned-access-control-validation.md]],
  [[raw/ecosystem-08-real-breakage-github-issues.md]] (boto3 #2261).

### P-03 — SDK auto-signs headers the browser can't send (`amz-sdk-request`)
- **Trap.** The SDK injects internal headers (`amz-sdk-request`, `amz-sdk-invocation-id`, content
  checksums) into the **signed** set; the browser never sends them → `403 SignatureDoesNotMatch`,
  misdiagnosed as CORS.
- **When.** Documented on AWS SDK Go v2; the *principle* (SDK signs un-sendable headers) spans SDKs;
  exact header names are SDK/version-specific (not re-verified for June 2026).
- **Detect.** Diff the **canonical request**: compare `SignedHeaders` to the headers the browser
  actually sends. If the failing request is the `OPTIONS` preflight, suspect signature drift, not CORS.
- **Avoid.** Return the exact signed-header set to the client (send only those); or prefer presigned
  **POST policy** (signs fields/conditions, not arbitrary headers).
- **Source.** [[raw/field-04-presigned-urls-large-files-timeouts.md]] §1.

### P-04 — URL dies before its stated expiry (temp-cred / STS-session ceiling)
- **Trap.** A "24h" presigned URL signed in a Lambda dies at ~1h.
- **When.** Signing with temporary credentials (Lambda exec role / assumed role); SigV4 7-day hard cap.
- **Detect.** Effective expiry = `min(set-expiry, remaining-STS-session)`. If signed by a role, assume
  ~1h default STS session.
- **Avoid.** Re-issue short-TTL URLs on demand (gate at edge → 302), or sign with long-term IAM user
  creds (accepting key-management risk).
- **Source.** [[raw/field-04-presigned-urls-large-files-timeouts.md]] §2.

### P-05 — Clock skew / proxy rewrites → SignatureDoesNotMatch (almost never "wrong key")
- **Trap.** SigV4 embeds a timestamp; >15 min clock skew = instant fail. Corporate proxies that
  reorder/strip query params or rewrite headers break the signature.
- **When.** Any signer with drifting clock; any client behind a mutating proxy.
- **Detect.** Diff the canonical request; check signer's NTP sync; check for an intermediary proxy.
- **Avoid.** NTP-sync every signer. Debug by diffing canonical requests, **not** by rotating creds.
- **Source.** [[raw/field-04-presigned-urls-large-files-timeouts.md]] §3.

### P-06 — Don't return long expiry as the "feature"
- **Trap.** Long-lived presigned URLs are bearer capabilities — anyone with the leaked link (logs,
  screenshots, Referer) has access until expiry.
- **When.** Any private-download flow using long-TTL signed URLs.
- **Detect.** Search logs/Referer headers/screenshots for leaked signed URLs.
- **Avoid.** Short expiry (minutes); for revocable per-user access, gate at app/edge → 302 to a fresh
  short URL; narrowly-scope the signing principal (one bucket/prefix/put-only).
- **Source.** [[raw/ecosystem-03-presigned-access-control-validation.md]] (best practices 1, 2).

## B. Upload-security pitfalls

### P-07 — Trusting client `Content-Type` / extension (the #1 CVE root cause)
- **Trap.** Validating by the request `Content-Type` header or filename extension. Both are
  attacker-controlled.
- **When.** Every upload endpoint; real CVEs Postiz CVE-2026-40487, Kuno CVE-2025-61681.
- **Detect.** Try uploading `evil.html` renamed `cat.png` with a spoofed `Content-Type: image/png` — if
  it passes, you trust the client.
- **Avoid.** Validate by **magic bytes / structure** (libmagic / `file-type` / Apache Tika) + extension
  **allowlist**.
- **Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §1, §2, §7.

### P-08 — Serving layer re-derives Content-Type from extension (the two-sided footgun)
- **Trap.** You validate on upload, but nginx/your serving layer sets `Content-Type` from the file
  extension → `.html`/`.svg` execute in your origin → stored XSS.
- **When.** Static file serving (nginx/Apache/CDN) that derives type from extension.
- **Detect.** Upload a `.html` with `<script>`; open the served URL — if it executes, your serve side is
  unsafe.
- **Avoid.** Force a safe `Content-Type`, `Content-Disposition: attachment`, `X-Content-Type-Options:
  nosniff` on serve; serve from a **separate cookieless domain** with CSP; use random server keys (no
  user extension in the served path).
- **Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §1.

### P-09 — Treating SVG as a safe image
- **Trap.** SVG is an XML **document** — XSSes the browser (event handlers) and SSRFs the server
  (`<image xlink:href>` / external entities) when server-side-rendered (e.g. thumbnailing).
- **When.** Any flow accepting SVG; Kuno CVE-2025-61681 (XSS) + CVE-2025-61768 (SSRF).
- **Detect.** Upload an SVG with `<image xlink:href="http://169.254.169.254/...">` and watch for an
  outbound server request; upload one with an `onload` handler and open it.
- **Avoid.** Refuse SVG from untrusted users; or rasterize to PNG in a **sandbox** and discard the
  original; block the cloud metadata endpoint at the network layer.
- **Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §2, §3.

### P-10 — Running server-side image transforms on untrusted input without hardening
- **Trap.** ImageMagick "delegate" command-injection (ImageTragick) is still exploitable; the transform
  library becomes part of your attack surface.
- **When.** Any server-side thumbnail/convert on user media (ImageMagick / unhardened libs).
- **Detect.** Audit which transform lib processes user input; check `policy.xml` for enabled risky
  delegates.
- **Avoid.** Pin versions; disable risky delegates via `policy.xml`; **re-encode** media (strips
  polyglot payloads + EXIF); run transforms in a sandbox.
- **Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §4, §5.

### P-11 — Validating type but not resource consumption (zip bomb / pixel flood)
- **Trap.** A 42 KB zip → 4.5 PB; a 50,000×50,000 PNG ≈ tiny on disk but OOMs the decode lib.
- **When.** Any service that decompresses or decodes user uploads (avatar-in-zip, doc import, image
  transform).
- **Detect.** Upload a known zip bomb / huge-dimension image to a staging worker; watch RAM/disk.
- **Avoid.** Cap decompressed size + entry count + compression ratio + pixel dimensions + processing
  time; stream-decompress with a hard ceiling; never extract to RAM disk without quota; treat nested
  archives as hostile.
- **Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §6.

### P-12 — Echoing the user's filename into the object key
- **Trap.** Path traversal (`../../etc/...`), non-ASCII encoding mismatch (P-15), overwrite-in-place
  cache staleness — all from putting the user filename in the key.
- **When.** Any "preserve the original filename as the key" design.
- **Detect.** Try a filename with `../`, with `й`/em-dash, and a duplicate filename — watch for
  traversal / sign-mismatch / overwrite.
- **Avoid.** Random UUID key; original filename in metadata/DB; `Content-Disposition: attachment;
  filename*=UTF-8''...` on download.
- **Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §8,
  [[raw/field-04-presigned-urls-large-files-timeouts.md]] §6.

## C. Platform-default-shift pitfalls (2026)

### P-13 — `ACL:'public-read'` on putObject now throws (ACLs disabled by default)
- **Trap.** S3 Object Ownership defaults to **BucketOwnerEnforced** → ACLs disabled. Setting an object
  ACL fails with **`AccessControlListNotSupported`** (400). PUTs must use `bucket-owner-full-control` or
  no ACL.
- **When.** Default S3 buckets since 2023; any pre-2023 tutorial/snippet.
- **Detect.** Grep code for `ACL:` / `'public-read'` on putObject; run it against a new bucket.
- **Avoid.** Remove object ACLs; use **bucket policy** (after deliberately disabling BPA) or a **CDN**
  for public read.
- **Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §1b.

### P-14 — Auditing "is the bucket public?" instead of "did someone disable Block Public Access?"
- **Trap.** **Block Public Access is ON by default** for new buckets — exposure now requires
  *deliberately* turning off guardrails. The new failure mode is "someone disabled BPA for a quick fix
  and forgot," not fresh-default exposure.
- **When.** Any access-audit; 2026 onward.
- **Detect.** Audit for **changes to** BPA (CloudTrail / config history), not just current public state.
- **Avoid.** Treat BPA as a tripwire; alert on BPA being disabled; prefer CDN-fronted serving over ever
  making a bucket public.
- **Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §1a.

## D. Multipart & resumable pitfalls

### P-15 — Non-ASCII / special-char key encoding mismatch
- **Trap.** Key with `й`, em-dash `–`, space, `+`, `#`: sign-time encoding ≠ upload-time encoding →
  "No file found" / signature mismatch.
- **When.** Any key containing user-supplied special chars (UploadThing #153).
- **Detect.** Upload a file named `Письмо – Май.pdf`; watch for upload-then-fail.
- **Avoid.** Random UUID keys (see P-12); never byte-mangle a user string into a signed key.
- **Source.** [[raw/field-04-presigned-urls-large-files-timeouts.md]] §6.

### P-16 — Chunking below 5 MiB → EntityTooSmall
- **Trap.** Multipart parts must be ≥5 MiB (except the last); 1 MB chunks → `CompleteMultipartUpload`
  rejects with `EntityTooSmall`.
- **When.** Hand-rolled multipart with small chunks; S3/R2/B2/Tigris.
- **Detect.** Complete a multipart with a 1 MB part — fails.
- **Avoid.** Chunk ≥5 MiB (only the last part may be smaller); or use `@aws-sdk/lib-storage` `Upload`
  which handles sizing.
- **Source.** [[raw/ecosystem-05-multipart-resumable-tus.md]] (multipart gotchas).

### P-17 — Verifying integrity with ETag == file MD5 (wrong for multipart)
- **Trap.** A multipart object's ETag is `MD5(concat(part MD5s))-N`, **not** the file's MD5. Integrity
  checks comparing ETag to a local `md5sum` break for multipart objects.
- **When.** Any integrity check on multipart-uploaded objects.
- **Detect.** Upload a >1-part object; compare ETag to file md5sum — they differ, with a `-N` suffix.
- **Avoid.** Use trailing checksums (CRC32/CRC32C/SHA1/SHA256), not ETag, for multipart integrity.
- **Source.** [[raw/ecosystem-05-multipart-resumable-tus.md]] (multipart gotchas).

### P-18 — Presigned multipart is 3 calls, not 1 (tutorials only show single-PUT)
- **Trap.** Many "presigned upload" tutorials cover single-PUT only → you silently cap at the single-PUT
  ceiling (5 GB) and can't do large/parallel uploads.
- **When.** Following a single-PUT tutorial for large files.
- **Detect.** Try to upload >5 GB via single presigned PUT — fails.
- **Avoid.** Presign `CreateMultipartUpload` (or do it server-side), presign **each** `UploadPart`, then
  `CompleteMultipartUpload`.
- **Source.** [[raw/ecosystem-05-multipart-resumable-tus.md]] (multipart gotchas).

### P-19 — "Resumable" that doesn't resume (sleep / retry re-upload)
- **Trap.** Raw S3 multipart is not resumable across sleep/network-drop by default; retry can re-upload
  already-done parts.
- **When.** Uppy `@uppy/aws-s3` multipart (#3783 sleep, #5762 retry re-upload).
- **Detect.** Sleep the machine mid-upload; resume — if it stalls or re-uploads everything, it's not
  truly resumable.
- **Avoid.** Use **tus** for resume-after-sleep; if on raw multipart, persist `UploadId` + part ETags
  and verify part-reuse-on-retry.
- **Source.** [[raw/ecosystem-08-real-breakage-github-issues.md]] (Uppy #3783, #5762).

### P-20 — Multipart that works on Chrome breaks on Safari/iOS
- **Trap.** Each part PUT silently fails on Safari ("Unknown error", no HTTP response) while Chrome is
  fine (Uppy #6292).
- **When.** Browser multipart, especially with imperfect CORS preflight; Safari/iOS.
- **Detect.** Always test multipart on Safari/iOS; watch for swallowed part failures.
- **Avoid.** Set CORS explicitly (R2 has no default — cover preflight for every method/header); surface
  part errors; pin a current uploader.
- **Source.** [[raw/ecosystem-08-real-breakage-github-issues.md]] (Uppy #6292).

### P-21 — tusd concatenation extension duplicates data on retry
- **Trap.** tus concatenation (parallel-chunk-then-concat) is **non-idempotent** → duplicate uploads on
  retried requests (tusd #1364).
- **When.** tusd with concatenation enabled.
- **Detect.** Retry a concat request; check for duplicate stored data.
- **Avoid.** **Disable concatenation** unless you need it — the disable CLI flag landed in tusd v2.9.0
  (#1281) for exactly this; pin **v2.10.0+**.
- **Source.** [[raw/ecosystem-05-multipart-resumable-tus.md]] (tusd deltas),
  [[raw/ecosystem-08-real-breakage-github-issues.md]] (tusd #1364).

### P-22 — Backing tusd with SMB/CIFS → permanent dead locks
- **Trap.** tusd's default file-locker leaves stale `.lock`/`.stop` files on `ERR_LOCK_TIMEOUT` over
  network filesystems → permanent upload failure (tusd #1372).
- **When.** tusd file-locker on SMB/CIFS/network FS.
- **Detect.** Look for orphaned `.lock`/`.stop` files; uploads to a key permanently fail.
- **Avoid.** Use the **S3 store** (not network FS) or a proper distributed lock; never back tusd with
  SMB/CIFS.
- **Source.** [[raw/ecosystem-08-real-breakage-github-issues.md]] (tusd #1372).

### P-23 — tusd HTTP/2 crash/encrypted-connection class
- **Trap.** HTTP/2 crash bugs recur (tusd #1036 closed; v2.10.0 ships another HTTP/2 encrypted-connection
  fix on 2026-06-16).
- **When.** tusd over HTTP/2; older patch versions.
- **Detect.** Crashes/hangs under HTTP/2.
- **Avoid.** Pin **tusd v2.10.0+**.
- **Source.** [[raw/ecosystem-05-multipart-resumable-tus.md]] (v2.10.0),
  [[raw/ecosystem-08-real-breakage-github-issues.md]] (tusd #1036).

## E. Cost / lifecycle pitfalls

### P-24 — Orphaned multipart uploads bill as invisible storage forever (#1 mystery bill)
- **Trap.** Started-but-never-completed/aborted multiparts persist, bill as storage, and are invisible
  to normal `ListObjects`.
- **When.** Every bucket that accepts multipart (S3 and R2).
- **Detect.** `rclone backend list-multipart-uploads <remote>:` (or `ListMultipartUploads`); compare to
  visible object total.
- **Avoid.** Set a lifecycle rule to **abort incomplete multipart uploads after N days** on every
  upload bucket, day one.
- **Source.** [[raw/ecosystem-05-multipart-resumable-tus.md]], [[raw/field-04-presigned-urls-large-files-timeouts.md]] §5,
  [[raw/ecosystem-07-lifecycle-retention.md]] §1.

### P-25 — R2 Class A (write) fees bite write-heavy/many-tiny-object workloads
- **Trap.** R2 egress is free, but Class A ops are `$4.50/M` — at 100M writes/mo = $450/mo just in
  write fees. Thumbnail gen / log shipping / per-event object writes get expensive.
- **When.** Write-heavy ingestion on R2.
- **Detect.** Project Class A op count × $4.50/M before migrating a write-heavy workload to R2.
- **Avoid.** For write-heavy, reconsider R2 vs S3; batch writes; don't assume "free egress = free."
- **Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3,
  [[raw/ecosystem-01-storage-providers.md]] (R2 gotchas).

### P-26 — R2 is the WRONG default for cold/archival (storage premium + no tiering)
- **Trap.** R2 storage `$0.015/GB` is ~2.5× Wasabi/B2; R2 has no Glacier/IA transition → ~69% pricier
  than S3+lifecycle on data-lake/cold workloads.
- **When.** Write-once-read-never archives / cold data on R2.
- **Detect.** If egress ≈ 0 and data is cold, R2's egress benefit is unused — you're paying the premium
  for nothing.
- **Avoid.** Cold archive → **B2 / Wasabi**; tiered data-lake → **S3 (Glacier/IA)**.
- **Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3,
  [[raw/field-03-migration-war-stories.md]] §1.

### P-27 — Forgetting the one-time exit egress when leaving S3
- **Trap.** Migrating off S3 pays S3 egress once for the **full dataset** (`$0.09/GB × stored`; NixOS
  ≈ $32K). Often un-budgeted.
- **When.** Any S3→anywhere migration (Super Slurper reads from S3 → metered).
- **Detect.** `$0.09 × total-GB-stored` = the exit cost. If it's not in the migration budget, it's a
  surprise.
- **Avoid.** Budget it explicitly; weigh against the savings before committing.
- **Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3, §3b,
  [[raw/field-03-migration-war-stories.md]] §2.

### P-28 — In-VPC S3 via NAT Gateway billed as data-processing (~$0.045/GB)
- **Trap.** Private-subnet Lambda/EC2 reading "free" in-region S3 through a NAT Gateway is billed at NAT
  data-processing rates on top. Top-5 silent inflator.
- **When.** S3 access from a private subnet without a gateway endpoint.
- **Detect.** NAT data-processing charges on the bill; trace S3 traffic path.
- **Avoid.** Use an **S3 Gateway VPC Endpoint** ($0); collapse cross-AZ chatter.
- **Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §4.

### P-29 — Compliance-mode Object Lock is irreversible AND creation-time-only
- **Trap.** Compliance mode = nobody (not even root) can delete/shorten until expiry — a wrong 7-year
  lock on 1 PB = 7 years of bills. And Object Lock **can't be added to an existing bucket**.
- **When.** Setting WORM; any bucket that might need WORM later.
- **Detect.** Before enabling: is this the right retention? Is the bucket created with Object Lock +
  versioning?
- **Avoid.** Test with **short** retentions first; default to **governance** mode unless a regulator
  demands compliance; enable Object Lock **at bucket creation** if WORM is ever plausible.
- **Source.** [[raw/ecosystem-07-lifecycle-retention.md]] §"Object Lock".

### P-30 — Promising certified WORM on R2 (Bucket Locks are governance-grade only)
- **Trap.** R2 Bucket Locks ≈ S3 **governance** mode (admins can remove rules) — not compliance mode.
  R2 can't do certified WORM (SEC 17a-4).
- **When.** Compliance customer + R2.
- **Detect.** If the requirement is *certified* immutability and the bucket is R2 → mismatch.
- **Avoid.** Route certified WORM to **S3 compliance mode** or **B2 compliance mode**; don't promise it
  on R2.
- **Source.** [[raw/ecosystem-07-lifecycle-retention.md]] §"shelf taste on WORM".

## F. CDN / caching pitfalls

### P-31 — "I changed the S3 object, the CDN will notice" (it won't)
- **Trap.** CloudFront serves the cached version until TTL or explicit invalidation — it does **not**
  detect an S3 object change.
- **When.** Overwrite-in-place + CDN.
- **Detect.** Change an object in S3; the CDN keeps serving the old one.
- **Avoid.** Content-hashed immutable URLs (new content = new URL); for user uploads, immutable keys +
  DB pointer; reserve invalidation for emergencies.
- **Source.** [[raw/field-05-cdn-cache-invalidation.md]] §3.

### P-32 — Wildcard `/*` invalidation → origin thundering herd + 15-path cap
- **Trap.** `/*` purge makes every edge fetch fresh from origin simultaneously (stampede); max **15
  invalidation paths in progress** → `TooManyInvalidationsInProgress`; propagation is **10–60 s** (not
  atomic).
- **When.** Purge-on-every-deploy strategies at scale.
- **Detect.** `TooManyInvalidationsInProgress` errors; origin load spikes after a purge; users split
  between old/new during the 10–60s window.
- **Avoid.** Don't purge for deploys — change the URL (content hash). For emergencies use **Cache Tags /
  surrogate keys**, never `/*`.
- **Source.** [[raw/field-05-cdn-cache-invalidation.md]] §1–§3.

### P-33 — Heavily caching the HTML/pointer that references hashed assets
- **Trap.** Content-hashed assets work only if the document/API that *points* at them isn't cached —
  else users get the old pointer → old asset names.
- **When.** Two-tier caching done wrong.
- **Detect.** New asset deployed but users still load old hashed names.
- **Avoid.** `Cache-Control: max-age=31536000, immutable` for hashed assets; `no-cache`/short TTL for
  the HTML/API pointer.
- **Source.** [[raw/field-05-cdn-cache-invalidation.md]] §4.

### P-34 — Overwrite-in-place user content (stale avatar / concurrent-edit races)
- **Trap.** Re-uploading to the same key (avatar, edited doc) leaves a stable URL with changed content →
  stale CDN + race conditions.
- **When.** Mutable user content on a stable key.
- **Detect.** "My new avatar isn't showing" reports; concurrent edits clobbering each other.
- **Avoid.** Immutable keys + DB pointer (new upload = new key, update pointer). Avoid `?v=` query-string
  busting (some CDNs ignore query strings in the cache key).
- **Source.** [[raw/field-05-cdn-cache-invalidation.md]] §5.

## G. Image-transform / imgproxy pitfalls

### P-35 — Unsigned imgproxy = open proxy = SSRF + bandwidth abuse
- **Trap.** imgproxy without URL signing is an open image proxy — SSRF into your VPC / cloud metadata +
  bandwidth abuse. The #1 imgproxy misconfiguration.
- **When.** imgproxy in prod without `IMGPROXY_KEY`/`IMGPROXY_SALT`.
- **Detect.** Can you fetch an arbitrary URL (or `169.254.169.254`) through your imgproxy?
- **Avoid.** Set `IMGPROXY_KEY` + `IMGPROXY_SALT` and sign URLs; set `IMGPROXY_ALLOWED_SOURCES`
  allowlist; CPU-watch AVIF encode (`IMGPROXY_AVIF_SPEED`).
- **Source.** [[raw/ecosystem-06-image-optimization-cdn.md]] (imgproxy gotchas).

### P-36 — imgproxy v4 async pipeline changes failure semantics
- **Trap.** v4.0.0 (2026-05-13) added async download+processing → a download failure now surfaces
  differently than v3.
- **When.** Migrating imgproxy v3 → v4.
- **Detect.** Error-handling paths behave unexpectedly after upgrade.
- **Avoid.** Re-test error handling on v3→v4 migration; the internal cache is marked **pro** (verify
  free-tier split).
- **Source.** [[raw/ecosystem-06-image-optimization-cdn.md]] (imgproxy deltas).

## H. Provider-portability & async-scan pitfalls

### P-37 — "S3-compatible" assumed to mean drop-in (it's data-plane only)
- **Trap.** "S3-compatible" ports GET/PUT/multipart/presign, **not** event notifications, lifecycle
  tiering, `s3:` IAM condition keys, or cross-region replication. R2 has no events; B2/Tigris S3-compat
  is *partial* (verify conditional writes / object lock per provider).
- **When.** Any provider swap relying on AWS control-plane features.
- **Detect.** After swap, event triggers stop firing / lifecycle rules don't exist / IAM conditions
  fail.
- **Avoid.** Treat S3-compat as a data-plane promise; rebuild control-plane features on the target;
  verify the exact S3 calls you need per provider (e.g. `If-None-Match` conditional writes,
  list-after-write consistency).
- **Source.** [[raw/field-03-migration-war-stories.md]] §3, [[raw/ecosystem-01-storage-providers.md]]
  (gaps).

### P-38 — Treating async scan completion as upload completion (serve-before-clean)
- **Trap.** Presigned upload returns 200, app serves the file, async scan finds malware already
  downloaded.
- **When.** Direct-to-bucket + virus scanning.
- **Detect.** Is the object servable before `scan-status=clean`? If yes, you have the bug.
- **Avoid.** Object `pending`/unservable until clean; incoming/quarantine prefix; maintain a separate
  `freshclam` definitions updater (or the scanner silently rots).
- **Source.** [[raw/ecosystem-04-virus-scanning.md]] (latency gotcha, defs updater).

### P-39 — Using the archived `bucket-antivirus-function` as a base
- **Trap.** The once-canonical S3 ClamAV repo (bluesentry/bucket-antivirus-function, 533★) is
  **ARCHIVED** (last push 2024-04); copying it ships unmaintained AV.
- **When.** Picking an AV reference implementation.
- **Detect.** Repo says "archived"; last push 2024.
- **Avoid.** Use **`opg-s3-antivirus`** (maintained, UK gov) or **`clara`** (ClamAV+YARA); on AWS prefer
  **GuardDuty Malware Protection for S3** (managed).
- **Source.** [[raw/ecosystem-04-virus-scanning.md]], [[raw/ecosystem-10-starter-template-repos.md]].

## I. Metadata / serverless-state pitfalls

### P-40 — `new Map()` for upload state in serverless = lost state on cold start
- **Trap.** Cross-request state in a `new Map()` in a Vercel/Lambda API route is empty on each cold
  start; the metadata/state layer (not the bytes) is the serverless bottleneck (UploadThing #1244
  "Transaction pool connection limit exceeded").
- **When.** Tracking upload sessions/state in-process on serverless.
- **Detect.** Upload state lost intermittently; DB connection exhaustion under callback load.
- **Avoid.** Use a serverless-safe external store (**Upstash/Supabase**) for upload state; mirrors
  `.claude/rules/typescript.md`.
- **Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §4,
  [[raw/ecosystem-08-real-breakage-github-issues.md]] (UploadThing #1244).

## J. Tooling-staleness pitfalls

### P-41 — Copy-pasting stale starter repos
- **Trap.** Popular but stale starters: `rajeshdavidbabu/s3-upload-thing` (2024-10, Uppy merged the
  multipart plugin since), `ryanto/next-s3-upload` (2024-12), `dropzone/dropzone` (2024-07). APIs moved.
- **When.** Bootstrapping from an old tutorial/repo.
- **Detect.** Check last-push date + whether `@uppy/aws-s3` references the deprecated split
  `aws-s3-multipart` plugin.
- **Avoid.** Use as *concept references*, not copy-paste bases; prefer maintained sources (uploadthing
  `examples/`, `vercel/storage`, SST `Bucket`). Verify you're on the **merged** `@uppy/aws-s3` plugin.
- **Source.** [[raw/ecosystem-10-starter-template-repos.md]] (stale/archived).

### P-42 — Depending on an unvetted low-star S3 MCP for object CRUD
- **Trap.** No first-party AWS MCP does plain S3 object CRUD (the AWS `s3-tables-mcp-server` is
  Iceberg-only); the generic S3-compat MCP space is unvetted low-star one-offs.
- **When.** Wiring an agent's object-CRUD over MCP off-Cloudflare.
- **Detect.** MCP repo has low stars / no recent maintenance / unclear auth.
- **Avoid.** On R2 use the official **Cloudflare MCP** (`r2_*`). Off-Cloudflare, prefer `rclone`/`aws
  --endpoint-url`, or consider **shelf owning a thin S3-compatible MCP**. Verify whether the CF R2 MCP
  even exposes presigned-URL *generation* (agents often need to hand a URL to a user).
- **Source.** [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (AWS + generic MCP, gaps).

---

> **Skim order before coding:** A (presigned) → B (security) → C (2026 defaults) → D (multipart) →
> E (cost/lifecycle). Those five blocks cover the failure modes that actually page you. The rest
> (F–J) are domain-specific. Cross-checks live in [[BATTLE-TESTED-SCENARIOS.md]].
