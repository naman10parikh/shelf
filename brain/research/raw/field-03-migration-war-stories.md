---
title: "Field Intel 03 — Migration War Stories (S3 ↔ R2 ↔ B2 ↔ Vercel Blob ↔ UploadThing)"
type: source
created: 2026-06-16
tags: [field-intelligence, migration, r2, s3, vercel-blob, uploadthing, war-story]
summary: "What actually breaks when you switch object-storage providers. The 9-saved-5-reverted story, the S3-Event-Notifications wall, and the DX-abstraction cost trap."
sources_meta: "WebFetch/WebSearch June 2026; LeanOps decision-framework (2026-05-10) is the spine; HN + DEV corroboration."
---

# Field Intel 03 — Migration War Stories

> Provider A→B is never a config swap. The S3 API compatibility is the easy 80%; the 20% that breaks is the AWS *ecosystem* (events, lifecycle, compliance, replication) and the DX abstraction you can't see the bill for.

## 1. The headline migration story: 14 workloads, 9 saved, 5 reverted within 90 days

**LeanOps, "R2 vs S3: The 4 Cases Where S3 Still Wins" (dated 2026-05-10, <https://leanopstech.com/blog/cloudflare-r2-vs-aws-s3-decision-framework-2026/>):** they moved **14 production workloads from S3 to R2 over 18 months** —
- **9 workloads saved 40-70%** (the upload-once / download-many media pattern — R2's sweet spot).
- **5 workloads were moved BACK to S3 within 90 days** because "the limitations cost more than the egress savings."

**The strongest quote (verbatim):** *"What nobody tells you is that zero egress means nothing if your architecture depends on S3 event notifications."* And: *"The internet is full of R2 pricing pages showing the $0/GB egress fee and declaring victory."*

### The 4 things that drag workloads back to S3 (verbatim figures):
1. **S3 Event Notifications** — *"R2 does not have S3's event notification system. If your pipeline triggers Lambda functions on object uploads, you need to rebuild that workflow."* Workaround (polling/webhooks) costs *"$30-80/month plus added latency."* — **This is the #1 migration blocker.** (Corroborated independently in WebSearch synthesis: *"S3 Event Notifications are deeply integrated with AWS's event bus… R2 doesn't have equivalent functionality."*)
2. **Lifecycle tiering (Glacier / Deep Archive)** — *"R2 has one tier at $0.015/GB… S3 with lifecycle: $886/month… R2 flat rate: $1,500/month"* → **R2 is 69% more expensive for data-lake/cold workloads** because it can't auto-transition to cold tiers. (Matches field-01 §3: R2 storage premium hurts cold data.)
3. **Compliance** — *"R2's compliance story is thinner: SOC 2 Type II and ISO 27001, but no FedRAMP, no GovCloud, no HIPAA BAA."* Healthcare/gov can't move.
4. **Multi-region active-active** — *"R2… has no true cross-region replication with consistency guarantees."*

**TASTE for shelf:** the migration decision is **per-workload, not per-company**. Audit each bucket's *access pattern + dependency graph* before moving. The reversal cost (re-migrate + re-egress) is real money. A blanket "we're moving everything to R2" is the anti-pattern.

## 2. The R2 Super Slurper migration-tooling reality

- Cloudflare ships **R2 Super Slurper** (now GA) to bulk-copy S3→R2 (<https://blog.cloudflare.com/r2-super-slurper-ga>). It exists *because* migration-by-hand is painful.
- **Real failure mode reported:** users hit *"Invalid upstream credentials"* errors configuring migration tools (WebSearch synthesis from r/aws + migration docs). Migration tooling auth is a common stumbling point.
- **The one-time exit egress still applies** (field-01 §3): Super Slurper reads from S3 → you pay S3 egress for the full dataset once. Budget `$0.09/GB × total stored`.

## 3. "S3 API compatible" ≠ "drop-in" — the SDK-endpoint reality

- Migrating to R2: *"you need to update your API layer to read from R2 instead of S3, and if using AWS SDK, switch to S3-compatible endpoint since R2 supports the S3 API."* The SDK works, but: R2 doesn't implement *every* S3 API surface (notably no event notifications, partial ACL semantics, no `s3:` IAM condition keys — R2 uses Cloudflare tokens/policies instead). Source: WebSearch synthesis + LeanOps.
- **TASTE:** "S3-compatible" is a *data-plane* promise (GET/PUT/multipart/presign), not a *control-plane* promise (IAM, events, replication, lifecycle). Code that only does object I/O ports cleanly; code that leans on AWS control-plane features does not.

## 4. The DX-abstraction cost trap: Vercel Blob & UploadThing vs raw S3/R2

The 2026 pattern: convenient upload SDKs (Vercel Blob, UploadThing) are *S3/R2 with a markup*. They save dev time but the bill surprises you.

- **Vercel Blob:** *"$0.023/GB-month"* storage AND *"$0.05/GB for egress"* — vs R2 `$0.015/GB` + `$0.00` egress. *"It is extremely expensive based on discussions on internet."* But it wins for *"transient workloads… image processing pipelines, build artifacts, and temporary user uploads that get cleaned up"* due to 15-minute sampling billing. Sources: edge-cases.com "Vercel Blob Storage: When It Makes Sense (and When It Doesn't)" <https://www.edge-cases.com/nextjs/vercel-blob-storage-patterns>; DEV "Is Vercel Blob Too Expensive?" <https://dev.to/engineeringexpert/is-vercel-blob-too-expensive--n5>.
- **UploadThing:** *"services like Vercel blob and Uploadthing might not be necessary and will only cost you a fortune over using an S3 provider directly."* DEV "Uploads are easy, S3 is easy" <https://dev.to/garretcharp/uploads-are-easy-s3-is-easy-723> argues the abstraction's value evaporates once you know the direct-to-S3 presigned pattern.
- **TASTE (the practitioner split):** DX SDKs are *correct* for prototypes, transient data, and teams without infra skill. They are *wrong* for read-heavy production media at scale — the per-GB egress markup compounds exactly when you succeed (more users = more downloads = bigger bill). This mirrors the field-01 viral-file risk, now with a 3-5x multiplier.

## 5. The "move back" is a first-class outcome (synthesis)

Across LeanOps (5/14 reverted), the Vercel-Blob "too expensive at scale" thread, and the UploadThing "fortune vs raw S3" thread — the consistent meta-lesson is: **provider choice should be reversible and per-workload.** Architect with an abstraction layer (a thin `Storage` interface over the S3 API) so a workload can be re-pointed without a rewrite. Lock-in comes not from the data plane (S3 API is portable) but from control-plane features (events, lifecycle) — minimize those dependencies if you want optionality.

## 6. Decision matrix distilled (for shelf's brain)

| Workload shape | Best pick (June 2026) | Why |
|----------------|----------------------|-----|
| Hot public media, download-many | **R2** | zero egress dominates |
| Write-heavy ingestion (M small objects/day) | **S3** or watch R2 Class-A fees | R2 `$4.50/M` writes bite |
| Cold archive / data lake w/ tiering | **S3 (Glacier/IA) or B2** | R2 has one tier, 69% pricier |
| Event-driven (upload→Lambda) | **S3** | R2 has no event notifications |
| Compliance (HIPAA/FedRAMP/Gov) | **S3** | R2 lacks BAA/FedRAMP/GovCloud |
| Prototype / transient / build artifacts | **Vercel Blob / UploadThing** | DX + 15-min billing > cost |
| Read-heavy production at scale w/ DX SDK | **migrate off the SDK to R2/S3** | egress markup compounds |

## Open / unconfirmed (→ GAPS-AND-DISPUTES)
- LeanOps is the *single* source for the precise "14/9/5 within 90 days" figures and is a cost-consultancy (commercial incentive to dramatize). The *direction* (some workloads revert due to events/lifecycle/compliance) is corroborated by independent WebSearch syntheses, but the exact numbers are one-source.
- I read the LeanOps and DEV articles via WebFetch summaries, not full raw HTML — verbatim quotes are as the fetcher surfaced them; a human verifying should open the originals.
- Could not find a *named-company* engineering-blog migration postmortem (vs consultancy/aggregator posts) within currency window — see GAPS.
