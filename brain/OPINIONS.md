---
title: "shelf Opinions — explicit taste stances (the anti-slop layer)"
type: synthesis
created: 2026-06-16
tags: [shelf, brain, opinions, taste, anti-slop]
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
related: ["[[EXPERTISE-MAP]]", "[[BATTLE-TESTED-SCENARIOS]]", "[[KNOWN-PITFALLS]]", "[[GAPS-AND-DISPUTES]]", "[[TOOL-MATRIX]]"]
summary: "The opinionated defaults and hard refusals a senior storage engineer holds that an average one doesn't. Each: the stance, why, the source. This is what makes shelf's output non-generic."
---

# shelf Opinions

> This is the **taste layer** — the stances that separate a senior storage engineer's answer from a
> Stack-Overflow paste. Each opinion is **STANCE → WHY → SOURCE**, and where a credible source disagrees
> it points to [[GAPS-AND-DISPUTES]] so the stance stays honest. The mechanics behind each live in
> [[EXPERTISE-MAP]]; the failure drills in [[BATTLE-TESTED-SCENARIOS]]; the version traps in
> [[KNOWN-PITFALLS]]; the tool calls in [[TOOL-MATRIX]].
>
> **How shelf uses this file:** when asked "should we use X?", lead with the relevant stance and its
> *because*, not a neutral pros/cons table. A storage employee that hedges everything is useless; the
> value is in the opinionated default plus the explicit conditions under which it flips. The conditions
> are the expertise — anyone can have an opinion; only an expert knows when their own opinion is wrong.

---

## Tier 1 — The four load-bearing stances (if shelf forgets everything else, keep these)

These are the stances that, applied reflexively, prevent the most expensive and most common failures.
They recur across every raw file — they are the spine of the domain.

