---
title: "shelf Battle-Tested Scenarios — real failure/migration/production drills"
type: synthesis
created: 2026-06-16
tags: [shelf, brain, scenarios, eval, failure-modes]
sources:
  - "raw/field-01-egress-cost-blowups-and-r2-economics.md"
  - "raw/field-02-upload-security-rce-xss-ssrf.md"
  - "raw/field-03-migration-war-stories.md"
  - "raw/field-04-presigned-urls-large-files-timeouts.md"
  - "raw/field-05-cdn-cache-invalidation.md"
  - "raw/ecosystem-03-presigned-access-control-validation.md"
  - "raw/ecosystem-04-virus-scanning.md"
  - "raw/ecosystem-05-multipart-resumable-tus.md"
  - "raw/ecosystem-08-real-breakage-github-issues.md"
summary: "≥10 concrete, sourced production scenarios with the exact resolution. These are the seed corpus for Wave-S golden eval tasks."
---

# shelf Battle-Tested Scenarios

> Each scenario is a **real, dated, sourced** failure/migration/production situation, written as an eval
> task: **Trigger** (what the user/system reports), **What's actually happening** (root cause),
> **Resolution** (the verifiable fix), **Eval check** (how Wave-S grades a correct answer), **Source**.
> A storage employee that can resolve all of these is dangerous. Stances behind them: [[OPINIONS.md]].
> Version-specific traps: [[KNOWN-PITFALLS.md]].

---

## SCENARIO 1 — "Our AWS bill jumped from $23 to $2,657 overnight"

- **Trigger.** A single file (e.g. 13.7 GB) went viral; every download worldwide billed at S3
  `$0.09/GB`. Cost is unbounded and demand-driven.
- **Root cause.** Hot public object served **straight from S3 origin** — every view is metered egress.
  Storage was cents; egress was the four-figure surprise.
- **Resolution.** (1) Put a CDN (or R2) in front of every hot public object so origin egress → cache.
  (2) For sustained high-download workloads, move the hot/public bucket to **R2** (zero egress). (3)
  Alert on **egress volume**, not GB stored. (4) Cap/auth downloads of very large public files if the
  business allows.
- **Eval check.** Answer must (a) name egress (not storage) as the cause, (b) prescribe CDN-in-front
  and/or R2 for hot/public, (c) move the alert to egress. Reject "reduce storage" or "compress the file"
  as the primary fix.
- **Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §1, §6 (figure is vendor-sourced;
  the *mechanism* is undisputed — see [[GAPS-AND-DISPUTES.md]] Dispute D).

## SCENARIO 2 — "We're a volunteer OSS project paying $9,000/mo to S3 and can't afford it"

- **Trigger.** Named-org reality (NixOS Foundation): ~450 TB stored + ~29.5 TB egress/mo (~3 TB/day
  served to users) ≈ **$9,000/mo**; ~**$32,000** one-time cost just to migrate the data out.
- **Root cause.** Egress-dominated workload (public downloads / mirrors) on S3 = structurally wrong;
  S3 egress is "expensive to enter, expensive to exit" (lock-in).
- **Resolution.** Move to **R2** (zero egress) or **B2 + Cloudflare** (Bandwidth Alliance, unlimited
  free egress) for the download-serving buckets; front everything with a CDN. **Budget the one-time exit
  egress** (`$0.09/GB × stored`) into the migration plan — it's real money, not a rounding error.
- **Eval check.** Must (a) recognize high-download-volume + S3 as the canonical R2/B2-or-CDN case, (b)
  explicitly budget the one-time exit egress, (c) not promise the migration is free.
- **Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3b (verified named-org primary).

## SCENARIO 3 — "We moved everything to R2 for zero egress; now our event pipeline is broken and 5 workloads are more expensive"

- **Trigger.** After a blanket S3→R2 migration: Lambda triggers on object upload stopped firing; a
  data-lake bucket's bill went *up* ~69%; a compliance customer can't be served.
