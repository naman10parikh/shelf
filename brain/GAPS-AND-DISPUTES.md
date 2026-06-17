---
title: "shelf Gaps & Disputes — where sources disagree, where none exists, what couldn't be confirmed"
type: synthesis
created: 2026-06-16
tags: [shelf, brain, gaps, disputes, unconfirmed, experiments]
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
related: ["[[EXPERTISE-MAP]]", "[[BATTLE-TESTED-SCENARIOS]]", "[[KNOWN-PITFALLS]]", "[[OPINIONS]]", "[[TOOL-MATRIX]]"]
summary: "The honest edges of the brain: the four live debates (both sides verbatim), the facts that must be re-verified live before betting prod, and the questions no good source answers — which shelf must settle by its own experiments."
---

# shelf Gaps & Disputes

> This is the **honesty layer**. The other five brain files state things confidently; this file is where
> shelf admits what's contested, what's stale, and what nobody knows. It has three parts:
>
> 1. **Disputes (A–G)** — credible sources disagree. Both sides are quoted; shelf holds the *synthesis*
>    plus the condition that flips the default (this is the discipline [[OPINIONS]] O-27 enforces).
> 2. **Unconfirmed / must-verify-live (V-01..V-13)** — facts the researchers could not nail down, or that
>    drift fast (pricing, SDK bugs, platform limits). Each says exactly *how* to confirm at build time.
>    This is the operational form of [[OPINIONS]] O-28 ("downgrade the number, keep the mechanism").
> 3. **No-good-source gaps (G-01..G-08)** — questions where research surfaced *no* trustworthy answer.
>    shelf must form its own view by **running an experiment** — each has a concrete experiment design so
>    the answer becomes a future brain entry, not a permanent hole.
>
> **Rule for shelf:** before asserting any contested or fast-drifting fact in a deliverable, check this
> file. If it's a Dispute, give the synthesis + flip-condition, never a tribe. If it's a V-entry, run the
> stated verification first (or label the claim "as of June 2026, verify"). If it's a G-entry, say "no
> good source — here's the experiment that would settle it," don't fabricate confidence.

---

## Part 1 — DISPUTES (credible sources disagree; both sides verbatim)

> Disputes A–D are the four the rest of the brain cites by letter ([[OPINIONS]] O-05/O-07/O-09/O-01,
> [[BATTLE-TESTED-SCENARIOS]] S1/S3/S19). They are reproduced here as the canonical record. E–G are
> additional contested calls surfaced across the raw corpus.

### Dispute A — "Is R2 actually cheaper, or just cheaper-looking?"
- **Pro-R2 (verbatim).** *"if R2 is S3 with no egress, suddenly there is a value proposition again"*
  (HN 28685312); digitalapplied: 10 TB egress = **$15/mo R2 vs $891/mo S3**.
- **Skeptic (verbatim).** *"The internet is full of R2 pricing pages showing the $0/GB egress fee and
  declaring victory"* and *"zero egress means nothing if your architecture depends on S3 event
  notifications"* (LeanOps); R2 storage is *"2.5x higher than Wasabi… Backblaze B2"*.
- **shelf's synthesis.** **Both right, different workloads.** Hot/public download-many → R2 wins big.
  Write-heavy (Class A `$4.50/M`), cold/archival (storage premium + no tiering, ~69% pricier than
  S3+lifecycle), and event-driven (no event notifications) → S3. **Decide per-workload, not per-company.**
- **The flip-condition (the actual expertise).** R2 wins iff `monthly_egress_$_on_S3 > (R2_storage_premium
  + R2_class_A_writes_$ + cost_of_rebuilding_lost_control_plane_features)`. If egress ≈ 0, R2's only
  benefit is unused and you're paying the premium for nothing.
