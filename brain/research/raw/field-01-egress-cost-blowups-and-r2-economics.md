---
title: "Field Intel 01 — Egress-Cost Blowups & the R2 Migration Reality"
type: source
created: 2026-06-16
tags: [field-intelligence, egress, r2, s3, cost, postmortem]
summary: "Real S3 bill-shock stories, the viral-file blowup, and the buried costs that make 'R2 has no egress' a half-truth."
sources_meta: "WebSearch + WebFetch June 2026; primary URLs cited inline with dates."
---

# Field Intel 01 — Egress-Cost Blowups & the R2 Migration Reality

> Researcher: FIELD-INTELLIGENCE (shelf, CP123 Wave-R). Currency target: June 2026.
> Bar: real failure scenarios, real dollar figures, explicit taste. Marketing copy = failure.

## 1. The canonical "viral file" blowup (the story every storage engineer should fear)

**Claim:** A developer's AWS bill jumped **from $23 to $2,657 overnight** when a single 13.7 GB file went viral. Every download by every user worldwide was billed at S3's `$0.09/GB` egress rate. The cost is *unbounded* and *demand-driven* — you do not control how many times the internet pulls your object.
- Source: Usage.ai, "S3 Egress Cost" — <https://www.usage.ai/blogs/s3-egress-cost/> (surfaced via WebSearch June 2026, article 2025-current). Also echoed by CloudSee Drive "S3 Data Transfer Fees Are Killing Your Budget" <https://www.cloudseedrive.com/s3-data-transfer-fees/>.
- **Why it matters (taste):** storage cost is predictable; *egress* cost is a function of someone else's behavior. A file-handling employee MUST treat egress as the #1 financial risk, not storage GB. Storage is cents; a viral object is a four-figure surprise.

**Dropbox precedent (the "build your own" tipping point):** Dropbox — one of S3's largest customers — saved **$74.6M over two years** by building its own storage layer ("Magic Pocket") and leaving S3. Source: Usage.ai (same article). Taste signal: at hyperscale, egress economics flip the build-vs-buy decision; below that scale, you're paying the egress tax to avoid ops burden.

## 2. The hidden math: S3 egress has FOUR prices, not one

**Claim:** Teams that estimate S3 cost "from the egress rate alone consistently underestimate the total because S3 egress involves four different billing scenarios with four different prices." Most cost alerts "trigger too late, after thousands of dollars have already been spent."
- Source: Usage.ai <https://www.usage.ai/blogs/s3-egress-cost/>; LeanOps "Why Your S3 Bill Is 2-3x the Pricing Page" <https://leanopstech.com/blog/aws-s3-pricing-2026/> (LeanOps dates its pricing posts 2026).
- The four buckets in practice: (a) internet egress (`~$0.09/GB`, tiered down with volume), (b) cross-region replication transfer, (c) inter-AZ transfer (the silent killer for chatty apps), (d) request-tier charges (GET/PUT/LIST priced separately). The headline `$0.09/GB` is only bucket (a).
- **Reference figure:** at **10 TB/month internet egress, S3 transfer alone ≈ $900/month** — which "can exceed storage costs." Source: Usage.ai. Confirmed against the R2 comparison below ($891–$922 for ~10TB).

## 3. "Just move to R2" — and the three costs Cloudflare buries

R2's pitch is **zero egress**. True for egress. But LeanOps "R2 Pricing: The 3 Costs Cloudflare Buries" (**dated 2026-04-17**, <https://leanopstech.com/blog/cloudflare-r2-pricing-2026/>) documents the gotchas, with figures:

1. **Storage premium — `$0.015/GB/month`.** Verbatim: *"the $0.015/GB storage rate is 2.5x higher than Wasabi and nearly 2.5x higher than Backblaze B2."* Cold/archival workloads pay a premium for an egress benefit they never use. **Taste:** R2 only wins if you actually have meaningful egress. For write-once-read-never archives, R2 is the *wrong* default.
2. **Class A operations (writes) — `$4.50 per million`.** Verbatim: *"At 100M monthly writes, that is $450/month just in operation fees."* This is "a genuine gotcha for data ingestion pipelines" — thumbnail generation, log shipping, or per-event object writes get expensive fast.
3. **Class B operations (reads) — `$0.36 per million`.** Silent at small scale; "a meaningful line item" at high read volume (e.g. CDN-origin reads on cache miss).

**The migration-cost contradiction (the part nobody budgets):** *"moving data out of S3 incurs $0.09/GB egress charges. For 10TB, that's a $922 one-time cost to escape S3's egress pricing."* You pay S3's egress tax **one final time** to leave it. Source: LeanOps R2 article (2026-04-17).

