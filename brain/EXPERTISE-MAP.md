---
title: "shelf Expertise Map — what the object-storage / file-handling employee must master"
type: synthesis
created: 2026-06-16
tags: [shelf, brain, expertise-map, object-storage, uploads]
sources:
  - "raw/ecosystem-00-internal-references.md"
  - "raw/ecosystem-01-storage-providers.md"
  - "raw/ecosystem-02-uploadthing-and-upload-libs.md"
  - "raw/ecosystem-03-presigned-access-control-validation.md"
  - "raw/ecosystem-04-virus-scanning.md"
  - "raw/ecosystem-05-multipart-resumable-tus.md"
  - "raw/ecosystem-06-image-optimization-cdn.md"
  - "raw/ecosystem-07-lifecycle-retention.md"
  - "raw/ecosystem-08-real-breakage-github-issues.md"
  - "raw/ecosystem-09-agent-operation-clis-mcp.md"
  - "raw/ecosystem-10-starter-template-repos.md"
  - "raw/field-01-egress-cost-blowups-and-r2-economics.md"
  - "raw/field-02-upload-security-rce-xss-ssrf.md"
  - "raw/field-03-migration-war-stories.md"
  - "raw/field-04-presigned-urls-large-files-timeouts.md"
  - "raw/field-05-cdn-cache-invalidation.md"
  - "raw/field-06-2026-shifts-taste-disputes-synthesis.md"
summary: "The structured map of every competency shelf owns, organized by job-to-be-done (not by tool); each node cites its raw source."
---

# shelf Expertise Map