- **Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §3 (Dispute A);
  [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3; [[raw/field-03-migration-war-stories.md]] §1.
- **Cited by.** [[OPINIONS]] O-05, [[BATTLE-TESTED-SCENARIOS]] S1/S3.

### Dispute B — "Use a DX upload SDK (UploadThing / Vercel Blob), or roll your own presigned flow?"
- **Pro-SDK (verbatim).** Vercel Blob *"excellent for transient workloads… image processing pipelines,
  build artifacts"* (15-min sampling billing wins for short-lived data); UploadThing *removes real
  boilerplate*.
- **Anti-SDK (verbatim).** *"services like Vercel blob and Uploadthing might not be necessary and will
  only cost you a fortune over using an S3 provider directly"*; *"Uploads are easy, S3 is easy."*
- **shelf's synthesis.** SDK for **prototype / transient / build-artifact / low-scale / no-infra-team**;
  raw R2/S3 presigned for **read-heavy production at scale**.
- **The flip-condition.** Migrate off the SDK when **`egress_volume × per-GB_markup > eng-time_saved`**.
  The markup compounds *exactly when you succeed* (more users → more downloads → bigger bill) — this is
  the [[BATTLE-TESTED-SCENARIOS]] S1 viral-file risk with a 3–5× multiplier. Compute it; don't moralize.
- **Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §3 (Dispute B);
  [[raw/field-03-migration-war-stories.md]] §4, §5.
- **Cited by.** [[OPINIONS]] O-07, [[BATTLE-TESTED-SCENARIOS]] S19.

### Dispute C — "Store files in the database, ever?"
- **Never-in-DB camp (verbatim).** *"Don't store large files in your SQL database — it bloats storage,
  slows queries, inflates backups."*
- **Sometimes-OK camp (verbatim, Microsoft Research "To BLOB or Not To BLOB").** *"objects smaller than
  256K are best stored in a database while objects larger than 1M are best stored in the filesystem"* —
  tiny blobs in the DB can win on transactional consistency.
- **shelf's synthesis.** **Default: object-storage-with-DB-pointer.** Small (<256K), transactionally-
  critical blobs in the DB are a *defensible exception*, not the default.
- **The flip-condition.** Put a blob in the DB only when **atomic transactional consistency with the row
  it belongs to genuinely matters** AND it's <256K. The 256K–1M band is a judgment zone — measure your
  DB's row-size + backup impact before deciding. Above 1M, never.
- **Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §3 (Dispute C), §2.7.
- **Cited by.** [[OPINIONS]] O-09.

### Dispute D — "Is the viral-file egress blowup a real risk or vendor FUD?"
- **Real (verbatim).** Usage.ai/CloudSee cite the **$23 → $2,657** viral-file blowup and Dropbox's
  **$74.6M** two-year exit savings.
- **Caveat (verbatim).** these are cost-tooling **vendors** with an incentive to dramatize bills.
- **shelf's synthesis.** The **mechanism is undisputed** (unbounded, demand-driven egress you don't
  control); the **specific headline number is vendor-sourced and unverified to a primary**. The
  **NixOS Foundation** story (~$9,000/mo, ~$32K to exit) **is** a verified named-org primary and
  corroborates the egress-dominated thesis at sustained scale.
- **The discipline.** Cite the mechanism as high-confidence; treat the dollar figure as illustrative.
  Lead with NixOS (verified) when you need a citable number, not "$23→$2,657" (vendor, untraced).
- **Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §3 (Dispute D);
  [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §1, §3b, Open/unconfirmed.
- **Cited by.** [[OPINIONS]] O-01, [[BATTLE-TESTED-SCENARIOS]] S1/S2.

### Dispute E — "Managed AV (GuardDuty) vs DIY ClamAV vs commercial (bucketAV) — at what volume does each win?"
- **Pro-managed (verbatim, cloudonaut/steamhaus).** Migrating ClamAV→GuardDuty Malware Protection for S3
  gave *"Lambda running cost −99.8%, upload→scan time −~75%, architecture simplified,"* ML+heuristic
  beyond signatures, defs every 15 min.
- **Pro-commercial-at-scale (vendor source, treat with skepticism).** bucketAV's own comparison claims
  *"bucketAV [is] more economical at very large data volumes"* than GuardDuty.
- **shelf's synthesis.** **On AWS, default to GuardDuty** for small/medium volume (managed, cheaper, no
  ClamAV to run). DIY ClamAV (`opg-s3-antivirus` / `clara`) is the answer **off AWS** (R2/B2/Tigris have
  no equivalent managed primitive). bucketAV *may* win at very large AWS volume — but that figure is
  **vendor-sourced**; don't quote it as fact.
- **The flip-condition (UNRESOLVED — see V-09).** The exact GuardDuty-vs-bucketAV break-even GB is **not
  established** by any neutral source. Treat "very large volume" as a prompt to *measure*, not a number.
