---
title: "shelf Tool Matrix — canonical tools, defaults vs alts, agent-access surface, required secrets"
type: synthesis
created: 2026-06-16
tags: [shelf, brain, tool-matrix, tools, secrets, mcp, cli]
sources:
  - "raw/ecosystem-00-internal-references.md"
  - "raw/ecosystem-01-storage-providers.md"
  - "raw/ecosystem-02-uploadthing-and-upload-libs.md"
  - "raw/ecosystem-03-presigned-access-control-validation.md"
  - "raw/ecosystem-04-virus-scanning.md"
  - "raw/ecosystem-05-multipart-resumable-tus.md"
  - "raw/ecosystem-06-image-optimization-cdn.md"
  - "raw/ecosystem-07-lifecycle-retention.md"
  - "raw/ecosystem-09-agent-operation-clis-mcp.md"
  - "raw/ecosystem-10-starter-template-repos.md"
  - "raw/field-03-migration-war-stories.md"
  - "raw/field-04-presigned-urls-large-files-timeouts.md"
related: ["[[EXPERTISE-MAP]]", "[[BATTLE-TESTED-SCENARIOS]]", "[[KNOWN-PITFALLS]]", "[[OPINIONS]]", "[[GAPS-AND-DISPUTES]]"]
summary: "The canonical tool roster for every storage job: default vs alternatives, when to pick which, the agent-access surface (CLI / API / MCP), and the exact env vars/secrets each needs — this section feeds the Wave-P Required-Secrets manifest."
---

# shelf Tool Matrix

> The other brain files say *what to do* and *why*; this file says *with which tool* and *with which
> secret*. Each section: **default → alternatives → when each wins → agent-access surface → required
> env/secrets**. The agent-access column matters because shelf is an **agent**, not a human at a dashboard
> (its hands are CLIs/SDKs/MCP — [[EXPERTISE-MAP]] JTBD-12, [[OPINIONS]] O-23/O-24/O-25).
>
> **Stars/versions are as of 2026-06-16** (the research date); treat them as drifting — see
> [[GAPS-AND-DISPUTES]] V-10/V-11 for currency caveats. Tool *choices* and *secrets* are the durable part.
>
> **§9 (Required-Secrets manifest) is the load-bearing output for Wave-P.** shelf's current `.env.example`
> has **none** of the storage backend keys yet — §9 enumerates what must be added.

---

## 1. Storage backend (the bytes live here)

| Tool | Role | When it's the pick |
|---|---|---|
| **Cloudflare R2** | **DEFAULT** (fleet default; `$0` egress; `$0.015/GB` storage; Class A `$4.50/M`, Class B `$0.36/M`) | Hot/public download-many; anything egress-heavy; the fleet default ([[OPINIONS]] O-05) |
| **AWS S3** | The portability contract + control plane | Event-driven (Lambda triggers), cold/tiered (Glacier/IA), certified compliance (HIPAA/FedRAMP/Gov), multi-region active-active ([[OPINIONS]] O-06) |
| **Tigris** | Global low-latency + data branching | On Fly.io; need global reads w/o a separate CDN; want bucket forks/snapshots; zero-downtime migration *to* it (shadow buckets) |
| **Backblaze B2** | Cost floor (`$6/TB`) | Cold/archival + Cloudflare Bandwidth Alliance (unlimited free egress); certified WORM (compliance mode) when not on S3 |
| **Supabase Storage** | Auth-coupled storage + transforms | Only if already all-in on Supabase (shelf inherits `SUPABASE_*` keys); S3-compatible + tus endpoint, but a wrapper |

- **The portability rule.** Every backend shelf recommends must speak the **S3 API** so the harness is
  never locked in ([[OPINIONS]] O-06). "S3-compatible" is a **data-plane** promise (GET/PUT/multipart/
  presign), **not** control-plane (events/lifecycle/IAM) — see [[KNOWN-PITFALLS]] P-37, [[GAPS-AND-DISPUTES]] Dispute A.
- **Agent-access surface.** R2 → Cloudflare MCP (`r2_*`) or `wrangler` (§7). S3 / any S3-compatible →
  `aws s3api --endpoint-url` or `rclone` (§7); **no first-party object-CRUD MCP** for plain S3
  ([[GAPS-AND-DISPUTES]] G-01).