> **Who shelf is.** shelf is the Energy fleet's **object-storage / CDN / file-uploads** employee. Today
> the fleet has *no* storage employee — the harness checklist lists this component as a **GAP**
> (`audit/HARNESS-CHECKLIST-2026.md` lines 79, 342, 398, via [[raw/ecosystem-00-internal-references.md]]).
> shelf fills it. The fleet default is **R2-first** (egress economics), with **S3 as the portability
> contract** and **UploadThing as the DX layer** — but every default here is *traffic-aware*, not
> dogma (see [[OPINIONS.md]]).
>
> **The one-paragraph thesis** (from [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §5):
> object storage looks trivial ("it's just `putObject`") and is the opposite. The bill is
> **egress-dominated and demand-driven** (a single viral object = four figures); the security surface is
> the **content** of what users upload (Content-Type lies, SVG is a weapon); the upload path is a
> **strict crypto protocol** that 403s on header drift; provider choice is **per-workload-reversible**;
> and the delivery layer punishes purge-based invalidation. The competent move on every axis is the same
> shape: **don't trust the client, make things immutable, put a CDN in front of every hot byte, store
> the pointer in the DB and the bytes in object storage.**
>
> How to read this map: it is organized by **job-to-be-done (JTBD)**, because a storage employee is
> hired to *accomplish outcomes* (accept a file safely, serve it cheaply, move it between providers,
> keep the bill sane), not to *operate a tool*. Tools are the means; the tool-by-tool canon lives in
> [[TOOL-MATRIX.md]]. Scenario drills are in [[BATTLE-TESTED-SCENARIOS.md]]; version-specific traps in
> [[KNOWN-PITFALLS.md]]; stances in [[OPINIONS.md]]; open questions in [[GAPS-AND-DISPUTES.md]].

---

## JTBD 1 — Choose the right storage backend for a given workload

**Outcome:** pick a provider that minimizes total cost and operational pain *for this workload's
access pattern*, and keep the choice reversible.

- **1.1 Understand the cost model is egress-dominated, not storage-dominated.**
  Storage is cents/GB; egress is the four-figure surprise driven by someone else's download behavior.
  S3 internet egress ≈ `$0.09/GB`; at 10 TB/mo, transfer alone ≈ `$900/mo` and can exceed storage cost.
  S3 egress has **four** prices, not one: internet egress, cross-region replication, inter-AZ, and
  request-tier charges. Source: [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §1–§2.
- **1.2 Know the R2-vs-S3 traffic-aware decision rule.**
  R2 wins for **hot/public download-many** (zero egress: ~$15/mo vs ~$891/mo at 10 TB egress). R2
  **loses** for **write-heavy ingestion** (Class A `$4.50/M` writes), **cold/archival** (single tier,
  storage `$0.015/GB` is ~2.5× Wasabi/B2, ~69% pricier than S3+Glacier on data-lake), and
  **event-driven** (no event notifications). Source:
  [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3, [[raw/field-03-migration-war-stories.md]] §1.
- **1.3 Map each provider to its sweet spot.** R2 = default hot/public + a 2026 mini-data-platform
  (R2 SQL / Data Catalog / Pipelines GA'd May 2026). S3 = portability + ecosystem + events + tiering +
  certified compliance. Tigris = global low-latency reads without a CDN + data branching (forks/
  snapshots) + Fly.io. B2 = cost floor (`$6/TB`) + unlimited free egress via Cloudflare Bandwidth
  Alliance. Supabase Storage = only if already all-in on Supabase (auth-coupled + transforms).
  Source: [[raw/ecosystem-01-storage-providers.md]] (whole file).
- **1.4 Treat provider choice as per-workload-reversible.** Architect behind a thin `Storage`
  interface over the S3 API. Lock-in is **control-plane** (events, lifecycle, IAM), not **data-plane**
  (GET/PUT/multipart/presign). Minimize control-plane dependencies to keep optionality. Source:
  [[raw/field-03-migration-war-stories.md]] §3, §5.

## JTBD 2 — Accept an upload safely (the security job)

**Outcome:** take a file from an untrusted user without enabling XSS, SSRF, RCE, path traversal, or DoS.

- **2.1 Never trust client-supplied Content-Type or extension.** This is the #1 recurring root cause
  across real 2025–2026 CVEs. Validate by **magic bytes / file structure** (libmagic / `file-type` npm
  / Apache Tika), against an **allowlist**. Source: [[raw/field-02-upload-security-rce-xss-ssrf.md]] §1,
  §2, §7; [[raw/ecosystem-03-presigned-access-control-validation.md]] (validation pipeline step 3).
- **2.2 Treat SVG as a document, not an image.** SVG XSSes the browser (event handlers) AND SSRFs the
  server (`<image xlink:href="http://169.254.169.254/...">` hits cloud metadata). Refuse SVG from
  untrusted users, or rasterize to PNG in a sandbox and discard the original. Source:
  [[raw/field-02-upload-security-rce-xss-ssrf.md]] §2 (CVE-2025-61681), §3 (CVE-2025-61768).
- **2.3 Sanitize at BOTH write and read.** The validation layer and the serving layer must agree. The
  Postiz exemplar (CVE-2026-40487): upload trusted the request header, nginx re-derived Content-Type
  from the extension → stored XSS. Force a safe `Content-Type`, `Content-Disposition: attachment`, and
  `X-Content-Type-Options: nosniff` on the *serve* side. Source:
  [[raw/field-02-upload-security-rce-xss-ssrf.md]] §1.
- **2.4 Re-encode / transcode media to strip polyglots.** A genuinely-valid-JPEG-AND-script polyglot
  passes magic-byte checks; re-encoding a JPEG strips appended payloads and EXIF. Server-side image
  transforms are part of your attack surface (ImageTragick / ImageMagick delegate RCE is still live);
  pin versions, disable risky delegates via `policy.xml`, run in a sandbox. Source:
  [[raw/field-02-upload-security-rce-xss-ssrf.md]] §4, §5.
- **2.5 Cap resource consumption, not just type.** Zip bombs (42 KB → 4.5 PB) and pixel-floods
  (50,000×50,000 PNG ≈ tiny on disk, OOMs the image lib) are one-request DoS. Cap max upload size,
  decompressed size, compression ratio, entry count, pixel dimensions, and processing time. Source:
  [[raw/field-02-upload-security-rce-xss-ssrf.md]] §6.
- **2.6 Generate random server-side object keys.** Never echo the user's filename into a
  filesystem/S3 path — kills path-traversal AND the non-ASCII encoding-mismatch class. Store the
  original filename as metadata / in the DB. Source: [[raw/field-02-upload-security-rce-xss-ssrf.md]]
  §8, [[raw/field-04-presigned-urls-large-files-timeouts.md]] §6.
- **2.7 Serve user content from a separate cookieless domain** with a restrictive CSP — contains
  stored-XSS blast radius even if a malicious file slips through. Source:
  [[raw/ecosystem-03-presigned-access-control-validation.md]] (best practice 3),
  [[raw/field-02-upload-security-rce-xss-ssrf.md]] §8.
- **2.8 Know the 2026 platform-default shifts.** S3 **Block Public Access is ON by default** for new
  buckets, and **ACLs are DISABLED by default** (BucketOwnerEnforced). `ACL: 'public-read'` on
  `putObject` now throws `AccessControlListNotSupported`. The new failure mode is "someone *turned off*
  BPA for a quick fix," not "fresh bucket is public." Audit for *changes to* BPA. Source:
  [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §1a, §1b.

## JTBD 3 — Design the upload path (the architecture job)

**Outcome:** move bytes from client to bucket without melting your server, your bill, or the user's
patience.

- **3.1 Choose among the three upload architectures deliberately.**
  (a) **Direct-to-bucket via presigned** — cheapest, no bandwidth through your server, but validation
  must be async post-upload. (b) **Through-your-server** — lets you validate inline, but your server
  eats bandwidth + memory (stream, never buffer); doesn't scale. (c) **Managed** (UploadThing / Uppy
  +Companion / Transloadit) — fastest to ship, ongoing cost + lock-in. Source:
  [[raw/ecosystem-02-uploadthing-and-upload-libs.md]] (architectural fork).
- **3.2 Never proxy file bytes through a serverless function.** API Gateway = 29 s timeout + 10 MB
  payload; Lambda = 6 MB invocation payload; base64 inflates ~33% → you hit 6 MB with a ~4.5 MB file.
  Generate a presigned URL/POST; client uploads straight to storage. Non-negotiable for files >~4 MB.
  Source: [[raw/field-04-presigned-urls-large-files-timeouts.md]] §4.
- **3.3 Use presigned POST (policy), not presigned PUT, when you must bound size/type at the edge.**
  S3 does **not** enforce `Content-Length` for presigned PUT — a client can upload 5 GB through a URL
  you "limited" to 1 MB. POST policy enforces `content-length-range` and `starts-with $Content-Type`.
  But verify it actually rejects oversize per SDK version (boto3 #2261 silently ignored it). Source:
  [[raw/ecosystem-03-presigned-access-control-validation.md]] (the load-bearing gotcha).
- **3.4 Treat presigned URLs as a strict cryptographic protocol.** Return the **exact signed-header
  set** to the client; the client sends only those headers (defeats `amz-sdk-request` drift). NTP-sync
  every signer (clock skew → instant `SignatureDoesNotMatch`). Know your effective expiry =
  `min(set-expiry, STS-session-remaining)` (Lambda temp creds ≈ 1 h; 7-day SigV4 hard cap). Source:
  [[raw/field-04-presigned-urls-large-files-timeouts.md]] §1, §2, §3.
- **3.5 Know the upload-size decision tree.** <100 MB + stable connection → single presigned PUT.
  >100 MB → multipart (parts 5 MiB–5 GiB, ≤10,000 parts, object ≤5 TiB; single-PUT max 5 GB). Needs
  resume-across-interruption (mobile, big video) → tus. Source:
  [[raw/ecosystem-05-multipart-resumable-tus.md]] (decision rule + S3 limits).
- **3.6 Set CORS explicitly on every direct-to-bucket setup — R2 especially (no default CORS).**
  R2 presigned-PUT 401s + CORS failures are the single most common storage integration bug of 2026.
  Test the `OPTIONS` preflight explicitly. Source: [[raw/ecosystem-08-real-breakage-github-issues.md]]
  (R2 presigned cluster), [[raw/ecosystem-03-presigned-access-control-validation.md]].

## JTBD 4 — Multipart & resumable uploads (the large/flaky-file job)

**Outcome:** reliably land big or interruption-prone uploads, and don't leak money doing it.

- **4.1 Distinguish multipart from tus.** Multipart = "big file, one session" (S3-native chunking,
  not inherently resumable across refresh). tus = "any file, survives interruption" (HTTP PATCH +
  `Upload-Offset`; can sit in front of S3 via tusd `s3store`). They compose. Source:
  [[raw/ecosystem-05-multipart-resumable-tus.md]] (two distinct mechanisms).
- **4.2 Know the multipart gotchas.** (a) Orphaned multiparts bill as **invisible storage forever**
  (set abort-incomplete-multipart lifecycle rule). (b) Min part size = 5 MiB for all but the last
  (1 MB chunks → `EntityTooSmall`). (c) Multipart ETag is `MD5(concat(part MD5s))-N`, **not** the file
  MD5 — verify integrity with checksums (CRC32/CRC32C/SHA256), not ETag-vs-md5sum. (d) Presigned
  multipart is **3 calls** (create, presign each part, complete), not 1. Source:
  [[raw/ecosystem-05-multipart-resumable-tus.md]] (S3 multipart gotchas).
- **4.3 Verify "resumable" actually resumes.** "Resumable" is a spectrum. Real Uppy issues: multipart
  never completes after the computer sleeps (#3783); retry re-uploads already-uploaded parts (#5762).
  Only tus reliably survives sleep / network drop. Source:
  [[raw/ecosystem-08-real-breakage-github-issues.md]] (Uppy section).
- **4.4 Run tusd correctly.** v2 is current; pin **v2.10.0+** (ongoing HTTP/2 fixes). Disable the
  **concatenation extension** unless you need it (#1364 — concat is non-idempotent → duplicate data on
  retry; the disable flag landed in v2.9.0 for exactly this). **Never back tusd with SMB/CIFS** (#1372
  — stale `.lock`/`.stop` files = permanent failure); use the S3 store. Source:
  [[raw/ecosystem-05-multipart-resumable-tus.md]] (tusd deltas),
  [[raw/ecosystem-08-real-breakage-github-issues.md]] (tusd section).

## JTBD 5 — Access control: serve private files without leaking them

**Outcome:** let the right user read a private object, and nobody else, while keeping the CDN useful.

- **5.1 Constrain the signing principal, not just the URL.** A presigned URL can never grant more than
  the IAM principal that signed it; the real guardrail is a narrowly-scoped signing role (one bucket,
  one prefix, put-only). Source: [[raw/ecosystem-03-presigned-access-control-validation.md]] (best
  practice 2).
- **5.2 Short expiry for upload URLs** — minutes, not hours. If a URL leaks (logs, screenshots,
  Referer), TTL bounds the blast radius. Source: [[raw/ecosystem-03-presigned-access-control-validation.md]].
- **5.3 Choose the right download-access mechanism.** S3/R2 presigned GET = simple one-off private
  downloads (but each unique URL busts the CDN cache). CDN signed URLs/cookies (CloudFront,
  Cloudflare via Workers/Images/Stream, Bunny token auth) = private content *with* edge caching — the
  pattern for "private but high-traffic." Source:
  [[raw/ecosystem-03-presigned-access-control-validation.md]] (downloads section).
- **5.4 Capability vs identity.** A signed URL is a *bearer capability* — anyone with the link has
  access until expiry. For per-user *revocable* access, gate at your app/edge (check session → 302 to a
  short-TTL signed URL); don't hand out long-lived signed URLs. Source:
  [[raw/ecosystem-03-presigned-access-control-validation.md]] (capability vs identity).

## JTBD 6 — Validate & confirm an upload server-side (the 5-check pipeline)

**Outcome:** the object store + server re-validation is the source of truth — never the client.

- **6.1 Run the five checks, never skipping the post-upload ones.** (1) Pre-sign: authn/authz, decide
  prefix, (POST policy) bound size+type. (2) At-edge: POST policy rejects oversize/wrong-type. (3)
  Post-upload magic-byte sniff (the #1 missed step). (4) Post-upload size/integrity via HEAD + checksum.
  (5) Async scan + quarantine. Source: [[raw/ecosystem-03-presigned-access-control-validation.md]]
  (validation pipeline).
- **6.2 The metadata/state layer is the serverless bottleneck, not the bytes.** Use a serverless-safe
  store (Supabase/Upstash) for upload state — `new Map()` in a Vercel API route loses state on cold
  starts (mirrors `.claude/rules/typescript.md`; UploadThing #1244 "Transaction pool connection limit
  exceeded"). Source: [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §4,
  [[raw/ecosystem-08-real-breakage-github-issues.md]] (UploadThing #1244).

## JTBD 7 — Scan uploads for malware (the quarantine job)

**Outcome:** no infected object is ever served, and the scanner never silently rots.

- **7.1 Own the Incoming → Scan → Clean/Quarantine lifecycle.** Upload lands in an
  incoming/quarantine prefix, served to nobody. S3 event → scanner. Scanner tags
  `scan-status=clean|infected`. Clean → promote / flip tag. Infected → delete or lock + alert. Source:
  [[raw/ecosystem-04-virus-scanning.md]] (dominant pattern).
- **7.2 The object is `pending` and unservable until the scan flips it clean.** The product-breaking
  bug: presigned upload returns 200, app serves the file, scan later finds malware already downloaded.
  Async scan ≠ ready-to-serve. Source: [[raw/ecosystem-04-virus-scanning.md]] (latency & UX gotcha).
- **7.3 Maintain the definitions updater.** A *separate* scheduled job runs `freshclam`; the scanner
  loads defs at cold start. The most-skipped piece — without it the scanner silently misses new
  malware. Source: [[raw/ecosystem-04-virus-scanning.md]] (pattern step 5).
- **7.4 Pick the engine by platform.** **On AWS → GuardDuty Malware Protection for S3** (managed, ML+
  heuristic, defs every 15 min, `$0.09/GB` post-2025 price cut; Lambda cost −99.8% in real migrations).
  **Off AWS (R2/B2/Tigris) → DIY ClamAV** (`opg-s3-antivirus` pattern, or `clara` for ClamAV+YARA) —
  the canonical OSS repo `bucket-antivirus-function` is **ARCHIVED**. Source:
  [[raw/ecosystem-04-virus-scanning.md]] (engine options),
  [[raw/ecosystem-10-starter-template-repos.md]] (AV starters).

## JTBD 8 — Optimize & deliver images (the transform + CDN job)

**Outcome:** serve the right-sized, right-format image fast and cheap.

- **8.1 Managed vs self-host.** On the R2 default: store originals in R2, serve via **Cloudflare
  Images transformation flows** (config, not code — pair conditions with parameters, no URL changes;
  GA 2026-05-27). If you must self-host (cost at very high volume, JXL/RAW control): **imgproxy v4**
  behind the CDN. Source: [[raw/ecosystem-06-image-optimization-cdn.md]] (two camps + recommendation).
- **8.2 imgproxy is an SSRF vector if misconfigured.** URL signing (`IMGPROXY_KEY` + `IMGPROXY_SALT`)
  is **mandatory in prod** — unsigned = open proxy = SSRF + bandwidth abuse. Set source allowlist
  (`IMGPROXY_ALLOWED_SOURCES`) to block fetches into your VPC / cloud metadata. Source:
  [[raw/ecosystem-06-image-optimization-cdn.md]] (imgproxy gotchas).
- **8.3 Know the CDN options.** Cloudflare (fleet default, pairs with R2, $0 egress); Bunny.net
  (cheap independent CDN + Bunny Optimizer + token auth); Fastly (premium; CF now offers provider flows
  to migrate off it); CloudFront (S3 default, signed URLs/cookies for private). Source:
  [[raw/ecosystem-06-image-optimization-cdn.md]] (CDN layer).
- **8.4 Generated assets are content-addressable by nature.** Energy generates its visual assets
  (Nano Banana, per `.claude/rules/design.md`) → a perfect fit for **hash-keyed immutable caching**.
  Source: [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §4.

## JTBD 9 — Cache & invalidate at the edge (the delivery-consistency job)

**Outcome:** users never see a stale file after a deploy, and a purge never takes down origin.

- **9.1 Don't invalidate — change the URL.** Content-hashed immutable filenames (`app.a3f9d2c.js`) +
  long TTL (`max-age=31536000, immutable`); the pointer (HTML/API) gets `no-cache`/short TTL. New
  content = new URL → no propagation delay, no 15-path cap, no thundering herd. Source:
  [[raw/field-05-cdn-cache-invalidation.md]] §4.
- **9.2 Know why purge is a trap.** Propagation is **10–60 s** (not atomic); wildcard `/*` causes
  **origin stampede**; max **15 invalidation paths in progress** (→ `TooManyInvalidationsInProgress`);
  CloudFront **won't notice an S3 object changed** (TTL or explicit invalidation only). Use Cache Tags
  / surrogate keys for emergencies, never `/*`. Source: [[raw/field-05-cdn-cache-invalidation.md]] §1–§3.
- **9.3 For user uploads, use immutable keys + DB pointer, not overwrite-in-place.** Overwriting an
  object in place is the root of most "stale avatar" bugs and concurrent-edit races. A new upload = a
  new key, update the DB pointer. Source: [[raw/field-05-cdn-cache-invalidation.md]] §5.

## JTBD 10 — Lifecycle, retention & compliance (the long-term-data job)

**Outcome:** data ages cheaply, cruft self-cleans, and WORM promises are kept on the right provider.

- **10.1 Set hygiene lifecycle rules on every bucket, day one.** Abort incomplete multipart uploads
  after N days (the #1 silent cost); (if versioned) expire noncurrent versions + clean delete-markers.
  Source: [[raw/ecosystem-07-lifecycle-retention.md]] §1.
- **10.2 Tiering only pays above ~TB scale.** For most product assets the egress story (R2 $0) matters
  more than cold-tier pennies. Source: [[raw/ecosystem-07-lifecycle-retention.md]] (recommendation).
- **10.3 Object Lock / WORM is irreversible and creation-time-only.** Compliance mode is genuinely
  immutable (not even root can delete) — a wrong 7-year lock on 1 PB = 7 years of bills. Object Lock
  **must be enabled at bucket creation** (can't retrofit). Default to **governance mode** unless a
  regulator demands compliance mode. Source: [[raw/ecosystem-07-lifecycle-retention.md]] §"Object Lock".
- **10.4 R2 cannot do certified WORM.** R2 Bucket Locks ≈ S3 **governance** mode (admins can remove
  rules), **not** compliance mode. For SEC 17a-4 / certified WORM you need **S3 compliance mode** or
  **B2 compliance mode** — the fleet's R2 default must yield here. Source:
  [[raw/ecosystem-07-lifecycle-retention.md]] §"shelf taste on WORM".

## JTBD 11 — Migrate between providers (the move-the-data job)

**Outcome:** move a workload to a cheaper/better provider without a multi-day outage or a surprise bill.

- **11.1 Audit per-workload before moving.** The headline story: 14 workloads moved S3→R2, **9 saved
  40–70%, 5 reverted within 90 days** because the limitations cost more than egress savings. A blanket
  "move everything to R2" is the anti-pattern. Source: [[raw/field-03-migration-war-stories.md]] §1.
- **11.2 Budget the one-time exit egress.** Leaving S3 = pay S3 egress once for the full dataset
  (`$0.09/GB × total stored`; NixOS faced ~$32K to exit). Source:
  [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3, §3b;
  [[raw/field-03-migration-war-stories.md]] §2.
- **11.3 Use the right tooling.** `rclone sync` = best cross-provider migration CLI. R2 Super Slurper
  = managed S3→R2 bulk copy (watch "Invalid upstream credentials" auth snags). Tigris **shadow
  buckets** = best zero-downtime migration *to* Tigris (keep both in sync, cut over by config). Source:
  [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (rclone), [[raw/field-03-migration-war-stories.md]]
  §2, [[raw/ecosystem-01-storage-providers.md]] (Tigris).
- **11.4 Know what does and doesn't port.** "S3-compatible" is a **data-plane** promise (GET/PUT/
  multipart/presign port cleanly), **not** a control-plane promise — event notifications, lifecycle
  tiering, `s3:` IAM condition keys, cross-region replication do **not** port. Source:
  [[raw/field-03-migration-war-stories.md]] §3.

## JTBD 12 — Operate storage as an AGENT (the agent-native job)

**Outcome:** shelf can do real storage work with CLIs/SDKs/MCP — not a web dashboard.

- **12.1 Prefer MCP on the R2 default.** `cloudflare/mcp-server-cloudflare` (3,867★, active) exposes
  `r2_list_buckets`, `r2_*_bucket`, `r2_list_objects`, `r2_{get,put,delete}_object` with a scoped CF
  API token — the cleanest agent path on R2. Wire it in `.mcp.json`. Source:
  [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (Cloudflare MCP).
- **12.2 Know the MCP gap.** There is **no first-party AWS MCP for plain S3 object CRUD** (the AWS
  `s3-tables-mcp-server` targets Iceberg, not PUT/GET); the generic S3-compatible MCP space is a
  long tail of unvetted low-star one-offs (`diabloneo/s3-mcp` is the best candidate but unvetted).
  **shelf may want to own a thin S3-compatible MCP.** Source:
  [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (AWS + generic MCP).
- **12.3 Master the CLI hands.** `rclone` (multi-backend, migration, find orphaned multiparts via
  `rclone backend list-multipart-uploads`), `aws`/`aws s3api` (presign, multipart, lifecycle,
  object-lock; `--endpoint-url` for any S3-compatible), `wrangler` (R2-native), `b2`, `s5cmd` (fast
  parallel), `mc` (MinIO client). Source: [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (CLIs).
- **12.4 Master the SDK helpers.** AWS SDK v3 `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
  (presigned PUT/POST; `region:"auto"` + endpoint for R2/B2/Tigris); `@aws-sdk/lib-storage` `Upload`
  for automatic multipart (don't hand-roll). Python: `boto3` (verify the `generate_presigned_post`
  content-length-range bug). Source: [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (SDKs).
- **12.5 Follow the agent storage playbook (decision tree).** R2 → CF MCP / `wrangler`, migrate via
  `rclone`, presign via AWS SDK v3 `region:"auto"` + **set CORS explicitly**. S3 → CLI/SDK (no
  object-CRUD MCP). Any S3-compatible → `rclone` / `aws --endpoint-url`. Migration → `rclone sync` (or
  Tigris shadow buckets). Large/flaky → tusd over HTTP (no MCP). Always → abort-incomplete-multipart
  lifecycle rule. Source: [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (agent playbook).

## JTBD 13 — Where bytes live vs where pointers live (the BLOB-vs-DB job)

**Outcome:** keep the database lean and the storage layer authoritative.

- **13.1 Store the URI in the DB, the bytes in object storage.** Microsoft Research "To BLOB or Not
  To BLOB" threshold: <256 K → DB is fine (transactional consistency wins); >1 M → filesystem/object
  store. Large files in SQL bloat storage, slow queries, inflate backups. Default:
  object-storage-with-DB-pointer; tiny transactionally-critical blobs in DB are a defensible exception,
  not the default. Source: [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §2.7, §3 (Dispute C).

---

## Source-coverage check (every raw file feeds at least one node)

| Raw file | JTBDs it feeds |
|---|---|
| ecosystem-00-internal-references | Intro, 1.4, 6.2, 8.4, 9.3 |
| ecosystem-01-storage-providers | 1.1–1.4, 11.3 |
| ecosystem-02-uploadthing-and-upload-libs | 3.1 |
| ecosystem-03-presigned-access-control-validation | 2.1, 3.3, 5.1–5.4, 6.1 |
| ecosystem-04-virus-scanning | 7.1–7.4 |
| ecosystem-05-multipart-resumable-tus | 3.5, 4.1–4.4 |
| ecosystem-06-image-optimization-cdn | 8.1–8.3 |
| ecosystem-07-lifecycle-retention | 10.1–10.4 |
| ecosystem-08-real-breakage-github-issues | 3.6, 4.3, 4.4, 6.2 |
| ecosystem-09-agent-operation-clis-mcp | 12.1–12.5, 11.3 |
| ecosystem-10-starter-template-repos | 7.4 (AV starters), TOOL-MATRIX feed |
| field-01-egress-cost-blowups | 1.1, 1.2, 11.2 |
| field-02-upload-security | 2.1–2.7 |
| field-03-migration-war-stories | 1.2, 1.4, 11.1, 11.4 |
| field-04-presigned-urls-large-files | 2.6, 3.2, 3.4, 6.2 |
| field-05-cdn-cache-invalidation | 8.4, 9.1–9.3 |
| field-06-2026-shifts-synthesis | Intro, 2.8, 6.2, 8.4, 13.1 |
