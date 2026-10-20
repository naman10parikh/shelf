---
title: "Field Intel 06 — 2026 Shifts, Explicit Taste, Disputes & Internal-Corpus Sync"
type: synthesis
created: 2026-06-16
tags: [field-intelligence, synthesis, taste, disputes, 2026-shifts, gaps]
summary: "What changed in 2026 that invalidates 2025 wisdom; the strong opinions great storage practitioners hold; where credible sources disagree; and how this maps onto Energy's existing storage/asset conventions."
sources_meta: "Synthesis of field-01..05 + AWS docs/HN, June 2026. X/Twitter signal SKIPPED (stale auth — see §6)."
---

# Field Intel 06 — 2026 Shifts, Taste, Disputes & Internal Sync

## 1. What changed in 2026 that invalidates 2025 conventional wisdom

### (a) S3 Block Public Access is now ON by default for NEW buckets
- HN "AWS in 2025: Stuff you think you know that's now wrong" (<https://news.ycombinator.com/item?id=44962844>): *"Block Public Access is now enabled by default on new buckets."* It functions as *"a redundancy built in to save people from making really big mistakes — even with permissive bucket policies, the setting still blocks public access unless explicitly disabled."*
- **Invalidates:** the entire 2017-2024 genre of "accidentally-public S3 bucket" breaches assumed public was easy/default. It is now **opt-out** — you must *deliberately* dismantle 2-3 guardrails to expose a bucket. The breaches in field-02 §"public bucket" (273K bank PDFs, healthcare records) increasingly come from **pre-existing old buckets** or **someone actively disabling** the block, not fresh-default exposure.
- **Taste correction for shelf:** "is the bucket public?" is now less likely the bug; "did someone *turn off* Block Public Access for a 'quick fix' and forget?" is the new failure mode. Audit for *changes to* BPA, not just current public state.

### (b) S3 ACLs are DISABLED by default (BucketOwnerEnforced) since 2023, now universal
- AWS docs + Cevo "Disabling S3 ACLs and Object Ownership" (<https://cevo.com.au/post/disabling-s3-acls-and-s3-object-ownership/>): *"By default, Object Ownership is set to the Bucket owner enforced setting, and all ACLs are disabled."* Breaking change (verbatim): *"All S3 PUT requests must either specify the `bucket-owner-full-control` canned ACL or not specify an ACL, or these requests will fail… requests to set ACLs… fail with a 400 error and return the `AccessControlListNotSupported` error code."*
- **Invalidates:** every tutorial/SDK-snippet from before 2023 that sets `ACL: 'public-read'` on `putObject`. That call now **throws `AccessControlListNotSupported`** on default buckets. This is a live source of "worked in the old tutorial, 400s today" pain.
- **Taste:** access is now **policy-based, not ACL-based.** Public read = a bucket policy (after disabling BPA) or, better, a CDN in front. Stop using object ACLs.

### (c) R2 graduated from "niche" to a credible *default* — but only traffic-aware
- The energy checklist itself (`audit/HARNESS-CHECKLIST-2026.md` line 342) now names R2 the default. But field-01 §3 + field-03 §1 show the 2026 nuance: R2 wins for hot/public (zero egress), **loses** for write-heavy (Class-A `$4.50/M`), cold (no tiering, 69% pricier), and event-driven (no event notifications). 2025's "S3 is always the safe default" is dead; 2026's "R2 is always the cheap default" is *also* wrong.

### (d) The DX-upload-SDK backlash (Vercel Blob / UploadThing)
- 2024 wisdom: "use Vercel Blob / UploadThing, uploads are hard." 2026 sentiment (field-03 §4): *"will only cost you a fortune over using an S3 provider directly"* — the egress markup (Vercel Blob `$0.05/GB` vs R2 `$0.00`) compounds at scale. The pendulum swung back toward direct-to-R2/S3 presigned uploads for production.

### (e) EU Data Act egress-waiver-on-exit (2024→) — narrow relief
- Hyperscalers now waive egress *only* when you leave the platform entirely. Does **not** touch in-use egress → the viral-file blowup risk (field-01 §1) is unchanged. Easy to over-read this as "egress is solved." It isn't.

## 2. Explicit TASTE — opinions great storage practitioners hold that average ones don't

1. **"Budget egress, not storage."** Storage is cents; egress is a four-figure surprise driven by *someone else's* download behavior (field-01 §1). The average dev sizes the bill from GB stored; the senior dev alerts on egress and puts a CDN/R2 in front of every hot object.
2. **"Never put a user's filename in an object key."** Random UUID key + filename-in-metadata kills path-traversal, the non-ASCII encoding-mismatch class (field-04 §6), AND the overwrite-in-place cache-staleness class (field-05 §5) simultaneously. (Mirrors energy's own design rule against placeholder/gray-box images — generate, don't echo.)
3. **"SVG is a document, not an image."** It XSSes the browser AND SSRFs the server (field-02 §2-3). The strong take: refuse SVG from untrusted users, or rasterize to PNG in a sandbox and discard the original.
4. **"Presigned URLs are a strict cryptographic protocol, not a shortcut"** (Agrawal, field-04 §1). Return the signed-header set; NTP-sync signers; know your effective expiry is `min(set, STS-session)`.
5. **"Don't invalidate the CDN; change the URL"** (field-05 §4). Content-hashed immutable assets + no-cache pointer. Purge is for emergencies, not deploys.
6. **"Never proxy file bytes through your function."** Direct-to-storage presigned upload, always (field-04 §4) — dodges the 6MB Lambda / 29s gateway wall and the egress double-charge.
7. **"Store the URI in the DB, the bytes in object storage."** (field-05 cross-ref + BLOB-vs-DB consensus.) Microsoft Research "To BLOB or Not To BLOB" threshold: <256K → DB is fine; >1M → filesystem/object store. *"Don't store large files in your SQL database — it bloats storage, slows queries, inflates backups."* Source: learn.microsoft.com <https://learn.microsoft.com/en-us/archive/blogs/josebda/to-blob-or-not-to-blob-large-object-storage-in-a-database-or-a-filesystem>; DEV "Avoid storing files in the database" <https://dev.to/codewithshan/avoid-storing-files-in-the-database-here-is-what-you-should-do-3b39>.
8. **"Every upload bucket needs the abort-incomplete-multipart lifecycle rule."** Orphaned parts bill as invisible storage forever (field-04 §5) — a top mystery-bill cause.

## 3. Where credible sources DISAGREE (→ GAPS-AND-DISPUTES, both sides verbatim)

### Dispute A — "Is R2 actually cheaper, or just cheaper-looking?"
- **Pro-R2 (verbatim):** *"if R2 is S3 with no egress, suddenly there is a value proposition again"* (HN 28685312); digitalapplied: 10TB egress = $15/mo R2 vs $891/mo S3.
- **Skeptic (verbatim):** *"The internet is full of R2 pricing pages showing the $0/GB egress fee and declaring victory"* and *"zero egress means nothing if your architecture depends on S3 event notifications"* (LeanOps, field-03 §1); R2 storage is *"2.5x higher than Wasabi… Backblaze B2"* (field-01 §3).
- **Resolution:** both right, different workloads. Hot/public → R2. Cold/write-heavy/event-driven → S3. **Per-workload, not per-company.**

### Dispute B — "Use a DX upload SDK, or roll your own presigned flow?"
- **Pro-SDK:** Vercel Blob "excellent for transient workloads… image processing pipelines, build artifacts" (edge-cases.com, field-03 §4); UploadThing removes real boilerplate.
- **Anti-SDK (verbatim):** *"services like Vercel blob and Uploadthing might not be necessary and will only cost you a fortune over using an S3 provider directly"* (DEV, field-03 §4).
- **Resolution:** SDK for prototype/transient/low-scale; raw R2/S3 presigned for read-heavy production. The crossover is when egress volume × markup > your eng time saved.

### Dispute C — "Store files in the DB, ever?"
- **Never-in-DB camp (verbatim):** *"Don't store large files in your SQL database — it bloats storage, slows queries, inflates backups."*
- **Sometimes-OK camp (verbatim, MS Research):** *"objects smaller than 256K are best stored in a database while objects larger than 1M are best stored in the filesystem"* — i.e., tiny blobs in DB can win on transactional consistency.
- **Resolution:** default object-storage-with-DB-pointer; small (<256K), transactionally-critical blobs in DB are a defensible exception, not the default.

### Dispute D — "Is the viral-file egress blowup a real risk or vendor FUD?"
- **Real:** Usage.ai/CloudSee cite the $23→$2,657 viral-file and Dropbox's $74.6M exit.
- **Caveat:** these are cost-tooling *vendors* with incentive to dramatize (field-01 Open). The *mechanism* (unbounded demand-driven egress) is undisputed; the specific headline numbers are vendor-sourced.

## 4. Internal-corpus cross-references (READ-ONLY — quoted, not edited)

- **`audit/HARNESS-CHECKLIST-2026.md` §"Object storage / CDN / file uploads" (line 342):** *"Default: Cloudflare R2 (no egress fees). Alts: AWS S3, UploadThing… Supabase Storage, Bunny (CDN). GAP."* — This research **fills that GAP** with the failure-mode/decision-rule depth the one-liner lacks. Source it names (`a sibling project STACK.md`, R2-vs-Vercel-Blob) aligns with field-03 §4.
- **`.claude/rules/typescript.md` (line 13):** *"NEVER use `new Map()` for cross-request state in Vercel API routes… Use external stores (Supabase, Upstash)."* — Direct cousin of field-04 §6's uploadthing #1244 *"Transaction pool connection limit exceeded in production"*: the **metadata/state layer** (not the bytes) is the serverless-storage bottleneck. shelf's metadata store must be serverless-safe (Upstash/Supabase), not in-process.
- **`.claude/rules/design.md` (lines 17, 37):** *"Images: use generated/curated assets, never stock photos. Nano Banana for photorealistic."* / *"No placeholder images — if no image, use a gradient or icon, never gray boxes."* — Energy already *generates* its visual assets (Nano Banana). Implication for shelf: the asset *pipeline* (generate → store → serve via CDN with hashed immutable URLs, field-05 §4) is the storage side of this design rule. Generated assets are content-addressable by nature → perfect fit for hash-keyed immutable caching.
- **`.claude/rules/wikimem-chrome-fallback.md` (line 19):** screenshots saved under `content/screenshots/<audit>-<date>/` — Energy's own screenshot/asset convention is **date-namespaced directories** (a human-readable prefix-key scheme). shelf's object-key strategy should preserve this readability for *internal* assets while using random UUIDs for *untrusted user* uploads (field-06 §2 taste #2).

## 5. The one-paragraph thesis for shelf (the domain expert's stance)

Object storage looks trivial ("it's just `putObject`") and is the opposite: the bill is egress-dominated and demand-driven (a single viral object = four figures), the security surface is the *content* of what users upload (Content-Type lies; SVG is a weapon; magic-byte-validate or get XSS'd/SSRF'd/RCE'd), the upload path is a strict crypto protocol that 403s on header drift and dies early under temp creds, the provider choice is per-workload-reversible (R2 for hot, S3 for events/cold/compliance) and the DX SDKs tax you exactly when you succeed, and the delivery layer punishes purge-based invalidation (propagation delay + 15-cap + origin stampede) so you change the URL instead of invalidating. The competent move on every axis is the same shape: **don't trust the client (filename, content-type, headers), make things immutable (random keys, content-hashed URLs), put a CDN/edge in front of every hot byte, and store the pointer in the DB and the bytes in object storage.**

## 6. X / Twitter signal — SKIPPED (documented)
- Per hard rule #6, I attempted X via `energy/scripts/x-content-intel/scrape.py` with `~/.claude/x-auth/x-session.json`. **Auth loaded successfully** but the GraphQL search endpoint returned **HTTP 404** ("Search page 1: HTTP 404 — stopping", 0 tweets). Session file dated **2026-04-07** (~10 weeks old); X rotates GraphQL query IDs frequently, so the stored endpoint ID is stale.
- **Decision:** did not pursue further (would require re-authing X interactively, out of scope for read-only research). Relied on **HN (5 threads), GitHub (uploadthing issues + 3 GHSA advisories), AWS re:Post, and engineering blogs** — which yielded strong, dated, first-person practitioner signal. X is the one source channel not covered; flagged here so a future run with fresh auth can add social-velocity signal (which storage providers practitioners are migrating to/from *this week*).