- **Required secrets:** R2 → `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET`, `R2_ENDPOINT` (account-specific; **`region:"auto"`**). S3 → `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`. B2 → `B2_KEY_ID`, `B2_APPLICATION_KEY`,
  `B2_BUCKET` (or S3 creds + `--endpoint-url`). Tigris → `AWS_*`-shaped keys + `TIGRIS_ENDPOINT`.
  Supabase → already present (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). **None of R2/AWS/B2/Tigris
  are in shelf's `.env.example` today** ([[raw/ecosystem-00-internal-references.md]] §4) → see §9.
- **Source.** [[raw/ecosystem-01-storage-providers.md]] (whole file); [[raw/ecosystem-00-internal-references.md]].

---

## 2. Upload UI / client (the "don't hand-roll the client" tier)

| Tool | Stars · last push | Role | When it's the pick |
|---|---|---|---|
| **Uppy** (`@uppy/*`) | 30,826★ · 2026-06-16 | **DEFAULT** real upload UI | Want batteries-included (drag-drop, progress, retry, golden-retriever). `@uppy/aws-s3` = presigned S3 multipart (no tus server); `@uppy/tus` = resumable; `@uppy/companion` = remote sources + signing |
| **FilePond** | 16,372★ · 2026-06-04 | Pretty + light | Want polished UI + client-side image transform, **don't** need resume; lighter than Uppy |
| **react-dropzone** | 10,985★ · 2026-02-10 | Drag-drop primitive only | You wire the PUT yourself; minimal React primitive |
| **UploadThing** | 5,151★ · 2026-04-15 | Managed DX layer (over S3/R2) | Fastest path to a working upload UI; prototype/transient; accept lock-in + cost ([[OPINIONS]] O-07) |
| **compressorjs** | 5,913★ | Client-side image compression | Cut bytes at the source before upload; pairs with any uploader |
| **Dropzone.js** | 18,377★ · **2024-07 (stale)** | Classic | Know it exists; cadence stalled — prefer the above |