- **Root cause.** R2 has **no S3 event notifications**, **one storage tier** (no Glacier/IA
  transition), **thinner compliance** (no FedRAMP/GovCloud/HIPAA BAA), and **no consistent cross-region
  replication**. "Zero egress means nothing if your architecture depends on S3 event notifications."
- **Resolution.** Migration is **per-workload, not per-company**. Audit each bucket's *access pattern +
  dependency graph* first. Move **hot/public download-many** to R2 (9/14 saved 40–70%). Keep on S3:
  **event-driven** (upload→Lambda), **cold/data-lake-with-tiering**, **compliance** (HIPAA/FedRAMP/Gov),
  **multi-region active-active**. For the broken events: rebuild via polling/webhooks (~$30–80/mo + added
  latency) only if the workload genuinely belongs on R2; otherwise revert that bucket to S3. Architect
  behind a thin `Storage` interface so re-pointing is config, not rewrite.
- **Eval check.** Must (a) call out per-workload (reject "everything to R2"), (b) name the 4 drag-back
  reasons (events, tiering, compliance, multi-region), (c) keep event-driven/cold/compliance on S3.
- **Source.** [[raw/field-03-migration-war-stories.md]] §1, §3, §5; [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §3.

## SCENARIO 4 — "Stored XSS: an attacker uploaded a 'PNG' that runs JavaScript on our domain"

- **Trigger.** An authenticated low-privilege user uploads a file; later other users' sessions get
  hijacked / accounts taken over. (Exemplar: Postiz CVE-2026-40487, CVSS 8.9, fixed 2.21.6.)
- **Root cause.** The upload layer trusted the client-supplied `Content-Type` header (spoofed to pass
  validation), and the serving layer (nginx) **re-derived** Content-Type from the file extension
  (`.html` → `text/html`, `.svg` → `image/svg+xml`) → browser executed embedded scripts in the app's
  origin. **Both ends** were exploitable.
- **Resolution.** (1) Validate by **magic bytes + extension allowlist**, never by header. (2) On the
  serve side, force a safe `Content-Type`, `Content-Disposition: attachment`, `X-Content-Type-Options:
  nosniff`. (3) Serve user uploads from a **separate cookieless domain** with a strict CSP. (4) Generate
  random server-side keys (never echo user filename/extension into the served path).
- **Eval check.** Must fix **both** write-side (magic-byte validate) AND read-side (forced
  Content-Type + attachment + nosniff). An answer that only validates on upload is **incorrect** —
  the bug is two-sided.
- **Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §1, §7, §8.

## SCENARIO 5 — "Someone uploaded an SVG and now our server is making requests to 169.254.169.254"

- **Trigger.** SSRF: the server, while processing/rendering an uploaded SVG (e.g. for thumbnailing),
  makes outbound HTTP requests to attacker-chosen internal IPs / cloud metadata. (Exemplar: Kuno CMS
  CVE-2025-61768; sibling XSS CVE-2025-61681.)
- **Root cause.** SVG is an **XML document, not an image**. `<image xlink:href="http://...">` (and
  external entity refs) make the SVG processor fetch arbitrary URLs server-side. The same file can also
  XSS the browser via event handlers.
- **Resolution.** **Refuse SVG from untrusted users.** If you must accept it: rasterize to PNG in a
  **sandbox** and discard the original; strip/deny external references; never server-side-render raw
  user SVG; serve only from a sandboxed cookieless domain with CSP. Block the cloud metadata endpoint at
  the network layer regardless.
- **Eval check.** Must treat SVG as a document (not "just sanitize it lightly"); preferred answer is
  refuse-or-rasterize-in-sandbox. Reject "allow SVG, it's an image format."
- **Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §2, §3.

## SCENARIO 6 — "I set a 1 MB limit on my presigned upload URL but someone uploaded a 5 GB file"

- **Trigger.** A presigned **PUT** URL with `Content-Length` signed as a header still accepted a
  multi-GB upload; the "limit" did nothing.
- **Root cause.** S3 does **not** enforce `Content-Length` server-side for presigned PUT. You cannot
  reliably bound size or type with PUT.
- **Resolution.** Use **presigned POST (policy)** with `["content-length-range", min, max]` and
  `["starts-with", "$Content-Type", "image/"]` — S3 enforces these and rejects violations. **Verify it
  actually rejects** oversize in a test per SDK version (boto3 #2261 silently ignored the condition in
  some versions). Always **re-validate size server-side via HEAD** after upload regardless.
- **Eval check.** Must (a) explain PUT can't enforce size, (b) switch to POST policy with
  content-length-range, (c) add server-side HEAD re-validation, (d) ideally flag the boto3 bug to verify
  in test.
- **Source.** [[raw/ecosystem-03-presigned-access-control-validation.md]] (load-bearing gotcha);
  [[raw/ecosystem-08-real-breakage-github-issues.md]] (boto3 #2261).

## SCENARIO 7 — "Our S3 direct uploads suddenly 403 with SignatureDoesNotMatch; we think it's a CORS bug"

- **Trigger.** Browser → S3 direct uploads fail with `403 SignatureDoesNotMatch`; the failing request
  is the `OPTIONS` preflight, so engineers chase CORS. (First-person prod postmortem, Saket Agrawal.)
- **Root cause.** The AWS SDK (Go v2) auto-injected an internal header (`amz-sdk-request`) into the
  **signed** header set; the browser never sends that header → actual header set ≠ signed header set →
  S3 rejects. The signature failure happened **before** CORS headers were added, masquerading as CORS.
- **Resolution.** Backend returns the URL **and the exact list of signed headers**; the frontend sends
  **only those** — no more, no less. Or, for browser uploads, prefer **presigned POST policy** (signs
  form fields/conditions, not arbitrary headers) so SDK-injected headers can't drift. Debug
  `SignatureDoesNotMatch` by **diffing the canonical request**, not by rotating credentials.
- **Eval check.** Must (a) identify it as signature drift, not CORS, (b) prescribe returning the signed
  header set or switching to POST policy. Reject "fix the CORS config" as the primary answer.
- **Source.** [[raw/field-04-presigned-urls-large-files-timeouts.md]] §1.

## SCENARIO 8 — "Our presigned URLs say 24h but die after ~1 hour"

- **Trigger.** URLs generated in a Lambda with a 24-hour expiry stop working after ~1 hour.
- **Root cause.** Signing with **temporary credentials** (Lambda execution role / assumed role) caps
  effective expiry at `min(your-expiry, remaining-STS-session)` — default STS session ≈ 1 hour. SigV4
  also has a hard **7-day** ceiling.
- **Resolution.** To get long-lived URLs, sign with **long-term IAM user credentials** (accepting the
  key-management risk) or, better, **re-issue short-TTL URLs on demand** (gate at your app/edge → 302 to
  a fresh short URL). Don't assume "it expires when I said" with temp creds.
- **Eval check.** Must explain effective-expiry = min(set, STS-session); prescribe on-demand re-issue
  or long-term creds; know the 7-day cap. Reject "just set a longer expiry."
- **Source.** [[raw/field-04-presigned-urls-large-files-timeouts.md]] §2.

## SCENARIO 9 — "Uploads work on Chrome but every part silently fails on Safari/iOS"

- **Trigger.** `@uppy/aws-s3` multipart: each part PUT to S3 fails on Safari with "Unknown error", no
  HTTP response; works fine on Chrome. (Uppy #6292.)
- **Root cause.** Browser-specific multipart breakage — Safari's CORS-preflight + fetch quirks routinely
  break multipart that works on Chrome; the error is swallowed (no surfaced HTTP response).
- **Resolution.** (1) **Always test multipart on Safari/iOS** (the worst browser), not just Chrome. (2)
  Verify the **CORS policy** covers preflight for every multipart method/header (R2 especially has no
  default CORS — set it explicitly). (3) Add explicit error surfacing on part failures. (4) Pin to a
  current uploader version.
- **Eval check.** Must (a) prescribe testing on Safari/iOS, (b) check CORS preflight, (c) not assume
  "works on Chrome = works everywhere."
- **Source.** [[raw/ecosystem-08-real-breakage-github-issues.md]] (Uppy #6292),
  [[raw/field-02-upload-security-rce-xss-ssrf.md]] cross-ref.

## SCENARIO 10 — "A large upload never completes when the user's laptop goes to sleep; retry re-uploads everything"

- **Trigger.** S3 multipart upload of a big file never finishes after the computer sleeps (Uppy #3783);
  on retry, already-uploaded parts are re-uploaded (Uppy #5762).
- **Root cause.** Raw S3 multipart is **not inherently resumable** across sleep/network-drop unless you
  persist `UploadId` + part ETags and reuse them. "Resumable" is a spectrum; the multipart label alone
  doesn't guarantee resume.
- **Resolution.** For uploads that must survive interruption (mobile, big video, flaky links), use
  **tus** (tusd `s3store` backend = tus on the wire, S3 multipart at rest). tus is the only path that
  reliably resumes after sleep/network-drop. If staying on raw multipart, persist UploadId + ETags
  client-side and verify part-reuse-on-retry. Pin **tusd v2.10.0+** and **disable the concatenation
  extension** (non-idempotent → duplicate data on retry).
- **Eval check.** Must (a) explain multipart ≠ resumable-by-default, (b) reach for tus for
  resume-after-sleep, (c) verify part reuse. Reject "just retry the multipart upload."
- **Source.** [[raw/ecosystem-08-real-breakage-github-issues.md]] (Uppy #3783, #5762; tusd #1364);
  [[raw/ecosystem-05-multipart-resumable-tus.md]].

## SCENARIO 11 — "Mystery storage bill: we're paying for data we can't see in the bucket listing"

- **Trigger.** Storage cost is higher than the visible object total; `ListObjects` doesn't account for
  it.
- **Root cause.** **Orphaned multipart uploads** — started but never completed/aborted; the parts
  persist, bill as storage, and are **invisible** to normal listing. The #1 mystery S3/R2 bill.
- **Resolution.** (1) Find them: `rclone backend list-multipart-uploads <remote>:` (or
  `ListMultipartUploads`) + `AbortMultipartUpload`. (2) **Prevent recurrence:** set a lifecycle rule to
  **abort incomplete multipart uploads after N days** on *every* upload bucket (S3 and R2 both support
  it). (3) (Versioned buckets) also expire noncurrent versions + clean delete-markers.
- **Eval check.** Must (a) name orphaned multiparts as the invisible cost, (b) prescribe the
  abort-incomplete-multipart lifecycle rule, (c) ideally name the discovery command.
- **Source.** [[raw/ecosystem-05-multipart-resumable-tus.md]] (orphaned multiparts);
  [[raw/field-04-presigned-urls-large-files-timeouts.md]] §5; [[raw/ecosystem-09-agent-operation-clis-mcp.md]].

## SCENARIO 12 — "We deployed but users still see the old asset / changed an S3 file and the CDN ignores it"

- **Trigger.** After a deploy, some users get stale files; or someone edited an object in S3 and
  CloudFront keeps serving the cached version.
- **Root cause.** CloudFront **won't notice** an S3 object changed (TTL or explicit invalidation only);
  purge propagation is **10–60 s** (not atomic); wildcard `/*` purge risks **origin stampede**; max
  **15 invalidation paths in progress**.
- **Resolution.** **Don't invalidate — change the URL.** Two-tier cache policy: content-hashed
  immutable assets (`app.a3f9d2c.js`, `Cache-Control: max-age=31536000, immutable`) + the pointer
  (HTML/API) with `no-cache`/short TTL. New content = new URL → no propagation delay, no 15-cap, no
  stampede. For **user uploads that change**, use **immutable keys + DB pointer** (a new upload = a new
  key), never overwrite-in-place. Purge is for **emergencies** (pulling leaked/illegal content) via
  Cache Tags / surrogate keys, never `/*` for normal deploys.
- **Eval check.** Must (a) prescribe content-hashed immutable URLs + no-cache pointer, (b) for user
  uploads prescribe immutable-key + DB-pointer, (c) know the purge limits (10–60s, 15-cap, stampede).
  Reject "just invalidate `/*` on every deploy."
- **Source.** [[raw/field-05-cdn-cache-invalidation.md]] §1–§5.

## SCENARIO 13 — "An upload with a non-ASCII filename ('Письмо.pdf') uploads then fails with 'No file found'"

- **Trigger.** Presigned upload with a key containing Cyrillic / em-dash / spaces / `+` / `#` shows
  "Uploading" then fails ("No file found for presigned URL"). (UploadThing #153.)
- **Root cause.** The **URL-encoding of the key at sign-time must byte-for-byte match** the encoding at
  upload-time. One side encodes the special char, the other doesn't → signature mismatch / key-not-found.
- **Resolution.** **Never put user-supplied filenames into object keys.** Generate a random UUID key;
  store the original filename as metadata / in the DB; set `Content-Disposition: attachment;
  filename*=UTF-8''...` (RFC 5987) on download for the human-readable name. This kills the
  encoding-mismatch class **and** the path-traversal class **and** the overwrite-in-place
  cache-staleness class in one move.
- **Eval check.** Must prescribe random key + filename-in-metadata + RFC 5987 download header. Reject
  "URL-encode the filename more carefully" as the primary fix (it's brittle; the durable fix is random
  keys).
- **Source.** [[raw/field-04-presigned-urls-large-files-timeouts.md]] §6;
  [[raw/field-02-upload-security-rce-xss-ssrf.md]] §8.

## SCENARIO 14 — "Our virus scan finished after we already served the malware to other users"

- **Trigger.** A presigned direct-to-bucket upload returns 200, the app immediately serves the file,
  the async scan finishes minutes later and finds malware that's already been downloaded.
- **Root cause.** Scanning is **asynchronous** (cold start + DB load + scan = seconds–minutes). Treating
  upload-200 as ready-to-serve is the product-breaking bug.
- **Resolution.** Object is **`pending` and unservable** until `scan-status=clean`. Land uploads in an
  **incoming/quarantine** prefix served to nobody; S3 event → scanner → tag clean/infected; clean →
  promote / flip the tag the serving layer checks; infected → delete/lock + alert. Maintain a
  **separate scheduled definitions updater** (`freshclam`) or the scanner silently rots. On AWS prefer
  **GuardDuty Malware Protection for S3** (managed, defs every 15 min); off AWS use the
  **`opg-s3-antivirus`** ClamAV pattern.
- **Eval check.** Must (a) keep the object pending/unservable until clean, (b) describe the
  incoming→scan→clean/quarantine lifecycle, (c) include the definitions updater, (d) pick engine by
  platform. Reject "scan it and serve it right away."
- **Source.** [[raw/ecosystem-04-virus-scanning.md]] (dominant pattern, latency gotcha, engines).

## SCENARIO 15 — "A 40 KB ZIP a user uploaded OOM-killed our import worker"

- **Trigger.** A small uploaded archive (or a tiny-on-disk image) crashes the worker with OOM / fills
  the disk. (Zip bomb `42.zip` = 42 KB → 4.5 PB; pixel-flood 50,000×50,000 PNG ≈ tiny on disk.)
- **Root cause.** "Validate the file" was read as content-type/extension only; nobody validated
  **resource consumption** on decompression / decode.
- **Resolution.** Stream-decompress with a **hard byte ceiling** + **entry-count ceiling**; reject
  **compression ratio > N**; treat nested archives as hostile (recursive bombs); never extract to a
  RAM disk without a quota; cap **pixel dimensions** before handing an image to the decode/transform
  library; cap **processing time**. Run transforms in a sandbox.
- **Eval check.** Must validate resource consumption (decompressed size, ratio, pixel dims, time), not
  just type. Reject answers that only check content-type/extension.
- **Source.** [[raw/field-02-upload-security-rce-xss-ssrf.md]] §6.

## SCENARIO 16 — "A regulator demands certified WORM; we promised it on R2"

- **Trigger.** A compliance customer needs SEC 17a-4-grade immutable retention; the bucket is on R2 with
  "Bucket Locks."
- **Root cause.** R2 **Bucket Locks ≈ S3 governance mode** (admins can remove rules) — **not**
  compliance mode. R2 cannot do certified WORM (no compliance-mode immutability, no legal hold, lacks
  the regulatory certifications) as of June 2026. Also: **Object Lock can only be enabled at bucket
  creation** — it can't be retrofitted.
- **Resolution.** For certified WORM, use **S3 Object Lock compliance mode** or **B2 compliance mode** —
  the fleet's R2 default must yield. Create the bucket with Object Lock + versioning **from the start**
  (you can't add it later). Default to **governance mode** unless the regulator demands compliance mode
  (its irreversibility is a liability if mis-set). Don't promise certified WORM on R2.
- **Eval check.** Must (a) state R2 can't do certified WORM, (b) route to S3/B2 compliance mode, (c)
  note Object Lock is creation-time-only, (d) prefer governance unless compliance is demanded.
- **Source.** [[raw/ecosystem-07-lifecycle-retention.md]] §"Object Lock", §"shelf taste on WORM".

## SCENARIO 17 — "Our old `putObject({ACL:'public-read'})` code now 400s with AccessControlListNotSupported"

- **Trigger.** Code copied from a pre-2023 tutorial fails on a new bucket with a 400 /
  `AccessControlListNotSupported`; or a bucket that "should be public" isn't.
- **Root cause.** 2026 platform-default shifts: S3 **ACLs are DISABLED by default**
  (BucketOwnerEnforced) — setting an object ACL throws; and **Block Public Access is ON by default** for
  new buckets.
- **Resolution.** Stop using object ACLs — access is **policy-based** now. For public read: a **bucket
  policy** (after deliberately disabling BPA) or, better, a **CDN in front**. When debugging "why isn't
  this public," check whether someone *turned off* BPA (audit for changes to BPA), and remove the
  `ACL:'public-read'` call. Prefer serving via CDN over making the bucket public at all.
- **Eval check.** Must (a) know ACLs are disabled by default + BPA on by default, (b) switch to bucket
  policy / CDN, (c) reframe the audit as "was BPA disabled?" Reject "add `ACL:'public-read'`."
- **Source.** [[raw/field-06-2026-shifts-taste-disputes-synthesis.md]] §1a, §1b.

## SCENARIO 18 — "Migrating S3→R2, the bulk-copy tool errors with 'Invalid upstream credentials'"

- **Trigger.** Configuring R2 Super Slurper (or `rclone`) for an S3→R2 bulk copy fails with auth/upstream
  credential errors.
- **Root cause.** Migration-tooling auth is a common stumbling point: wrong source creds/region, or R2
  expecting `region:"auto"` + the account-specific endpoint, or the source bucket policy not allowing
  the migration principal to read.
- **Resolution.** For S3→R2: use **R2 Super Slurper** (GA) or **`rclone sync`** with correct
  per-remote config (`region:"auto"` + R2 endpoint for the R2 remote; valid read creds for the S3
  remote). **Budget the one-time exit egress** (Super Slurper reads from S3 → you pay S3 egress once for
  the full dataset, `$0.09/GB`). For zero-downtime migration *to Tigris*, use **shadow buckets**
  (keep both in sync, cut over by config). "S3-compatible" ports the **data plane** only — re-build
  event notifications / lifecycle tiering on the target separately.
- **Eval check.** Must (a) name the right tool (Super Slurper / rclone / Tigris shadow buckets), (b)
  budget exit egress, (c) flag that control-plane features don't port. Reject "it's S3-compatible so
  just swap the endpoint" without the control-plane caveat.
- **Source.** [[raw/field-03-migration-war-stories.md]] §2, §3; [[raw/ecosystem-09-agent-operation-clis-mcp.md]].

## SCENARIO 19 — "A DX upload SDK (Vercel Blob / UploadThing) is now our biggest bill at scale"

- **Trigger.** A product that shipped fast on Vercel Blob / UploadThing now has a runaway storage bill
  as traffic grew; large (~200 MB) client uploads also intermittently 400 (UploadThing #1286), and the
  managed service's callbacks took down the app DB (#1244 "Transaction pool connection limit exceeded").
- **Root cause.** DX SDKs are **S3/R2 with a markup** (Vercel Blob storage `$0.023/GB` + egress
  `$0.05/GB` vs R2 `$0.015/GB` + `$0.00`). The egress markup **compounds exactly when you succeed**.
  Managed ≠ worry-free: large-file reliability + your-DB-load are still your problems.
- **Resolution.** DX SDKs are correct for **prototypes / transient / build artifacts / low scale**
  (and Vercel Blob's 15-min sampling billing wins for short-lived data). For **read-heavy production
  media**, migrate to **direct-to-R2/S3 presigned**. The crossover is when `egress volume × markup >
  eng time saved`. Make the metadata/state layer serverless-safe (Upstash/Supabase), not in-process.
- **Eval check.** Must (a) identify the egress markup compounding at scale, (b) keep SDKs for
  transient/prototype, (c) migrate read-heavy production to direct presigned. Reject "stay on the SDK,
  it's convenient" for read-heavy scale.
- **Source.** [[raw/field-03-migration-war-stories.md]] §4, §5; [[raw/ecosystem-08-real-breakage-github-issues.md]] (UploadThing #1286, #1244).

## SCENARIO 20 — "Our in-VPC Lambda reads from S3 'for free' but the bill shows NAT data-processing charges"

- **Trigger.** A private-subnet Lambda/EC2 reads S3 in-region (supposedly free), yet the bill has large
  NAT Gateway data-processing charges.
- **Root cause.** S3 traffic from a private subnet routed through a **NAT Gateway** is billed at NAT
  data-processing rates (~$0.045/GB) **on top of** being "free" in-region S3. A top-5 silent S3 bill
  inflator. (Inter-AZ chatter is the same class of forgotten egress.)
- **Resolution.** Use an **S3 Gateway VPC Endpoint** ($0) for in-VPC S3 access — eliminates the NAT
  data-processing surprise. Collapse cross-AZ chatter; route S3 via the gateway endpoint, not the NAT.
- **Eval check.** Must (a) identify NAT data-processing as the cause, (b) prescribe an S3 Gateway VPC
  Endpoint. Reject "S3 in-region is free, the bill must be wrong."
- **Source.** [[raw/field-01-egress-cost-blowups-and-r2-economics.md]] §4.

---

> **Wave-S note.** Scenarios 1–14 are the core golden set (one per major failure axis: egress, events,
> XSS, SSRF, presigned-size, signature-drift, expiry, Safari, resume, orphaned-multipart, cache-stale,
> filename-encoding, async-scan). 15–20 extend coverage (DoS, WORM, ACL-shift, migration-auth, DX-SDK
> cost, NAT egress). Each "Eval check" is the grading rubric. Where a scenario rests on a vendor-sourced
> figure, the *resolution* is still gradeable on mechanism — see [[GAPS-AND-DISPUTES.md]].