- **Source.** [[raw/ecosystem-04-virus-scanning.md]] (engine options; GAPS).
- **Cited by.** [[OPINIONS]] O-19, [[BATTLE-TESTED-SCENARIOS]] S14.

### Dispute F — "PUT vs POST for presigned uploads" — is the PUT size-limit really unfixable?
- **PUT-can't-enforce camp (verbatim, AWS Prescriptive Guidance + cross-SDK issues).** S3 *does not
  enforce `Content-Length` server-side for presigned PUT*; aws-sdk-go #1414 confirms across SDKs. POST
  policy's `content-length-range` *can* enforce it.
- **POST-isn't-reliable-either caveat (verbatim, boto3 #2261).** `generate_presigned_post()` has
  *silently ignored `content-length-range` in some versions* — even the "fix" can be broken.
- **shelf's synthesis (no real contradiction — both are warnings).** Use **POST policy** to bound
  size/type at the edge, **AND** re-validate size server-side via HEAD after upload regardless, **AND**
  verify in a test that oversize is actually rejected for your SDK version. The lesson is *defense in
  depth*, not "pick PUT or POST." There is **no presigned mechanism you can trust without a server-side
  backstop.**
- **The open edge (see V-04).** Whether boto3's `content-length-range` bug is fully fixed in the latest
  2026 botocore is **unconfirmed** — must test.