### O-01 — ALWAYS budget egress before storage; NEVER size a file-serving bill from GB stored
**Because** storage is cents/GB and *predictable*; egress is a four-figure surprise driven by **someone
else's** download behavior, which you do not control. A single 13.7 GB file going viral took one bill
from $23 → $2,657; NixOS Foundation paid ~$9,000/mo (egress-dominated) on 450 TB stored + 29.5 TB
egress, with a ~$32K cost just to *exit*. The average dev sizes the bill from storage and is blindsided;
the senior dev alerts on **egress volume**, not GB stored, and puts a CDN/R2 in front of every hot byte.
**Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §1, §3b, §6;
[[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §2.1. *(The viral-file dollar figure is
vendor-sourced — see [[GAPS-AND-DISPUTES]] Dispute D — but the unbounded-demand-driven-egress
mechanism is undisputed; the NixOS figure is a verified named-org primary.)*

### O-02 — NEVER trust the client (filename, Content-Type, extension, headers); the object store + server re-validation is the only source of truth
**Because** this single principle is the root fix for the #1 CVE class (Content-Type-trust → stored XSS,
Postiz CVE-2026-40487, Kuno CVE-2025-61681), the path-traversal class, the non-ASCII key-encoding class
(UploadThing #153), and the presigned signature-drift class (`amz-sdk-request`). It is also the storage
expression of the fleet's own hard-won memory rule — *the client is never durable storage / the source
of truth* (`feedback_chrome_mcp_durable_storage`). Validate by **magic bytes** (not header/extension);
generate **random server-side keys** (not user filenames); **re-validate size via HEAD** server-side
(presigned PUT can't enforce it); confirm a scan flipped **clean** before serving.
**Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §1, §7, §8;
[[raw/ecosystem-03-presigned-access-control-validation.md]] (validation pipeline);
[[raw/ecosystem-00-internal-references.md]] §3 (fleet alignment).

### O-03 — ALWAYS make things immutable: random object keys + content-hashed URLs; NEVER overwrite-in-place
**Because** immutability collapses three unrelated bug classes into zero with one decision: (a) CDN
cache-staleness ("my new avatar isn't showing" — a stable URL with changed content), (b) concurrent-edit
races (two writes to the same key clobber), and (c) the entire CDN-invalidation problem (new content =
new URL → no purge, no 10–60s propagation window, no 15-path cap, no thundering herd). A new upload is a
**new key + a DB-pointer update**, never an overwrite. Energy already generates its visual assets (Nano
Banana, `.claude/rules/design.md`) which are *content-addressable by nature* — a perfect fit.
**Source.** [[raw/field-05-cdn-cache-invalidation.md]] §4, §5;
[[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §2.2, §4.

### O-04 — ALWAYS put a CDN/edge in front of every hot byte; NEVER serve hot public objects straight from origin
**Because** every origin read of a hot public object is metered egress at `~$0.09/GB` on S3 — that is the
viral-file blowup mechanism (O-01). A CDN turns N downloads into 1 origin fetch + N cache hits. On the
fleet's R2 default you are *already* on Cloudflare's edge with $0 egress; on S3 put CloudFront in front;
on B2 use the Cloudflare Bandwidth Alliance for unlimited free egress. The corollary: **never proxy file
bytes through your own serverless function** either (the 6 MB Lambda / 29s API-Gateway wall) — direct-to-
storage presigned upload, CDN-fronted download.
**Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §6.2;
[[raw/field-04-presigned-urls-large-files-timeouts.md]] §4; [[raw/ecosystem-01-storage-providers.md]] (B2).

---

## Tier 2 — Provider & architecture stances

### O-05 — DEFAULT to Cloudflare R2; but the default is TRAFFIC-AWARE, not dogma
**Because** R2's zero-egress wins decisively for **hot/public download-many** (~$15/mo vs ~$891/mo at
10 TB egress) and it's the fleet's stated default (`audit/HARNESS-CHECKLIST-2026.md` line 342). But R2 is
the *wrong* default for three shapes: **write-heavy ingestion** (Class A writes `$4.50/M` → $450/mo at
100M writes), **cold/archival** (storage `$0.015/GB` ≈ 2.5× Wasabi/B2, no Glacier/IA tiering, ~69%
pricier than S3+lifecycle on data-lakes), and **event-driven** (no S3 event notifications). The 2025
gospel "S3 is the safe default" is dead; the 2026 reflex "R2 is the cheap default" is *also* wrong. The
expert move is **per-workload**: R2 for hot/public, S3 for events/cold/compliance.
**Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3;
[[raw/field-03-migration-war-stories.md]] §1; [[raw/ecosystem-01-storage-providers.md]] (decision matrix).
*(This is the live debate — see [[GAPS-AND-DISPUTES]] Dispute A. shelf holds the synthesis, not a side.)*

### O-06 — ALWAYS architect behind a thin `Storage` interface over the S3 API; treat provider choice as per-workload-reversible
**Because** the "move back" is a first-class outcome, not a failure: in the headline migration story, 14
workloads went S3→R2, **9 saved 40–70% and 5 were reverted within 90 days**. Lock-in does **not** come
from the data plane (GET/PUT/multipart/presign are portable across every S3-compatible provider) — it
comes from the **control plane** (events, lifecycle tiering, `s3:` IAM condition keys, cross-region
replication). Minimize control-plane dependencies and a workload re-points by config, not rewrite. S3 is
the **portability contract**, not necessarily the runtime.
**Source.** [[raw/field-03-migration-war-stories.md]] §1, §3, §5;
[[raw/ecosystem-00-internal-references.md]] §"Net takeaway" (S3-API-compatibility as the portability rule).

### O-07 — Use a DX upload SDK (UploadThing / Vercel Blob) for PROTOTYPES and TRANSIENT data; migrate OFF it for read-heavy production
**Because** DX SDKs are *S3/R2 with a markup*, and the markup compounds **exactly when you succeed**:
Vercel Blob bills `$0.05/GB` egress vs R2's `$0.00`; practitioners report it "will only cost you a
fortune over using an S3 provider directly." They are *correct* for prototypes, transient data, and
build artifacts (Vercel Blob's 15-min sampling billing genuinely wins for short-lived objects) — and for
teams with no infra skill. They are *wrong* for read-heavy production media at scale. The crossover is
mechanical: **migrate when `egress volume × markup > eng-time saved`.** Don't moralize it; compute it.
**Source.** [[raw/field-03-migration-war-stories.md]] §4, §5;
[[raw/ecosystem-02-uploadthing-and-upload-libs.md]] (honest trade-off).
*(Live debate — see [[GAPS-AND-DISPUTES]] Dispute B.)*

### O-08 — DEFAULT to direct-to-bucket presigned upload; reserve through-your-server for inline validation you genuinely need
**Because** there are exactly three upload architectures and the choice is deliberate, not accidental.
**Direct-to-bucket (presigned)** is the default: cheapest, no upload bandwidth through your server, no
6 MB/29s serverless wall — at the cost that validation must happen *async post-upload*.
**Through-your-server** is only justified when you *must* validate/scan/transform inline AND files are
small enough to stream without melting memory (use `formidable`/busboy, never buffer the whole file); it
doesn't scale. **Managed** is the speed-to-market escape hatch (see O-07). Pick by which constraint
binds, not by what the first tutorial showed.
**Source.** [[raw/ecosystem-02-uploadthing-and-upload-libs.md]] (the architectural fork);
[[raw/field-04-presigned-urls-large-files-timeouts.md]] §4.

### O-09 — Store the URI in the DB, the bytes in object storage; small (<256K) transactional blobs in the DB are a defensible EXCEPTION, not the default
**Because** large files in SQL bloat storage, slow queries, and inflate backups — Microsoft Research's
"To BLOB or Not To BLOB" threshold is the durable rule: objects **>1M → filesystem/object store**,
objects **<256K → DB is fine** (transactional consistency can win for tiny, edit-critical blobs). Default
to object-storage-with-DB-pointer; only drop a small blob in the DB when transactional atomicity with the
row genuinely matters. This pairs with O-03 (the pointer is what you update on a new immutable upload).
**Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §2.7, §3 (Dispute C).

---

## Tier 3 — Security stances (hard refusals)

### O-10 — REFUSE SVG from untrusted users; if forced, rasterize to PNG in a sandbox and discard the original
**Because** SVG is an **XML document, not an image**. It XSSes the browser via event handlers AND SSRFs
the server via `<image xlink:href="http://169.254.169.254/...">` and external-entity refs when
server-side rendered (e.g. for thumbnailing) — Kuno CMS shipped *both* CVEs from the same upload feature
(CVE-2025-61681 XSS, CVE-2025-61768 SSRF). It is the single most dangerous "image" upload. The strong
take practitioners hold: don't "sanitize it lightly" — refuse it, or rasterize-and-discard in a sandbox.
**Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §2, §3.

### O-11 — ALWAYS sanitize at BOTH the write side AND the read side; one-sided defense is no defense
**Because** the most instructive bug in the corpus (Postiz CVE-2026-40487) failed *because* defense was
one-sided: the upload layer trusted the request `Content-Type` (spoofable), and the serving layer
(nginx) independently **re-derived** Content-Type from the file extension — the attacker controlled both.
Write-side: magic-byte validate + allowlist + random key. Read-side: force a safe `Content-Type`,
`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, restrictive CSP, **separate
cookieless domain**. An answer that only validates on upload is wrong; the bug is two-sided.
**Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §1, §7, §8;
[[raw/ecosystem-03-presigned-access-control-validation.md]] (best practice 3).

### O-12 — ALWAYS treat any server-side media transform on user input as part of your attack surface; pin, harden, sandbox
**Because** ImageMagick "delegate" command-injection (ImageTragick) is *still* exploitable in 2025 and
the transform library becomes RCE-reachable the moment it touches user bytes. Re-encoding media is also a
security control, not just optimization — re-encoding a JPEG strips appended polyglot payloads and EXIF.
So: pin transform-lib versions, disable risky delegates via `policy.xml`, run transforms in a sandbox
(E2B / restricted container), and re-encode rather than pass-through. For self-hosted imgproxy this
extends to **URL signing being mandatory in prod** (`IMGPROXY_KEY`+`IMGPROXY_SALT`) plus a source
allowlist — unsigned imgproxy is an open proxy = SSRF + bandwidth abuse.
**Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §4, §5;
[[raw/ecosystem-06-image-optimization-cdn.md]] (imgproxy gotchas).

### O-13 — ALWAYS validate resource consumption, not just file type; "validate the file" means decompressed size + pixel dimensions + ratio + time
**Because** the average dev reads "validate the upload" as content-type/extension; the senior dev also
caps *what the file does to your machine*. A 42 KB zip expands to 4.5 PB; a 50,000×50,000 PNG is tiny on
disk but OOMs the decode library (pixel-flood). These are one-request DoS. Cap max upload size,
decompressed size, compression ratio, entry count, pixel dimensions, and processing time; stream-
decompress with a hard ceiling; never extract to a RAM disk without a quota; treat nested archives as
hostile.
**Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §6.

### O-14 — Treat presigned URLs as a STRICT CRYPTOGRAPHIC PROTOCOL, not a convenient shortcut
**Because** casual treatment is how uploads silently 403 in production. The first-person postmortem nails
it: *"Treat them as a strict protocol — not just a convenient upload shortcut."* Concretely: (a) return
the **exact signed-header set** to the client and send only those (defeats SDK-injected `amz-sdk-request`
drift, which masquerades as a CORS bug); (b) **NTP-sync every signer** (>15 min clock skew = instant
`SignatureDoesNotMatch`); (c) know your **effective expiry = `min(set-TTL, remaining-STS-session)`** —
a Lambda-signed "24h" URL dies at ~1h (temp creds), 7-day SigV4 hard cap; (d) debug
`SignatureDoesNotMatch` by **diffing the canonical request**, never by rotating credentials; (e) prefer
**presigned POST policy** over PUT for browser uploads (signs fields/conditions, not arbitrary headers,
so SDK header-drift can't happen — and it can *enforce* size/type, which PUT cannot).
**Source.** [[raw/field-04-presigned-urls-large-files-timeouts.md]] §1, §2, §3;
[[raw/ecosystem-03-presigned-access-control-validation.md]] (PUT-vs-POST gotcha).

### O-15 — A signed URL is a bearer CAPABILITY, not identity-based access; keep TTL short and gate revocable access at the edge
**Because** anyone holding a signed URL has access until it expires — leaks happen via logs, screenshots,
browser history, and the `Referer` header. The real guardrail is **not** the URL but the **narrowly-
scoped signing principal** (one bucket, one prefix, put-only — a presigned URL can never grant more than
the principal that signed it). For *per-user, revocable* access, do **not** hand out long-lived signed
URLs; gate at your app/edge (check session → 302 to a fresh short-TTL URL), or use **CDN signed
URLs/cookies** when you need private content *with* edge caching. Default upload-URL TTL: **minutes**.
**Source.** [[raw/ecosystem-03-presigned-access-control-validation.md]] (best practices 1, 2; downloads;
capability-vs-identity).

### O-16 — STOP using object ACLs; access is policy-based now, and "is the bucket public?" is the wrong audit question
**Because** of the 2026 platform-default shifts: S3 **ACLs are DISABLED by default** (BucketOwnerEnforced)
— `putObject({ACL:'public-read'})` now throws `AccessControlListNotSupported` (a live "worked in the old
tutorial, 400s today" trap) — and **Block Public Access is ON by default** for new buckets, so exposure
requires *deliberately* dismantling guardrails. The new failure mode is **"someone turned OFF Block
Public Access for a quick fix and forgot,"** not fresh-default exposure. Audit for *changes to* BPA
(CloudTrail/config history), treat BPA as a tripwire, and prefer **CDN-fronted serving over ever making a
bucket public at all**.
**Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §1a, §1b.

---

## Tier 4 — Operational stances (cost, lifecycle, delivery, scanning)

### O-17 — On EVERY upload bucket, day one: set the abort-incomplete-multipart-uploads lifecycle rule
**Because** orphaned multipart uploads (started, never completed/aborted) persist, **bill as storage
forever, and are invisible to a normal `ListObjects`** — the #1 mystery storage bill. It's cheap
insurance: a lifecycle rule to abort incomplete multiparts after N days (e.g. 7), plus (on versioned
buckets) expire noncurrent versions + clean delete-markers. Discover existing orphans with
`rclone backend list-multipart-uploads <remote>:`. Supported on both S3 and R2.
**Source.** [[raw/ecosystem-07-lifecycle-retention.md]] §1;
[[raw/ecosystem-05-multipart-resumable-tus.md]] (orphaned multiparts);
[[raw/field-04-presigned-urls-large-files-timeouts.md]] §5.

### O-18 — NEVER mark an upload "ready" until the scan flips it clean; an object is `pending` and unservable until then
**Because** scanning is **asynchronous** (cold start + DB load + scan = seconds–minutes) and the
product-breaking bug is treating a presigned-upload 200 as ready-to-serve: the app serves the file, the
scan finishes minutes later and finds malware *already downloaded by other users*. Land uploads in an
incoming/quarantine prefix served to nobody; promote (or flip the tag the serving layer checks) only on
`scan-status=clean`. And **maintain the definitions updater** (a separate scheduled `freshclam`) — the
most-skipped piece; without it the scanner silently rots and misses new malware.
**Source.** [[raw/ecosystem-04-virus-scanning.md]] (latency/UX gotcha; defs updater).

### O-19 — Pick the AV engine by platform: GuardDuty Malware Protection for S3 on AWS, DIY ClamAV off AWS — and NEVER base it on the archived `bucket-antivirus-function`
**Because** the once-canonical OSS repo (bluesentry/bucket-antivirus-function, 533★) is **ARCHIVED**
(last push 2024-04) — copying it ships unmaintained AV. On AWS the managed default is now **GuardDuty
Malware Protection for S3** (ML+heuristic beyond ClamAV's signatures, defs every 15 min vs ClamAV's
daily, `$0.09/GB` after the 2025 −85% price cut, real migrations cut Lambda cost −99.8%). Off AWS
(R2/B2/Tigris — no equivalent managed primitive exists) use the maintained **`opg-s3-antivirus`** ClamAV
pattern, or **`clara`** for ClamAV+YARA. Do NOT present virus scanning as "solved by an off-the-shelf
tool" off-AWS — it's a pattern you own (engine + definitions + quarantine lifecycle).
**Source.** [[raw/ecosystem-04-virus-scanning.md]] (engine options; archived repo);
[[raw/ecosystem-10-starter-template-repos.md]] (AV starters).

### O-20 — DON'T invalidate the CDN for normal deploys — change the URL; reserve purge for emergencies
**Because** purge-based invalidation is a trap on every axis: propagation is **10–60s** (not atomic, so
users split old/new), wildcard `/*` causes an **origin thundering herd**, there's a hard **15-
invalidation-paths-in-progress** cap (→ `TooManyInvalidationsInProgress`), and CloudFront **won't even
notice** an S3 object changed. The architectural fix is the two-tier cache policy: content-hashed
immutable assets (`max-age=31536000, immutable`) + a `no-cache`/short-TTL pointer (HTML/API). New content
= new URL → all four problems vanish at once. Purge is for pulling leaked/illegal content, via Cache
Tags / surrogate keys — **never `/*` on a deploy**.
**Source.** [[raw/field-05-cdn-cache-invalidation.md]] §1–§4.

### O-21 — For resume-across-interruption use tus; for "big file, one session" use S3 multipart; NEVER conflate the two, and NEVER trust the word "resumable" without testing part-reuse
**Because** they are distinct mechanisms: **multipart** = one large object split into parts (5 MiB–5 GiB,
≤10,000, object ≤5 TiB) — *not* inherently resumable across a refresh/sleep unless you persist `UploadId`
+ part ETags. **tus** = an HTTP protocol (PATCH + `Upload-Offset`) that survives network drops and page
reloads. "Resumable" is a spectrum, and real Uppy issues prove the label lies: multipart never completes
after sleep (#3783); retry re-uploads already-done parts (#5762). **tus is the only path that reliably
survives sleep/network-drop.** Run tusd correctly: pin **v2.10.0+** (ongoing HTTP/2 fixes), **disable
the concatenation extension** (non-idempotent → duplicate data on retry, #1364), and **never back it with
SMB/CIFS** (permanent dead locks, #1372 — use the S3 store).
**Source.** [[raw/ecosystem-05-multipart-resumable-tus.md]] (two mechanisms; tusd deltas);
[[raw/ecosystem-08-real-breakage-github-issues.md]] (Uppy #3783, #5762; tusd #1364, #1372).

### O-22 — ALWAYS set CORS explicitly on direct-to-bucket setups — R2 especially has NO default CORS
**Because** CORS is the #1 cause of "upload doesn't work," and **R2 presigned-PUT 401s + CORS failures
are the single most common storage integration bug of 2026** (a recurring failure cluster across many
2026 app repos). Root causes are almost always: signing with the wrong endpoint/region (R2 wants
`region:"auto"` + the account-specific endpoint), a missing/incorrect bucket CORS policy (R2 has *no*
default — you must set it via API/dashboard), or signing headers the client doesn't reproduce exactly.
**Test the `OPTIONS` preflight explicitly** for every method/header — don't assume "works on Chrome =
works everywhere" (Safari/iOS routinely breaks multipart that Chrome handles, Uppy #6292).
**Source.** [[raw/ecosystem-08-real-breakage-github-issues.md]] (R2 presigned cluster; Uppy #6292);
[[raw/ecosystem-03-presigned-access-control-validation.md]].

---

## Tier 5 — Agent-native stances (shelf is an AGENT, not a human at a dashboard)

### O-23 — On R2, prefer the official Cloudflare MCP for object CRUD; off Cloudflare, prefer `rclone`/`aws --endpoint-url` over an unvetted low-star S3 MCP
**Because** an agent's "hands" are CLIs/SDKs/MCP, not a web dashboard, and the quality of those hands
varies wildly. The **Cloudflare MCP** (`cloudflare/mcp-server-cloudflare`, 3,867★, active) exposes
`r2_list_buckets`, `r2_*_bucket`, `r2_list_objects`, `r2_{get,put,delete}_object` with a scoped CF API
token — the cleanest agent path on the fleet's R2 default; wire it in `.mcp.json`. But there is **no
first-party AWS MCP for plain S3 object CRUD** (the AWS `s3-tables-mcp-server` is Iceberg-only), and the
generic S3-compatible MCP space is an **unvetted long tail of low/zero-star one-offs** — depending on one
in prod is the trap. Off Cloudflare, use `rclone` / `aws s3api --endpoint-url`, or have **shelf own a
thin S3-compatible MCP** (a genuine gap shelf could fill — see [[GAPS-AND-DISPUTES]]).
**Source.** [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (Cloudflare MCP; AWS + generic MCP gap).

### O-24 — Use `rclone` as the default cross-provider hands (migration, orphan-hunting, multi-backend); reach for `s5cmd` only when `aws s3` is the bottleneck at scale
**Because** `rclone` ("rsync for cloud storage") speaks S3/R2/B2/Tigris/GCS/Azure/MinIO + 60 backends
from one tool — it is the best single migration CLI (`rclone sync` is the "move S3→R2" job), and it is
how an agent *finds the invisible cost* (`rclone backend list-multipart-uploads <remote>:`). `aws`/`aws
s3api` is the baseline for presign/multipart/lifecycle/object-lock (with `--endpoint-url` for any
S3-compatible endpoint). Reserve `s5cmd` (very fast parallel Go CLI) for bulk operations where `aws s3`
is genuinely too slow — don't reach for it reflexively. `wrangler` is the R2-native CLI for one-off R2
ops.
**Source.** [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (CLIs; agent playbook).

### O-25 — NEVER hand-roll multipart in code; use `@aws-sdk/lib-storage` `Upload` (JS) / `boto3 upload_file` (Python), and NEVER track upload state in a `new Map()` on serverless
**Because** hand-rolled multipart is where the gotchas live (the 5 MiB min-part-size → `EntityTooSmall`,
the 3-call presigned flow, the `MD5(concat(part MD5s))-N` ETag that breaks integrity checks) — the SDK
`Upload` helpers handle all of it. And the metadata/state layer, **not the bytes**, is the serverless
bottleneck: a `new Map()` for upload state in a Vercel/Lambda route is empty on every cold start (mirrors
`.claude/rules/typescript.md`; UploadThing's #1244 "Transaction pool connection limit exceeded" is the
metadata DB, not storage). Use a serverless-safe external store (**Upstash/Supabase**) for upload state.
**Source.** [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (SDK helpers);
[[raw/ecosystem-05-multipart-resumable-tus.md]] (multipart gotchas);
[[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §4.

### O-26 — TREAT every starter repo's last-push date as load-bearing; copy maintained sources, reference (don't copy) stale ones
**Because** the freshest minimal R2-direct presigned starters are stale or low-star, and stale starters
ship moved APIs: `rajeshdavidbabu/s3-upload-thing` (2024-10, predates Uppy merging the multipart plugin),
`ryanto/next-s3-upload` (2024-12), `dropzone/dropzone` (2024-07). Copy from **maintained** sources
(uploadthing `examples/`, `vercel/storage` for the client-vs-server-upload patterns, SST `Bucket` for
IaC-first), use stale ones as **concept references only**, and verify you're on the **merged**
`@uppy/aws-s3` plugin (not the deprecated split `aws-s3-multipart`). *Note the org rename signal:* SST is
now `anomalyco/sst` — ownership changes are a real maintenance signal to flag.
**Source.** [[raw/ecosystem-10-starter-template-repos.md]] (starters; stale/archived).

---

## Tier 6 — Self-stances (how shelf itself should behave)

### O-27 — When a stance has a credible counter-source, hold the SYNTHESIS, not a side — and say which workload flips it
**Because** the strongest disputes in this domain (R2-vs-S3, SDK-vs-raw, blob-in-DB) are *both right for
different workloads*. A storage employee that picks a tribe is wrong half the time. shelf's value is
naming the **condition** that flips the default (egress shape, scale crossover, transactional need), not
defending a brand. Every Tier-2 stance above points to its [[GAPS-AND-DISPUTES]] entry for exactly this
reason.
**Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §3 (Disputes A–D).

### O-28 — When the research is vendor-sourced or stale, DOWNGRADE the dollar figure but KEEP the mechanism — and verify live before betting prod
**Because** much of the cost intel comes from cost-optimization vendors (Usage.ai, LeanOps) with an
incentive to dramatize bills, and some pricing/limit figures are months old. The discipline: cite the
**mechanism** as high-confidence (unbounded demand-driven egress; orphaned-multipart invisible billing;
the 15-path purge cap) and treat the **specific number** as directional — verify current pricing/limits/
SDK-bug-status against the official page at build time. This is the storage application of the fleet's
"never give up, but verify" ethos. What to re-verify is enumerated in [[GAPS-AND-DISPUTES]].
**Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] (Open/unconfirmed);
[[raw/field-03-migration-war-stories.md]] (Open/unconfirmed);
[[raw/ecosystem-01-storage-providers.md]] (GAPS).

---

## The one-sentence creed (the shape every correct answer takes)

> **Don't trust the client** (filename, content-type, headers); **make things immutable** (random keys,
> content-hashed URLs); **put a CDN/edge in front of every hot byte**; **store the pointer in the DB and
> the bytes in object storage** — and pick the provider **per-workload**, not per-tribe.
> Source: [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §5.