- **The architectural fork** ([[EXPERTISE-MAP]] JTBD-3.1, [[OPINIONS]] O-08): (a) **direct-to-bucket
  presigned** (default), (b) **through-your-server** (inline validation; stream w/ `formidable`/busboy,
  never buffer; doesn't scale), (c) **managed** (UploadThing / Uppy+Companion / Transloadit).
- **Verify per provider:** `@uppy/aws-s3` multipart against R2/Tigris/B2 has **unconfirmed** CORS +
  multipart-complete edge cases, and breaks on Safari/iOS (Uppy #6292) — test there
  ([[GAPS-AND-DISPUTES]] G-03, [[KNOWN-PITFALLS]] P-20). Use the **merged** `@uppy/aws-s3` plugin, not the
  deprecated split `aws-s3-multipart` ([[OPINIONS]] O-26).
- **Required secrets:** Uppy/FilePond/react-dropzone = **none** (client-side; they call *your* presign
  endpoint). UploadThing → `UPLOADTHING_TOKEN` (hosted control plane). REST API base is now
  `api.uploadthing.com` (v7; old base 302-redirects; `x-uploadthing-version` header no longer required).
- **Source.** [[raw/ecosystem-02-uploadthing-and-upload-libs.md]]; [[raw/ecosystem-10-starter-template-repos.md]].

---

## 3. Server-side upload handling & presigning (the SDK tier)

| Tool | Role | When it's the pick |
|---|---|---|
| **AWS SDK v3 (JS)** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | **DEFAULT** presign (PUT/POST) in Node | Generating presigned URLs/POST policies; works against R2/B2/Tigris with `endpoint` + `region:"auto"` |
| `@aws-sdk/lib-storage` `Upload` | Automatic multipart | "Just upload this big buffer" — **use this, never hand-roll multipart** ([[OPINIONS]] O-25) |
| **boto3** (Python) | Presign + auto-multipart | `generate_presigned_post` (⚠ verify the `content-length-range` bug, [[GAPS-AND-DISPUTES]] V-04); `upload_file` auto-multiparts |
| **formidable** (16,372★-class; 7,177★ · 2026-05-18) | Server-side multipart/form-data parser | Through-your-server uploads — stream, don't buffer |

- **Presign discipline** ([[OPINIONS]] O-14, [[KNOWN-PITFALLS]] P-01..P-05): prefer **presigned POST
  policy** over PUT for browser uploads (signs fields/conditions, can enforce `content-length-range` +
  `Content-Type`; PUT can enforce **neither**). Return the **exact signed-header set** to the client.
  NTP-sync signers. Effective expiry = `min(set-TTL, remaining-STS-session)` — Lambda temp creds ≈ 1h,
  7-day SigV4 cap. Always re-validate size server-side via HEAD ([[GAPS-AND-DISPUTES]] Dispute F).
- **Required secrets:** the **storage backend creds from §1** (these SDKs *are* how you talk to the
  backend). No additional secrets of their own.
- **Source.** [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (SDKs); [[raw/ecosystem-03-presigned-access-control-validation.md]]; [[raw/field-04-presigned-urls-large-files-timeouts.md]].

---

## 4. Resumable / large-file uploads (tus tier)

| Tool | Version · last push | Role | When it's the pick |
|---|---|---|---|
| **tusd** (reference server) | **v2.10.0** · 2026-06-16 | **DEFAULT** resumable server | Uploads must survive sleep/network-drop (mobile, big video). `s3store` backend = tus on the wire, S3 multipart at rest |
| **tus-js-client** | v4.3.1 · **2025-01-16 (stale-ish)** | Browser/Node tus client | The canonical tus client; mature but slow cadence ([[GAPS-AND-DISPUTES]] V-11) |
| `@uppy/tus` | (Uppy) | tus plugin for the Uppy UI | Want tus + a real UI |
| **cloudflare/tusd** (fork) | — | CF Stream's resumable ingest | Signal: tus is the de-facto resumable-video standard, not niche |

- **Decision rule** ([[EXPERTISE-MAP]] JTBD-3.5/4.1, [[OPINIONS]] O-21): `<100 MB` + stable → single
  presigned PUT. `>100 MB` → S3 multipart (parts 5 MiB–5 GiB, ≤10,000, object ≤5 TiB). **Resume across
  interruption** → tus (the *only* path that reliably survives sleep/network-drop).
- **Run tusd correctly** ([[KNOWN-PITFALLS]] P-21/P-22/P-23): pin **v2.10.0+** (ongoing HTTP/2 fixes);
  **disable the concatenation extension** (non-idempotent → duplicate data on retry, #1364; disable flag
  landed v2.9.0); **never back it with SMB/CIFS** (permanent dead locks, #1372 — use the S3 store).
  v2.9.0 added hook timeout + size-limit + Content-Type enforcement (useful for inline validation).
- **Agent-access surface:** **no first-party tus MCP exists** — drive tusd over HTTP (POST to create,
  PATCH to append) or via `tus-js-client` in a Node script ([[raw/ecosystem-05-multipart-resumable-tus.md]]).
- **Required secrets:** tusd's `s3store` needs the **§1 backend creds**; tusd hooks may need a shared
  secret for your validation endpoint (no canonical env name — define one, e.g. `TUSD_HOOK_SECRET`).
- **Source.** [[raw/ecosystem-05-multipart-resumable-tus.md]]; [[raw/ecosystem-08-real-breakage-github-issues.md]] (tusd).

---

## 5. Image optimization / transforms + CDN

| Tool | Stars/version · last push | Role | When it's the pick |
|---|---|---|---|
| **Cloudflare Images** | managed (R2-native) | **DEFAULT on R2** | Store originals in R2, serve optimized variants via **Transformation Flows** (config-not-code, GA 2026-05-27; `$5/100K stored` + `$1/100K delivered`, no egress; transform meter `$0.50/1K` after 5K free). Cleanest managed stack on the fleet default |
| **imgproxy** | v4.0.5 · 10,851★ · 2026-06-12 | Self-host transform server | Cost control at very high volume, on-prem, or want JXL/RAW control. v4 added async pipeline + internal cache (**pro**, [[GAPS-AND-DISPUTES]] V-13) |
| **Thumbor** | (older Python) | Legacy self-host | Know it exists; imgproxy is the modern default |
| **Bunny.net** | managed CDN | Independent CDN alt | Not all-in on Cloudflare; cheap (`$0.01–0.06/GB`) + Bunny Optimizer + token-auth signed URLs |
| **AWS CloudFront** | managed CDN | S3 default CDN | On S3; signed URLs/cookies for private content; Cache Tags for targeted invalidation |

- **CDN/cache discipline** ([[OPINIONS]] O-20, [[KNOWN-PITFALLS]] P-31..P-34): **don't invalidate —
  change the URL.** Content-hashed immutable assets (`max-age=31536000, immutable`) + `no-cache`/short-TTL
  pointer. Purge is for emergencies (Cache Tags / surrogate keys, never `/*`).
- **imgproxy security is mandatory** ([[OPINIONS]] O-12, [[KNOWN-PITFALLS]] P-35): URL signing
  (`IMGPROXY_KEY` + `IMGPROXY_SALT`) is **required in prod** (unsigned = open proxy = SSRF + bandwidth
  abuse); set `IMGPROXY_ALLOWED_SOURCES` allowlist; watch AVIF CPU (`IMGPROXY_AVIF_SPEED`).
- **Required secrets:** Cloudflare Images → `CLOUDFLARE_API_TOKEN` (scoped to Images) + `CF_ACCOUNT_ID`
  (often the same CF token as R2). imgproxy → `IMGPROXY_KEY`, `IMGPROXY_SALT`, `IMGPROXY_ALLOWED_SOURCES`,
  (+ `IMGPROXY_S3_*` / `IMGPROXY_S3_ASSUME_ROLE_ARN` if reading from S3). Bunny → `BUNNY_API_KEY` +
  zone/token-auth key. CloudFront → AWS creds + a signing key-pair for signed URLs.
- **Source.** [[raw/ecosystem-06-image-optimization-cdn.md]].

---

## 6. Virus / malware scanning

| Tool | Role | When it's the pick |
|---|---|---|
| **AWS GuardDuty Malware Protection for S3** | **DEFAULT on AWS** | Managed; ML+heuristic beyond ClamAV signatures; defs every 15 min; `$0.09/GB` (after 2025 −85% cut). Real migrations cut Lambda cost −99.8% ([[OPINIONS]] O-19) |
| **ClamAV** (`clamdscan`/`clamscan` + `freshclam`) | Off-AWS default engine | R2/B2/Tigris (no managed primitive exists, [[GAPS-AND-DISPUTES]] G-02). Free, signature-based; package as a **container image** (exceeds 250 MB Lambda layer limit) |
| **`opg-s3-antivirus`** (UK gov, maintained) | The clean OSS reference pattern | Off-AWS DIY: incoming→scan→clean/quarantine + definitions updater + IaC |
| **`clara`** (34★ · 2026-01) | ClamAV **+ YARA** S3 scanner | Want heuristic/rule detection on top of signatures; small but most capable OSS |
| **bucketAV** / **Cloudmersive** | Commercial managed AV | bucketAV = maintained AWS-marketplace heir to the archived repo (*may* win at very large AWS volume, [[GAPS-AND-DISPUTES]] Dispute E); Cloudmersive = scan API callable from a Worker on R2 |
| ~~`bucket-antivirus-function`~~ | **ARCHIVED (2024-04) — DO NOT BASE ON IT** | The once-canonical repo; copying it ships unmaintained AV ([[KNOWN-PITFALLS]] P-39) |

- **Pattern is non-negotiable** ([[OPINIONS]] O-18): incoming/quarantine prefix → S3 event → scanner →
  tag `clean|infected` → promote/lock; object `pending` & **unservable until clean**; maintain a
  **separate scheduled `freshclam` definitions updater** (most-skipped piece — without it the scanner
  silently rots). **VirusTotal is a privacy/compliance hazard** (sends user files to a third party) — don't
  use it for PII files.
- **Agent-access surface:** **no virus-scanning MCP exists** ([[raw/ecosystem-04-virus-scanning.md]]) —
  agent wires the Lambda/container pipeline via IaC (SST/CDK/Terraform) and drives `clamdscan`/`clamscan`
  inside the container, or calls a managed scan API.
- **Required secrets:** GuardDuty → AWS creds + the feature enabled on the bucket (no extra key).
  ClamAV → none (engine), but the defs-updater writes to a bucket (uses §1 creds). bucketAV/Cloudmersive
  → their API keys (`CLOUDMERSIVE_API_KEY`, etc.).
- **Source.** [[raw/ecosystem-04-virus-scanning.md]]; [[raw/ecosystem-10-starter-template-repos.md]].

---

## 7. Agent CLIs & MCP servers (shelf's hands)

### MCP servers (the agent-native control plane)
| MCP | Stars · push | Surface | When |
|---|---|---|---|
| **cloudflare/mcp-server-cloudflare** | 3,867★ · 2026-06-08 | `r2_list_buckets`, `r2_*_bucket`, `r2_list_objects`, `r2_{get,put,delete}_object` | **DEFAULT on R2** — cleanest agent path; scoped CF API token. **Wire it into `.mcp.json`** (not present today, see §9). ⚠ presign-URL generation as a tool is **unconfirmed**, [[GAPS-AND-DISPUTES]] V-12 |
| **awslabs/mcp** (`s3-tables-mcp-server`) | 9,281★ · 2026-06-17 | S3 Tables / Iceberg (create/query tables, read-only SQL) — **NOT** object PUT/GET | Analytics over stored data (Iceberg), not general object CRUD |
| `diabloneo/s3-mcp` (generic) | low-star, **unvetted** | Any S3-compatible endpoint (R2/B2/Tigris/MinIO) | Last resort off-Cloudflare; **vet before prod** ([[GAPS-AND-DISPUTES]] G-01) |
| `mcp.pipedream.com/app/cloudflare_r2` | hosted | R2 (managed) | No self-host wanted |

> **The MCP gap** ([[OPINIONS]] O-23, [[GAPS-AND-DISPUTES]] G-01): there is **no maintained, high-star,
> general-purpose S3-object-CRUD MCP**. On R2 → Cloudflare MCP. Off Cloudflare → CLIs (below), or **shelf
> owns a thin S3-compatible MCP** (a gap shelf could fill).

### CLIs (the hands when there's no MCP)
| CLI | Role | Killer commands for shelf |
|---|---|---|
| **rclone** | **DEFAULT** multi-backend ("rsync for cloud storage"; v1.70.x; S3/R2/B2/Tigris/GCS/Azure/MinIO +60) | `rclone sync` (cross-provider migration); **`rclone backend list-multipart-uploads <remote>:`** (find the invisible orphaned-multipart cost, [[KNOWN-PITFALLS]] P-24); `--s3-no-check-bucket` (fewer perms for least-privilege tokens) |
| **aws** / `aws s3api` | S3 baseline (+ any S3-compatible via `--endpoint-url`) | `aws s3 presign` (TTL); `aws s3 cp` (auto-multiparts >8MB); `s3api` for multipart/lifecycle/object-lock |
| **wrangler** | R2-native CF CLI | `wrangler r2 object put/get/delete`, `wrangler r2 bucket create`; runs the CF MCP locally over stdio |
| **b2** | Backblaze CLI | `b2 upload-file`, `b2 sync` (or S3 CLI + `--endpoint-url`) |
| **s5cmd** | Very fast parallel S3 (Go) | Bulk ops at scale where `aws s3` is the bottleneck — **don't reach for it reflexively** ([[OPINIONS]] O-24) |
| **mc** (MinIO Client) | S3-compatible everywhere | Scripting + admin |

- **Required secrets (CLIs/MCP):** all consume the **§1 backend creds**. Cloudflare MCP + `wrangler` →
  `CLOUDFLARE_API_TOKEN` (least-privilege, per-service) + `CF_ACCOUNT_ID`. `rclone` → a config file
  (`rclone.conf`) holding per-remote keys (or env: `RCLONE_CONFIG_*`). GitHub MCP (already wired) →
  `GITHUB_PERSONAL_ACCESS_TOKEN`.
- **Source.** [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (whole file).

---

## 8. Starter / reference repos (build from these, not from memory)

| Repo | Stars · push | Use as | Caveat |
|---|---|---|---|
| **uploadthing `examples/`** | (in 5,151★ repo) | Fastest working upload UI (Next/Expo/Svelte/Solid) | Couples to UploadThing's hosted plane (not R2-direct) |
| **vercel/storage** | 590★ · 2026-06-15 | client-upload vs server-upload **patterns** (a sibling project's R2-vs-Vercel-Blob comparison's Blob side) | Vercel Blob is its own pricier egress-billed product — read for patterns, not the storage choice |
| **anomalyco/sst** (was sst/sst) | 26,079★ · 2026-06-04 | IaC-first `Bucket` + presigned-upload + Lambda triggers (foundation for the AV pipeline) | AWS/CDK-centric; **org renamed** (ownership signal, [[OPINIONS]] O-26) |
| **ministryofjustice/opg-s3-antivirus** | (UK gov, maintained) | Cleanest real-world S3 + ClamAV quarantine reference | AWS-specific (generalizability off-AWS unconfirmed) |
| **transloadit/uppy** | 30,826★ · 2026-06-16 | The upload-UI reference itself | — |
| **tus/tusd** | 3,805★ · 2026-06-16 | Resumable-server reference (`examples/` + docker) | Pin v2.10.0+ |
| **imgproxy/imgproxy** | 10,851★ · 2026-06-12 | Self-host transform reference (docker-compose in-repo) | — |

- **Stale — reference only, don't copy** ([[KNOWN-PITFALLS]] P-41): `rajeshdavidbabu/s3-upload-thing`
  (115★ · 2024-10), `ryanto/next-s3-upload` (592★ · 2024-12), `dropzone/dropzone` (2024-07).
- **The gap shelf could fill** ([[GAPS-AND-DISPUTES]] G-08): **no high-star, current, R2-direct (not
  UploadThing) presigned Next.js starter exists** — shelf could publish the CORS-correct, POST-policy-
  bounded, random-key, separate-domain-serve one.
- **Source.** [[raw/ecosystem-10-starter-template-repos.md]].

---

## 9. Required-Secrets manifest (FEEDS WAVE-P)

> **This is the actionable output for Wave-P.** shelf's `.env.example` today
> ([[raw/ecosystem-00-internal-references.md]] §4) has **only** `SUPABASE_*`, `BROWSERBASE_*`,
> `FIRECRAWL_*`, `ANTHROPIC_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN` (+ generic Energy keys). **None** of
> the storage backend keys exist yet. Wave-P must add the keys for whichever backend(s) shelf wires.
> Group them so a deploy only needs the rows for the path it chose.

### Tier A — DEFAULT path (R2 + Cloudflare, the fleet default)
| Secret | For | Notes |
|---|---|---|
| `R2_ACCOUNT_ID` / `CF_ACCOUNT_ID` | R2 + CF Images + Cloudflare MCP | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | R2 S3-API access | from R2 → Manage R2 API Tokens |
| `R2_SECRET_ACCESS_KEY` | R2 S3-API access | **secret — gitignored** |
| `R2_BUCKET` | bucket name | |
| `R2_ENDPOINT` | R2 S3 endpoint | account-specific; SDK uses `region:"auto"` ([[KNOWN-PITFALLS]] P-20) |
| `CLOUDFLARE_API_TOKEN` | CF Images + Cloudflare MCP + `wrangler` | **least-privilege, per-service** ([[OPINIONS]] O-23) |

### Tier B — S3 path (events / cold / compliance)
| Secret | For | Notes |
|---|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 + GuardDuty + CloudFront | scope the IAM principal narrowly (one bucket/prefix, [[OPINIONS]] O-15) |
| `AWS_REGION` | region | |
| `S3_BUCKET` | bucket name | |
| (CloudFront signing key-pair) | private signed URLs | key-pair id + private key |

### Tier C — alternate backends (only if chosen)
| Secret | For |
|---|---|
| `B2_KEY_ID` / `B2_APPLICATION_KEY` / `B2_BUCKET` | Backblaze B2 (cold + Bandwidth Alliance / WORM) |
| `TIGRIS_ENDPOINT` (+ `AWS_*`-shaped keys) | Tigris (global low-latency / forks) |
| `UPLOADTHING_TOKEN` | UploadThing managed DX layer |

### Tier D — image transforms (self-host) & AV (commercial)
| Secret | For | Notes |
|---|---|---|
| `IMGPROXY_KEY` / `IMGPROXY_SALT` | imgproxy URL signing | **mandatory in prod** ([[OPINIONS]] O-12, [[KNOWN-PITFALLS]] P-35) |
| `IMGPROXY_ALLOWED_SOURCES` | imgproxy SSRF guard | source allowlist |
| `BUNNY_API_KEY` | Bunny CDN/Optimizer + token auth | if not on Cloudflare |
| `CLOUDMERSIVE_API_KEY` / bucketAV creds | commercial AV scan API | off-AWS scan path |

### Tier E — metadata/state store (NOT the bytes — but required)
| Secret | For | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` **or** `SUPABASE_*` (present) | serverless-safe upload-state store | the metadata layer is the serverless bottleneck — **never `new Map()`** ([[OPINIONS]] O-25, [[KNOWN-PITFALLS]] P-40); `.claude/rules/typescript.md` |

> **Wave-P rule:** add only the tiers for the chosen path (DEFAULT = Tier A + Tier E). Every secret value
> stays gitignored (`.env`, never `.env.example`). The least-privilege principle ([[OPINIONS]] O-15)
> applies to **every** token here: scope the signing/API principal to one bucket/prefix and the minimum
> operations — a presigned URL can never grant more than the principal that signed it.

---

## 10. The agent storage playbook (decision tree → tool)

> Restated from [[EXPERTISE-MAP]] JTBD-12.5 as a tool-routing table — the fast path from "what am I doing"
> to "which tool + which secret."

| Situation | Tool path | Secrets |
|---|---|---|
| Provider is **R2**, need CRUD | Cloudflare MCP (`r2_*`) or `wrangler` | Tier A |
| Provider is **R2**, need a presigned URL for a user | AWS SDK v3 presigner (`region:"auto"` + R2 endpoint) — CF MCP presign is **unverified** (V-12) | Tier A |
| Provider is **S3**, need CRUD | `aws s3api` / AWS SDK (no object-CRUD MCP, G-01) | Tier B |
| Provider is **any S3-compatible** (B2/Tigris/MinIO) | `rclone` / `aws --endpoint-url` / vetted `diabloneo/s3-mcp` | Tier B/C |
| **Cross-provider migration** | `rclone sync` (or Tigris shadow buckets moving *to* Tigris) — **budget exit egress** ([[KNOWN-PITFALLS]] P-27) | source + dest creds |
| **Large / flaky upload** (resume-after-sleep) | tusd (v2.10.0+, concat disabled, S3 store) over HTTP — no MCP | Tier A/B + `TUSD_HOOK_SECRET` |
| **Find the invisible cost** | `rclone backend list-multipart-uploads <remote>:` + abort + lifecycle rule | backend creds |
| **Scan uploads** | GuardDuty (AWS) / `opg-s3-antivirus` ClamAV (off-AWS) — pattern, not a tool (G-02) | Tier B / backend creds |
| **Serve optimized images** | CF Images transformation flows (R2) / imgproxy v4 signed (self-host) | Tier A / Tier D |
| **Always, day one** | abort-incomplete-multipart lifecycle rule on every upload bucket ([[OPINIONS]] O-17) | backend creds |

- **Source.** [[raw/ecosystem-09-agent-operation-clis-mcp.md]] (agent playbook); cross-refs as cited.

---

> **How shelf uses this file:** when a task names a job ("accept uploads", "serve images", "migrate
> off S3", "scan for malware"), jump to the section, take the **DEFAULT**, check the **flip-conditions**
> in [[OPINIONS]], confirm the **secret** is provisioned (§9), and confirm the **agent-access surface**
> exists (MCP wired? CLI installed?). Unconfirmed tool facts (presign-via-MCP, Uppy×R2 edge cases, imgproxy
> cache tier, CLI currency) live in [[GAPS-AND-DISPUTES]] V/G — verify them before betting prod.
