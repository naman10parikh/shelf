---
title: "Object Storage Providers — R2 / S3 / Tigris / B2 / Supabase (June 2026, versions + deltas)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, storage, r2, s3, tigris, backblaze, supabase]
researcher: ecosystem (CP123 Wave-R)
---

# Object Storage Providers — versions, last-6-months deltas, honest trade-offs (June 2026)

## TL;DR taste (the recommendation shelf should lead with)
- **R2 is the fleet default** and that holds up in June 2026: zero egress is real ("three years in, the
  promise has held"). R2 has *also* become a mini data platform in 2026 (R2 SQL, Data Catalog,
  Pipelines all GA'd pricing in May 2026) — relevant if shelf ever needs to query stored objects.
- **S3 is the portability contract,** not necessarily the runtime. Recommend every backend speak the S3
  API so the harness is never locked in. S3's edge is the ecosystem (every tool, every MCP, every CLI).
- **Tigris** is the "AI-native, multi-region, zero-egress, shadow-bucket migration" challenger — best
  when you're on Fly.io or need global low-latency reads without a CDN in front.
- **Backblaze B2** is the cost floor ($6/TB) and pairs with Cloudflare for *unlimited* free egress via
  the Bandwidth Alliance — the classic "18x cheaper than S3" combo for egress-heavy/archival.
- **Supabase Storage** is the right call ONLY if you're already all-in on Supabase (shelf inherits
  `SUPABASE_*` keys) — it's S3-compatible now and has a resumable (tus) endpoint, but it's a wrapper.

## Cloudflare R2

**Pricing (2026, verified):** $0.015/GB-mo storage; Class A (writes/list) $4.50/M (1M free/mo);
Class B (reads) $0.36/M (10M free/mo); **$0 egress.** Source:
<https://vocal.media/futurism/cloudflare-r2-2026-pricing-features-and-aws-s3-comparison> (2026),
corroborated <https://comparestacks.com/developer-infrastructure/object-storage/pricing/cloudflare-r2/>.

**Last-6-months deltas (the big story — R2 became a data platform):**
- **2026-05-11** — **R2 SQL pricing GA**: serverless distributed query engine over Apache Iceberg in
  R2 Data Catalog; **$2.50/TB scanned**, free tier. <https://developers.cloudflare.com/changelog/post/2026-05-11-r2-sql-pricing-announced/>
- **2026-05-11** — **R2 Data Catalog pricing GA**: managed Apache Iceberg catalog built into R2
  buckets, queryable by Spark/Snowflake/DuckDB. <https://developers.cloudflare.com/changelog/post/2026-05-11-r2-data-catalog-pricing-announced/>
- **2026-05-11** — **Pipelines pricing GA**: streaming ingest → SQL transform → write to R2.
  <https://developers.cloudflare.com/changelog/post/2026-05-11-pipelines-pricing-announced/>
- **2026-06-08** — **R2 SQL adds UNION/INTERSECT/EXCEPT/SELECT DISTINCT.** (CF changelog index, fetched
  2026-06-16.) <https://developers.cloudflare.com/changelog/>
- **2026-04-27** — **Bucket emptying + folder deletion from the dashboard** (no script / no lifecycle
  rule needed). <https://developers.cloudflare.com/r2/platform/changelog/> (fetched 2026-06-16)

**R2 honest gotchas:**
- **No object-level Glacier-style cold tier the way S3 has** — R2 has Standard + Infrequent Access; for
  deep archive you still leave the ecosystem. (Confirm IA class availability per-region before relying.)
- **Class A op pricing punishes write-heavy/list-heavy workloads** even though egress is free — a
  many-tiny-objects workload can be more expensive on R2 than naive intuition suggests. Source: the
  "3 costs Cloudflare buries" analyses <https://leanopstech.com/blog/cloudflare-r2-pricing-2026/>,
  <https://comparestacks.com/.../cloudflare-r2/>. Treat third-party-blog cost analyses as directional,
  not gospel — verify against the official pricing page.
- **Eventual consistency edge cases** historically existed; R2 is now strongly-consistent for
  read-after-write of a single object, but list-after-write can lag. (Flag: verify current consistency
  guarantees in CF docs at build time.)

## AWS S3

**Status:** the baseline. Standard $0.023/GB-mo, egress ~$0.09/GB (the thing everyone flees). The 2026
edge is *features + ecosystem*, not price: trailing checksums (CRC32/CRC32C/SHA1/SHA256), S3 Express
One Zone (single-digit-ms, directory buckets), Object Lambda, strong read-after-write consistency
(since Dec 2020). For shelf the relevant facts:
- **S3 multipart limits (unchanged):** part 5 MiB–5 GiB, ≤10,000 parts, object ≤5 TiB, single-PUT ≤5
  GiB. <https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html>