**Synthesized taste:** "No egress fees" is a *traffic-shape* optimization, not a universal win. Decision rule for shelf:
- High egress / hot read path (media serving, public downloads) → **R2 wins big** ($15/mo vs $891/mo at 10TB egress per digitalapplied comparison <https://www.digitalapplied.com/blog/cloudflare-r2-vs-aws-s3-comparison>).
- Write-heavy ingestion (millions of small objects/day) → **R2 Class A fees bite**; reconsider.
- Cold archive, low egress → **Backblaze B2 / Wasabi cheaper** than R2 on storage.

## 3b. NixOS Foundation — a REAL named-org egress postmortem (the lock-in proof)

The strongest *named-entity, dated* egress story (not vendor marketing): the **NixOS Foundation's "Call to Action: S3 Costs Require Community Support"** (HN, **2023**, <https://news.ycombinator.com/item?id=36173020>).
- **The numbers:** ~**$9,000/month** on AWS S3 — **450TB stored + 29.5TB egress/month** (~**3TB transferred daily** to users). A commenter cited a **$32,000 one-time cost just to move the data out** (egress to migrate).
- **Egress-dominated (verbatim sentiment):** storage was manageable; *"the bandwidth charges for serving downloads were unsustainable"* for a volunteer-run org. And the lock-in lesson (verbatim): S3's egress fees created *"a lock-in problem — expensive to enter, expensive to exit — making it unsuitable for projects serving high-volume downloads to the community."*
- **Why it matters for shelf:** this is the field-01 §1 viral-file dynamic at *sustained* scale. Any product that serves lots of downloads (OSS mirrors, public media, large free assets) is in NixOS's position. The $32K exit cost is the field-03 §2 "one-time exit egress" made concrete on a real bill. **High-download-volume + S3 = structurally wrong; this is the canonical R2/CDN-or-bust case.**

## 4. Inter-AZ / cross-region transfer — the egress you forget is egress

**Claim:** AWS data-transfer cost is dominated not just by internet egress but by inter-AZ and cross-region traffic; teams "master AWS egress" specifically by collapsing cross-AZ chatter and using VPC endpoints / S3 Gateway Endpoints (free) instead of routing S3 traffic through NAT gateways (which bill per-GB).
- Source: Hykell "How to master AWS egress costs" <https://hykell.com/kb/cloud-cost-auditing/aws-egress-costs/>; Backblaze "Cloud Egress Fees Explained" <https://www.backblaze.com/blog/cloud-101-data-egress-fees-explained/>.
- **Specific trap:** S3 traffic from a private-subnet Lambda/EC2 routed through a **NAT Gateway** is billed at NAT data-processing rates (~$0.045/GB) ON TOP of being "free" S3 in-region. Using an **S3 Gateway VPC Endpoint** ($0) eliminates this. This is a top-5 silent S3 bill inflator. (Hykell, Backblaze.)

## 5. What changed in 2026 (invalidates 2025 conventional wisdom)

- **R2 is now a credible *default*, not a niche.** The energy harness checklist already names R2 the default for object storage (`audit/HARNESS-CHECKLIST-2026.md` §"Object storage / CDN / file uploads", line 342: *"Default: Cloudflare R2 (no egress fees)"*). 2025 wisdom ("S3 is the safe default") is being displaced — but §3 above shows the default must be *traffic-aware*.
- **Neon/Databricks storage repricing (2026):** Databricks-acq Neon cut storage −80% (audit checklist line 270) — a signal that the broader "storage is cheap, egress is the moat" pricing pattern is intensifying across vendors. Cited: <https://www.databricks.com/blog/databricks-neon>.
- **The egress-fee waiver regulatory pressure:** AWS/GCP/Azure began waiving egress fees *for customers leaving the platform entirely* (EU Data Act pressure, 2024→). This does NOT help in-use egress — it only helps a full exit. Net: the viral-file blowup risk is unchanged. (Backblaze egress explainer.)

## 6. Practitioner decision rules distilled (for shelf's brain)

1. **Budget egress before storage.** A file-serving product's bill is egress-dominated; alert on egress, not GB stored.
2. **Never serve hot public objects straight from S3 origin.** Put a CDN (or R2) in front so origin egress → cache; otherwise every view is `$0.09/GB`.
3. **Default to R2 for hot/public; B2 or Wasabi for cold archive; S3 only when you need its ecosystem (Lambda triggers, deep IAM, Glacier tiers).**
4. **Account for the one-time exit egress** when migrating off S3 ($0.09/GB × total stored).
5. **Use S3 Gateway VPC Endpoints** for any in-VPC S3 access — eliminates NAT data-processing surprise.

## Open / unconfirmed (→ GAPS-AND-DISPUTES)
- The exact "$23 → $2,657" story is widely cited by cost-tooling vendors (Usage.ai, CloudSee) but I could not trace it to the *original* first-person blog/HN post with a date — treat the figure as illustrative, vendor-sourced, not a verified single primary postmortem. (The **NixOS** story in §3b IS a verified named-org primary source and corroborates the egress-dominated thesis at scale.)
- LeanOps and Usage.ai are cost-optimization vendors (incentive to dramatize bills). Figures are directionally corroborated across 3+ vendors but each has a commercial angle.
- The NixOS figures are from a 2023 HN thread (>6mo old) but I retain them: they're a concrete, widely-witnessed, named-org datapoint and the egress economics they describe are *unchanged* in 2026 (the EU Data Act only waives full-exit egress, not serving egress — see field-06 §1e).
