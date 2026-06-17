---
title: "Lifecycle, retention, Object Lock / WORM (June 2026)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, lifecycle, retention, object-lock, worm]
researcher: ecosystem (CP123 Wave-R)
---

# Lifecycle / Retention / Object Lock (June 2026)

## Lifecycle policies — the two jobs they do

1. **Cost control via transition + expiration:** auto-move objects to cheaper tiers (S3
   Standard → IA → Glacier; R2 Standard → Infrequent Access) after N days, and auto-delete after N days.
2. **Cleanup of operational cruft:** the two rules everyone forgets and should ALWAYS set:
   - **Abort incomplete multipart uploads after N days** — orphaned multiparts bill as storage and are
     invisible to normal listing (see ecosystem-05). This is the #1 silent S3 cost. Supported on S3 and
     R2 lifecycle.
   - **Expire/delete expired object delete markers** (versioned buckets) — versioning + deletes leave
     delete-markers that accumulate. Source: AWS re:Post + lifecycle docs.
Source: <https://oneuptime.com/blog/post/2026-02-12-configure-s3-object-lock-worm-compliance/view>,
<https://repost.aws/questions/QU8JikuFZqS22FZLiAi2p96g/s3-object-lock-and-incomplete-uploads>.

## Object Lock / WORM — the compliance teeth (and the irreversible footguns)

Source: <https://aws.plainenglish.io/how-to-use-object-lock-in-amazon-s3-with-compliance-mode...> (Mar 2026),
<https://www.solved.scality.com/s3-object-lock/>.

- **Two modes:**
  - **Governance mode** — protected, but a privileged principal (`s3:BypassGovernanceRetention`) can
    override/shorten. Use for "prevent accidental deletes."
  - **Compliance mode** — **genuinely immutable. NOBODY — not even the AWS root account — can delete or
    shorten retention until it expires.** Use for regulatory WORM (SEC 17a-4, etc.). 
- **FOOTGUN #1 — irreversible:** Compliance-mode retention cannot be undone. Set a 7-year retention by
  mistake on a 1 PB bucket and you pay for 7 years. Test with short retentions first.
- **FOOTGUN #2 — bucket-creation-time only:** **Object Lock MUST be enabled at bucket creation; it
  cannot be added to an existing bucket.** (Requires versioning.) If shelf might ever need WORM, the
  bucket must be created with it on. Plan for it up front or migrate later (painful).
- **Lifecycle × Object Lock interaction:** lifecycle expiration will NOT delete a locked object while
  the retention is active; once retention expires, the object becomes eligible and lifecycle deletes it
  normally. Pair them: lock for the compliance window, lifecycle to clean up after. Source: re:Post
  "S3 Bucket not deleting files after retention period passed."

## Cross-provider parity (the portability caveat)

- **S3** — full lifecycle + Object Lock (both modes) + tiering.
- **R2** — has lifecycle rules (transition to Infrequent Access, expiration, abort-incomplete-multipart)
  and **Bucket Locks** (shipped 2025-03-06) for retention — BUT **R2 does NOT have true compliance-mode
  WORM.** CONFIRMED: "Object Lock for compliance retention is not available in Cloudflare R2. Instead,
  Cloudflare offers bucket locks... they lack compliance-mode immutability, legal hold, and regulatory
  certifications, and rules can be removed by administrators." So R2 Bucket Locks ≈ S3 Governance mode,
  NOT Compliance mode. For certified WORM (SEC 17a-4) you need **S3 Object Lock compliance mode** — R2
  cannot do it as of June 2026. Sources:
  <https://developers.cloudflare.com/r2/buckets/bucket-locks/>,
  <https://developers.cloudflare.com/changelog/2025-03-06-r2-bucket-locks/>,
  <https://onidel.com/blog/cloudflare-r2-vs-backblaze-b2>. The 2026-04-27 R2 changelog also added
  dashboard bucket-empty/folder-delete (convenience, not lifecycle).
- **Backblaze B2** — single storage class, **no tiering/lifecycle transitions**, but has lifecycle
  *rules* for hiding/deleting versions, and **Object Lock (governance + compliance)** for WORM.
- **Tigris** — verify lifecycle + object-lock support (newer provider; snapshots/forks are its
  versioning story).

## shelf recommendation (taste)
- **Always, on every bucket, day 1:** lifecycle rule to abort incomplete multipart uploads (e.g. 7
  days) + (if versioned) expire noncurrent versions + delete-marker cleanup. Cheap insurance against
  the invisible bill.
- **Tiering:** only worth it above ~TB scale; for most product assets the egress story (R2 $0) matters
  more than cold-tier pennies.
- **WORM:** if there's any chance of a compliance customer, create the storage with Object Lock enabled
  from the start (you can't retrofit). Default to **governance mode** unless a regulator demands
  compliance mode — compliance mode's irreversibility is a liability if you set it wrong.

## shelf taste on WORM provider choice
If a customer needs **certified WORM/compliance**: it's **S3 (compliance mode)** or **B2 (compliance
mode)** — NOT R2 (Bucket Locks are governance-grade only). This is a case where the fleet's R2-default
must yield to S3/B2. Flag this clearly so shelf doesn't promise WORM on R2.

## GAPS / unconfirmed
- Tigris lifecycle/object-lock support — not confirmed in search.
- Exact R2 Infrequent Access pricing + min-duration penalty — verify on pricing page.
