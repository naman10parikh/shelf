---
title: "Field Intel 05 — CDN Cache-Invalidation Pain (the hard problem of computer science, in prod)"
type: source
created: 2026-06-16
tags: [field-intelligence, cdn, cache, invalidation, cloudfront, stale-assets]
summary: "Why purge-based invalidation is a trap: propagation delay, the 15-invalidation cap, thundering-herd origin overload, and the hashed-filename escape hatch."
sources_meta: "WebSearch/WebFetch June 2026; AWS re:Post + CloudFront docs + cache-busting guides."
---

# Field Intel 05 — CDN Cache-Invalidation Pain

> "There are only two hard things in computer science: cache invalidation and naming things." For a file-handling employee, both bite — and they compound (naming = your cache key; invalidation = your deploy story).

## 1. The core failure: "I deployed but users see the old file"

**Verbatim (cache-busting guides, WebSearch synthesis):** *"Getting cache busting wrong means users see stale files after a deploy."* The naive fix — explicitly purging the CDN — is itself the trap:

- **Propagation is not instant (verbatim):** *"CloudFront invalidations can take 10-60 seconds to propagate across all edge locations. During that window, some users get old content, some get new."* You cannot treat a purge as atomic.
- Sources: httpfixer.dev "Cache Busting Strategies" <https://httpfixer.dev/blog/cache/cache-busting-strategies/>; PicTomo "CDN Edge Caching and the Hard Problem of Cache Invalidation" <https://pic-tomo.com/en/blog/cdn-edge-cache-invalidation>.

## 2. The thundering-herd / cache-stampede on wildcard invalidation

**Verbatim (cache-busting synthesis):** *"Wildcard invalidations (`/*`) are especially dangerous at scale because they cause a thundering-herd effect: every edge node simultaneously fetches fresh content from origin, potentially overwhelming your origin servers if you have thousands of edge nodes and millions of cached objects."*

- **CloudFront's own mitigations (so you know the platform is fighting this):**
  - **Request collapsing / cache-stampede protection:** *"CloudFront… pauses briefly before forwarding additional requests for an object to the origin if there's a traffic spike and additional requests arrive before the origin responds to the first request."* (OTTverse "Request Collapsing and the Thundering Herds Problem" <https://ottverse.com/request-collapsing-thundering-herds-in-cdn/>; AWS AppSync/CloudFront caching article.) This is "dog-piling" defense built into the edge.
  - **Invalidation by Cache Tag (2024+ feature):** AWS shipped *"Invalidation by Cache Tag"* precisely because *"wildcard invalidations… could impact origin servers"* — it lets you *"target precise objects impacted by an update."* Source: AWS Networking blog <https://aws.amazon.com/blogs/networking-and-content-delivery/manage-caches-with-precision-using-amazon-cloudfront-invalidation-by-cache-tag/>.

## 3. The hard operational limits (the ones that page you)

- **15-invalidation-paths-in-progress cap (verbatim):** *"You can use wildcards in the invalidation path with a maximum of 15 invalidation paths in progress at the same time."* Exceed it → `TooManyInvalidationsInProgress` errors (AWS re:Post knowledge-center article <https://repost.aws/knowledge-center/cloudfront-invalidation-request>). A deploy that purges per-file across many files hits this wall fast.
- **Distributions stuck "In Progress":** invalidations (and config changes) can hang in `InProgress`, blocking subsequent ones — Steve Porter / The Scale Factory, "Is your CloudFront distribution stuck 'in progress'?" <https://medium.com/the-scale-factory/is-your-cloudfront-distribution-stuck-in-progress-7e3aead1337b>.
- **S3-origin invalidation confusion:** CloudFront *"does not invalidate cache (s3 origin)"* is a recurring re:Post question (<https://repost.aws/questions/QUNql44bkFTE2j4IEbnO7zRg/...>) — people update the S3 object but CloudFront keeps serving the cached version until TTL or explicit invalidation. The mental model "I changed the file in S3, the CDN will notice" is **wrong**.

## 4. The escape hatch the best practitioners use: content-hashed filenames (don't invalidate at all)

**The strong opinion (verbatim, cache-busting guides):** *"The best cache invalidation strategy is often to avoid invalidation entirely — use versioned URLs for static assets and let cache-busting do the work."*

How it works (verbatim): *"include a content hash in the filename (e.g. `app.a3f9d2c.js`)… Since the URL changed, the CDN treats it as a new resource — no conflict with old caches. The old URL continues to serve the old file (good for users mid-session), while the new URL immediately serves fresh content."*

**The one critical detail people miss (verbatim):** *"This requires your `index.html` to not be heavily cached, since it must always reference the latest fingerprinted filenames. HTML typically gets `Cache-Control: no-cache` (revalidate every request) or a very short TTL, while fingerprinted assets get long-lived TTLs (`Cache-Control: max-age=31536000, immutable`)."*

- **TASTE for shelf:** the deploy story is a two-tier cache policy: **immutable+1yr for hashed assets, no-cache/short-TTL for the HTML (or API) that points at them.** Then you NEVER purge — new content = new URL. Purge-based invalidation is reserved for emergencies (pulling leaked/illegal content), not for normal deploys. This sidesteps propagation delay, the 15-path cap, AND the thundering herd in one architectural move.

## 5. The user-uploaded-content twist (where hashing is harder)

- Hashed filenames are trivial for *build artifacts* (your bundler does it). For *user uploads that can change in place* (avatar re-upload to the same key, document edit), you have a real invalidation problem: the URL is stable but the content changed.
- **Practitioner patterns:** (a) **immutable keys** — never overwrite; a new upload = a new key, update the DB pointer (mirrors field-04 §6 "random key, filename in metadata"); (b) **cache-bust query string** (`?v=<updated_at>`) on the URL you hand out — cheap but pollutes the cache and some CDNs ignore query strings in the cache key by default; (c) **short TTL** on mutable user content + long TTL only on truly-immutable derivatives (thumbnails keyed by content hash).
- **TASTE:** prefer **immutable-key + DB-pointer** for user content. It makes both CDN invalidation AND concurrent-edit races disappear. Overwriting an object in place is the root of most "stale avatar" bugs.

## 6. Distilled cache rules (for shelf's brain)

1. **Default to content-hashed immutable URLs; never purge for normal deploys.**
2. Two-tier `Cache-Control`: `immutable, max-age=31536000` for hashed assets; `no-cache`/short for the pointer (HTML/API).
3. For user uploads: **immutable keys + DB pointer**, not overwrite-in-place.
4. If you must purge: it's **eventually consistent (10-60s)**, capped (**15 concurrent**), and wildcards risk **origin stampede** — use Cache Tags / surrogate keys, not `/*`.
5. Remember CloudFront **won't notice an S3 object changed** — TTL or explicit invalidation only.

## Open / unconfirmed (→ GAPS-AND-DISPUTES)
- Most CDN cache-invalidation material in currency window is *guide/best-practice* content, not a single dramatic dated production-postmortem. The mechanisms (propagation delay, 15-cap, stampede) are confirmed by AWS docs/re:Post; I could not find one canonical "the day our `/*` invalidation took down origin" first-person writeup within 6 months — flagged for GAPS.
- The 10-60s propagation figure and 15-path cap are widely cited and match AWS docs historically; a human should confirm against *current* CloudFront quotas (AWS occasionally raises these).