- **Source.** [[raw/ecosystem-03-presigned-access-control-validation.md]] (load-bearing gotcha; GAPS);
  [[raw/ecosystem-08-real-breakage-github-issues.md]] (boto3 #2261, aws-sdk-go #1414).
- **Cited by.** [[OPINIONS]] O-14, [[KNOWN-PITFALLS]] P-01/P-02, [[BATTLE-TESTED-SCENARIOS]] S6.

### Dispute G — "Object key scheme: random UUID vs human-readable date-prefix" (internal-vs-untrusted tension)
- **Random-UUID camp (the security default).** Random server-side keys kill path-traversal, the non-ASCII
  encoding-mismatch class (UploadThing #153), and overwrite-in-place cache staleness — one decision, three
  bug classes gone ([[OPINIONS]] O-02/O-03).
- **Human-readable-prefix camp (the fleet's own asset convention).** Energy stores screenshots/assets
  under `content/screenshots/<audit>-<date>/` — a *date-namespaced, human-readable* prefix scheme the
  chairman's review flow depends on ([[raw/ecosystem-00-internal-references.md]] §2,
  [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §4).
- **shelf's synthesis (resolved by trust boundary).** **Untrusted user uploads → random UUID keys.**
  **Internal, trusted, generated assets → human-readable date/scope-prefixed keys** (`<scope>/<date>/
  <hash>.<ext>`) — and since they're *content-addressable by nature* (Nano Banana generates them), the
  hash suffix gives immutability + cache-friendliness for free. The two schemes are **not in conflict;
  they apply to different trust zones.** Never use a user-supplied string in *either* without sanitizing.
- **Source.** [[raw/ecosystem-00-internal-references.md]] §2, §"Net takeaway";
  [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §4; [[raw/field-02-upload-security-rce-xss-ssrf.md]] §8.
- **Cited by.** [[OPINIONS]] O-02/O-03, [[EXPERTISE-MAP]] JTBD-2.6.

---

## Part 2 — UNCONFIRMED / MUST-VERIFY-LIVE (the number drifts; the mechanism doesn't)

> Each entry: **what's unconfirmed → why it matters → how to confirm at build time.** These are pulled
> from every raw file's "GAPS / unconfirmed" and "Open / unconfirmed" sections. The half-life of these
> facts is short (pricing, SDK bugs, platform limits) — re-verify before betting prod, per [[OPINIONS]] O-28.

### Pricing & economics
- **V-01 — Exact Tigris and Supabase Storage per-GB rates.** Not surfaced cleanly in search; both quote
  "by usage." *Matters:* you can't run the Dispute-A flip-math without them. *Confirm:* read the Tigris
  pricing page + Supabase Storage pricing page directly at build time.
  Source: [[raw/ecosystem-01-storage-providers.md]] GAPS.
- **V-02 — Exact R2 Infrequent Access pricing + min-duration penalty.** R2 has Standard + IA, but the IA
  rate and any min-duration penalty weren't confirmed, and IA availability may be per-region. *Matters:*
  the "R2 is pricier for cold" claim (Dispute A) rests on this. *Confirm:* R2 pricing page + check IA
  class availability for your region before relying on it.
  Source: [[raw/ecosystem-01-storage-providers.md]] (R2 gotchas), [[raw/ecosystem-07-lifecycle-retention.md]] GAPS.
- **V-03 — All vendor cost figures (LeanOps/Usage.ai) are directional, not gospel.** "$23→$2,657",
  "14/9/5 within 90 days", "69% pricier", "R2 storage 2.5× Wasabi" all come from cost-consultancies with a
  commercial angle (directionally corroborated across 3+ vendors, but each has incentive to dramatize).
  *Confirm:* the **mechanism** is safe to assert; verify any **specific number** against the official
  pricing page. Source: [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] Open;
  [[raw/field-03-migration-war-stories.md]] Open.

### SDK & protocol behavior
- **V-04 — Is the boto3 `generate_presigned_post()` `content-length-range` bug (#2261) fixed in latest
  2026 botocore?** *Matters:* if not, your edge size-limit silently fails (Dispute F). *Confirm:* write a
  test that POSTs an oversize file and assert S3 rejects it, on your pinned botocore version.
  Source: [[raw/ecosystem-03-presigned-access-control-validation.md]] GAPS; [[raw/ecosystem-08-real-breakage-github-issues.md]].
- **V-05 — Current set of SDK-auto-signed internal headers, per SDK.** The `amz-sdk-request` drift was
  documented on AWS SDK Go v2 at the time of one postmortem; JS v3 / boto3 inject *different* headers
  (`amz-sdk-invocation-id`, content checksums). The **principle** (SDK signs headers the browser can't
  send) is robust; the **exact header names** are SDK/version-specific and not re-verified for June 2026.
  *Confirm:* log the actual `SignedHeaders` your SDK produces and diff against what the browser sends.
  Source: [[raw/field-04-presigned-urls-large-files-timeouts.md]] Open.
- **V-06 — Do R2 / B2 / Tigris support S3 conditional writes (`If-None-Match: *`)?** Conditional writes
  GA'd on S3 in 2024 (atomic "create if not exists" without a lock — useful for dedupe-by-key). **Not all
  S3-clones implement conditional headers.** *Matters:* if you rely on it for dedupe and the provider
  ignores it, you get silent overwrites. *Confirm:* test `If-None-Match: *` against the specific provider.
  Source: [[raw/ecosystem-01-storage-providers.md]] (S3 conditional writes; GAPS).
- **V-07 — R2's current list-after-write consistency guarantee.** R2 is strongly-consistent for
  read-after-write of a single object, but **list-after-write may lag**, and the docs language has shifted
  over time. *Matters:* a pipeline that lists a bucket right after writing may miss just-written objects.
  *Confirm:* read the current CF R2 consistency docs at build time; don't assume immediate list visibility.
  Source: [[raw/ecosystem-01-storage-providers.md]] GAPS, (R2 honest gotchas).

### Platform limits (AWS raises these periodically)
- **V-08 — Current API Gateway integration timeout & Lambda payload limits.** The "29s API Gateway / 6MB
  Lambda / 10MB payload" figures are from a 2020 post; AWS **raised the API Gateway REST integration
  timeout to be configurable >29s in 2024**. *Matters:* the *conclusion* (never proxy file bytes through a
  function — go direct-to-storage) is unchanged and correct regardless; but don't quote "29s" as a current
  hard limit. *Confirm:* current AWS service quotas. Source: [[raw/field-04-presigned-urls-large-files-timeouts.md]] Open.
- **V-09 — CloudFront propagation time (10–60s) and the 15-invalidation-paths-in-progress cap.** Widely
  cited and historically accurate, but AWS occasionally raises these. *Matters:* the *strategy* (change
  the URL, don't purge) is robust regardless; but verify the exact cap before building a purge fallback.
  *Confirm:* current CloudFront quotas. Source: [[raw/field-05-cdn-cache-invalidation.md]] Open.

### Tooling currency
- **V-10 — rclone latest patch / whether v1.71 shipped.** v1.70.x was current (patches through v1.70.3) at
  research time. *Confirm:* `rclone version` / rclone changelog at build time.
  Source: [[raw/ecosystem-09-agent-operation-clis-mcp.md]] GAPS.
- **V-11 — tus-js-client staleness.** Last release v4.3.1 was **2025-01-16** (~17 months before research) —
  mature but slow cadence; no 2026 release confirmed. *Matters:* if you adopt it, pin and watch for
  unpatched issues. *Confirm:* check the repo's latest release + open-issue activity.
  Source: [[raw/ecosystem-05-multipart-resumable-tus.md]] Open.
- **V-12 — Does the Cloudflare R2 MCP expose presigned-URL *generation* as a tool (vs only CRUD)?** The
  `r2_*` tools cover bucket/object CRUD; whether an agent can *mint a presigned URL to hand to a user* via
  the MCP is **unconfirmed**. *Matters:* agents frequently need to give a user a URL, not stream bytes
  through MCP. *Confirm:* inspect the MCP's tool list, or fall back to `wrangler` / AWS SDK for presign.
  Source: [[raw/ecosystem-09-agent-operation-clis-mcp.md]] GAPS.
- **V-13 — imgproxy v4 free-tier vs pro split for the internal cache + IETF resumable-upload draft
  status.** imgproxy v4's internal cache is marked **pro** (verify the free-tier split before relying on
  it); and the resumable-upload spec was still `draft-ietf-httpbis-resumable-upload` (a **draft, not an
  RFC**) at last check. *Confirm:* imgproxy docs for the cache tier; IETF datatracker for the draft status.
  Source: [[raw/ecosystem-06-image-optimization-cdn.md]] GAPS; [[raw/ecosystem-05-multipart-resumable-tus.md]] GAPS.

---

## Part 3 — NO-GOOD-SOURCE GAPS (shelf must form its own view via experiment)

> These are the questions where the research returned **no trustworthy answer** — not "the number is
> stale" but "nobody has published a credible answer." For each, the honest move is to say *"no good
> source exists"* and, where it matters to a decision, **run the experiment** and write the result back as
> a future brain entry. Each gap below ships with a concrete experiment design so the hole is fillable, not
> permanent. (This is open-endedness applied: the interesting answers are the ones nobody published.)

### G-01 — There is no maintained, high-star, general-purpose S3-object-CRUD MCP server
- **The gap.** The Cloudflare MCP is great *for R2*. But for plain S3 / any-S3-compatible object PUT/GET,
  there is **no first-party AWS MCP** (the AWS `s3-tables-mcp-server` is Iceberg-only) and the generic
  space is an **unvetted long tail of low/zero-star one-offs** (`diabloneo/s3-mcp` is the best candidate
  but unvetted). No community winner has consolidated.
- **shelf's stance.** This is **a gap shelf could fill** — own a thin, well-tested, S3-compatible MCP
  (works against R2/B2/Tigris/MinIO via `--endpoint-url`) that also mints presigned URLs (closing V-12).
- **Experiment to settle it.** Vet `diabloneo/s3-mcp` against R2 + MinIO in a sandbox (does CRUD work? does
  it do presign? is auth scoped?). If it fails the bar, scaffold a minimal MCP (CRUD + presign + scoped
  token) — this becomes a shelf-owned tool and a [[TOOL-MATRIX]] entry.
- **Source.** [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (AWS + generic MCP; GAPS).

### G-02 — Virus scanning has no dominant managed primitive off-AWS (and the canonical OSS repo is dead)
- **The gap.** On AWS, GuardDuty Malware Protection for S3 is a clean default. **Off AWS (R2/B2/Tigris),
  there is NO equivalent managed "scan my bucket" primitive** — the once-canonical
  `bucket-antivirus-function` is **ARCHIVED** (2024-04), and the active repos are dozens of low/zero-star
  personal projects. No R2-native scanning was found (likely DIY: Workers + an external scan API on R2
  ObjectCreated).
- **shelf's stance.** Off-AWS AV is **a pattern you own, not a tool you install** ([[OPINIONS]] O-19). Do
  not present it as solved.
- **Experiment to settle it.** Stand up the `opg-s3-antivirus` ClamAV pattern (or `clara` for ClamAV+YARA)
  against an R2 bucket via a Worker-triggered scan, with a separate `freshclam` definitions updater; OR
  prototype "R2 ObjectCreated → Worker → Cloudmersive/bucketAV scan API → tag." Measure cold-start +
  scan latency + cost. Write the winning recipe back as a shelf skill.
- **Source.** [[raw/ecosystem-04-virus-scanning.md]] (state of the art; GAPS).

### G-03 — `@uppy/aws-s3` multipart against R2/Tigris/B2 has unverified S3-compat edge cases
- **The gap.** S3-compat is *usually* fine for multipart, but **CORS + multipart-complete edge cases vary
  per provider** and weren't tested. There is no published "Uppy multipart works cleanly on R2/Tigris/B2"
  confirmation; meanwhile real Uppy issues show Safari breakage (#6292), no-resume-after-sleep (#3783),
  and retry-re-uploads-everything (#5762).
- **shelf's stance.** "S3-compatible" is a **data-plane promise, not a multipart-edge-case promise."
  ([[OPINIONS]] O-22, [[KNOWN-PITFALLS]] P-37). Test per provider, on Safari/iOS specifically.
- **Experiment to settle it.** Run `@uppy/aws-s3` multipart end-to-end (create → part PUTs → complete)
  against R2, B2, and Tigris, on Chrome AND Safari/iOS, with explicit CORS set. Record which providers
  need quirks. This becomes a [[TOOL-MATRIX]] compatibility note.
- **Source.** [[raw/ecosystem-02-uploadthing-and-upload-libs.md]] GAPS; [[raw/ecosystem-08-real-breakage-github-issues.md]] (Uppy).

### G-04 — UploadThing's self-host story is unconfirmed (treat as managed-only)
- **The gap.** Search surfaced **no clean self-host guide** for UploadThing's full stack. It's the "DX
  layer over storage," but whether you can run it without their hosted control plane is **unknown**.
- **shelf's stance.** Treat UploadThing as **managed-only** until proven otherwise; if self-host matters,
  Uppy + Companion (open) is the portable alternative.
- **Experiment to settle it.** Attempt a UploadThing self-host from the monorepo; if it requires their
  hosted plane, document that as a hard constraint. (Low priority — Uppy already covers the open path.)
- **Source.** [[raw/ecosystem-02-uploadthing-and-upload-libs.md]] GAPS.

### G-05 — Tigris lifecycle + Object Lock support is unconfirmed
- **The gap.** Tigris's versioning story is **snapshots/forks** (copy-on-write buckets); whether it
  supports S3-style **lifecycle rules** (abort-incomplete-multipart, expiration, tiering) and **Object
  Lock/WORM** was **not confirmed**. Its durability SLA also wasn't surfaced.
- **shelf's stance.** Don't promise lifecycle hygiene rules ([[OPINIONS]] O-17) or WORM on Tigris without
  verifying; its forks/snapshots are a *different* model than lifecycle/lock.
- **Experiment to settle it.** Against a Tigris bucket: attempt to set an abort-incomplete-multipart
  lifecycle rule and an Object Lock; record support/absence. Read its durability SLA before any prod bet.
- **Source.** [[raw/ecosystem-01-storage-providers.md]] (Tigris); [[raw/ecosystem-07-lifecycle-retention.md]] GAPS.

### G-06 — Cloudflare's exact signed-URL mechanism for private R2 objects is unconfirmed
- **The gap.** It's **not** an S3-query-string signature like AWS — it's Workers/Access-based (Workers /
  Images / Stream), but the **exact current mechanism** for serving a *private R2 object* with edge
  caching intact wasn't pinned down.
- **shelf's stance.** Don't assume "R2 presigned GET = CloudFront-style signed URL." For private-but-
  high-traffic R2 content, the path is likely a Worker that checks auth → serves/redirects ([[EXPERTISE-MAP]]
  JTBD-5.3, [[OPINIONS]] O-15).
- **Experiment to settle it.** Prototype private-R2-object delivery two ways (presigned GET vs a Worker
  gate) and measure cache-hit behavior + revocability; document the winner.
- **Source.** [[raw/ecosystem-03-presigned-access-control-validation.md]] GAPS.

### G-07 — No named-company engineering-blog migration postmortem within the currency window
- **The gap.** The migration intel ("14/9/5 within 90 days") is from a **cost-consultancy (LeanOps)**, not
  a first-party company eng-blog; the direction is corroborated by independent syntheses but the precise
  figures are one-source. The only verified *named-org* primary is **NixOS** (2023, egress, not a
  provider-switch postmortem).
- **shelf's stance.** When citing migration economics, lead with the **mechanism** (events/lifecycle/
  compliance drag workloads back) and **NixOS** (verified) for a number; flag the 14/9/5 as one-source.
- **Experiment to settle it.** shelf's own first real S3↔R2 migration *is* the missing postmortem — measure
  it (per-workload savings, what broke, exit-egress paid) and write it back as the canonical primary.
- **Source.** [[raw/field-03-migration-war-stories.md]] Open; [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3b.

### G-08 — No fresh canonical first-person CDN-invalidation-disaster postmortem; and no high-star current R2-direct presigned starter
- **The gap (two thin spots).** (a) CDN cache-invalidation material in-window is *guide/best-practice*
  content; **no single dramatic dated "the day our `/*` invalidation took down origin" first-person
  writeup** surfaced (mechanisms are confirmed by AWS docs/re:Post, the war story isn't). (b) **No
  single high-star, current, R2-direct (not UploadThing) presigned-upload Next.js starter exists** — the
  freshest minimal ones are stale (`rajeshdavidbabu/s3-upload-thing` 2024-10, `ryanto/next-s3-upload`
  2024-12) or low-star.
- **shelf's stance.** Both are **gaps shelf could fill by shipping**: (a) if shelf ever causes/observes a
  real invalidation stampede, document it; (b) **publish the missing R2-direct presigned Next.js starter**
  (CORS-correct, POST-policy size-bounded, random-key, separate-domain serve) — the [[OPINIONS]] O-26 /
  [[TOOL-MATRIX]] "starters" gap.
- **Source.** [[raw/field-05-cdn-cache-invalidation.md]] Open; [[raw/ecosystem-10-starter-template-repos.md]] GAPS.

---

## Part 4 — KNOWN COVERAGE HOLE: the X/Twitter social-velocity signal was NOT gathered

- **What's missing.** One research channel — **X/Twitter** — was skipped. The field researcher attempted
  it via `energy/scripts/x-content-intel/scrape.py` with `~/.claude/x-auth/x-session.json`: **auth loaded
  but the GraphQL search endpoint returned HTTP 404** (session dated 2026-04-07, ~10 weeks stale; X
  rotates GraphQL query IDs frequently). The brain therefore rests on **HN, GitHub issues + GHSA
  advisories, AWS re:Post, and engineering blogs** — strong, dated, first-person practitioner signal — but
  **lacks "which providers are practitioners migrating to/from *this week*"** social-velocity data.
- **Why it matters.** Storage provider sentiment moves fast (the R2-vs-S3 and DX-SDK-backlash narratives
  are *social* trends as much as technical ones). A fresh-auth X pass could add leading-indicator signal
  the static sources lag on.
- **Fix.** A future run with **re-authed X** (`/x-feed-curate` or fresh `x-session.json`) should sweep
  storage/upload/CDN discourse and feed it back into [[OPINIONS]] (sentiment shifts) and
  [[BATTLE-TESTED-SCENARIOS]] (new failure modes surfacing in the wild).
- **Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §6 (X skipped — documented).

---

## How shelf should read this file (the operating rule, restated)

| If the fact is… | …then shelf should… |
|---|---|
| a **Dispute (A–G)** | give the **synthesis + the condition that flips the default**, never a tribe ([[OPINIONS]] O-27) |
| an **unconfirmed V-entry** | assert the **mechanism**, label the **number** "as of June 2026, verify," and run the stated check before prod ([[OPINIONS]] O-28) |
| a **no-good-source G-entry** | say **"no good source — here's the experiment that would settle it,"** don't fabricate confidence; run the experiment and write the result back |
| the **X coverage hole** | note that social-velocity signal is missing; a fresh-auth X pass is the fix |

> The brain is honest when it knows its own edges. These are the edges. Everything outside this file, the
> other five brain documents assert with citations; everything inside it, shelf treats as contested,
> drifting, or unknown — and acts accordingly.