- **Conditional writes** (`If-None-Match: *`) GA'd 2024 — lets you do atomic "create if not exists"
  without a lock; relevant for dedupe-by-key. (Verify R2/Tigris/B2 parity — not all S3-clones support
  conditional headers.)
- **Egress is the whole reason the fleet defaults to R2.** Keep S3 as the "portable/compliance/we're
  already on AWS" option.

## Tigris (tigrisdata)

**What it is:** globally distributed, S3-compatible, multi-cloud object storage. "Switch existing AWS
S3 or GCS SDKs with Tigris access keys + endpoint, often no code changes." Source:
<https://www.tigrisdata.com/docs/overview/>, <https://github.com/tigrisdata/storage>.
**Differentiators (June 2026):**
- **Zero egress fees**; data auto-placed close to users (Dynamic Data Placement) — global low-latency
  *without* a separate CDN. <https://www.tigrisdata.com/blog/object-storage-public-beta/>
- **Shadow buckets** = zero-downtime migration: keep existing store + Tigris in sync, cut over by
  config. This is the best migration story of any provider here. <https://www.tigrisdata.com/docs/overview/>
- **Native SDK extras:** client uploads, **bucket forks + snapshots** (copy-on-write buckets — unique;
  great for "branch my data for a test"). 
- SOC 2 Type II, HIPAA BAA available. Tight Fly.io integration (<https://fly.io/docs/tigris/>).
**Honest trade-off:** smaller company / smaller ecosystem than AWS/CF; "purpose-built for AI" framing
is marketing — the substance is global placement + forks. Verify durability SLA before betting prod on
it. Pricing "by usage, no upfront" — get exact rates from the pricing page (not surfaced in search).

## Backblaze B2

**Pricing (2026):** **$6/TB-mo** (74% cheaper than S3 Standard). Free egress up to **3× avg monthly
storage**; beyond that $0.01/GB. **Unlimited free egress through CDN/compute partners** (Cloudflare,
Fastly, bunny.net, CacheFly, Vultr, etc.). Source:
<https://www.backblaze.com/cloud-storage>, <https://leanopstech.com/blog/backblaze-b2-pricing-2026/>.
**The classic combo:** B2 + Cloudflare via the **Bandwidth Alliance** = $0 egress, no caps — "18x
cheaper than S3" for egress-heavy. <https://leanopstech.com/blog/backblaze-b2-pricing-2026/>.
**Honest trade-offs:**
- **Single storage class** — no IA/Glacier/tiering, no min-duration penalty (delete anytime). Simple,
  but no cold-tier savings for true archive.
- **The free-egress "catch":** restore/download patterns that bypass the partner CDN, or bulk restores,
  can still cost — read the "free egress trap" analysis:
  <https://leanopstech.com/blog/backblaze-b2-free-egress-trap-restore-costs-2026/>.
- S3-compatible API but historically *partial* (some advanced S3 features unsupported). Verify the
  specific S3 calls shelf needs (multipart yes; conditional writes / object lock — verify).

## Supabase Storage

**What it is:** object storage layered on S3, with an S3-compatible endpoint AND a **resumable (tus)
upload** endpoint, plus image transforms and RLS-based access control tied to Supabase Auth. shelf
already has `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` in `.env.example`.
**When to pick it:** you're already on Supabase and want auth-coupled storage + transforms in one
dashboard. **When NOT:** as a standalone object store it's a wrapper with extra hops; R2/Tigris are
leaner. (Verify current image-transform pricing + tus endpoint limits in Supabase docs at build time.)

## One-line decision matrix for shelf

| Need | Pick |
|---|---|
| Default, egress-heavy, want zero egress + data platform | **R2** |
| Maximum portability / already on AWS / compliance | **S3** |
| Global low-latency reads w/o CDN; Fly.io; data branching | **Tigris** |
| Cheapest cold-ish storage + Cloudflare CDN front | **B2 + Cloudflare** |
| Already all-in on Supabase, want auth+transforms bundled | **Supabase Storage** |

## GAPS / unconfirmed
- Exact Tigris + Supabase Storage per-GB rates (not surfaced cleanly in search; need pricing page).
- Whether R2 / B2 / Tigris support S3 conditional writes (`If-None-Match`) — must verify per provider.
- R2's current list-after-write consistency guarantee (docs language has shifted over time).
