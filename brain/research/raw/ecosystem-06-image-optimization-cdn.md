---
title: "Image optimization / transforms + CDN — Cloudflare Images, imgproxy, Bunny (June 2026)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, images, imgproxy, cdn, cloudflare-images]
researcher: ecosystem (CP123 Wave-R)
---

# Image Optimization / Transforms + CDN (June 2026)

## The two camps: managed (Cloudflare Images / Cloudinary) vs self-host (imgproxy / Thumbor)

## Cloudflare Images (managed, R2-native)

**Pricing (2026):** **$5 / 100K images stored** + **$1 / 100K images delivered**, **no bandwidth/egress
fees.** Remote images (from R2/S3/your origin) use the **transformation meter**: first 5,000 unique
transforms free, then **$0.50 / 1,000** on Paid. Source:
<https://theimagecdn.com/docs/cloudflare-images-pricing>, <https://developers.cloudflare.com/images/pricing>.
3–5x cheaper than Cloudinary at scale per <https://leanopstech.com/blog/cloudflare-images-pricing-2026/>
(treat third-party cost comparisons as directional).

**Last-6-months deltas (active development):**
- **2026-05-27 — Transformation Flows (GA):** automated rules pairing **conditions** (file extension,
  URL path, query param) with **parameters**, applied to matching requests **without writing code or
  changing URLs.** Two kinds: *provider flows* (translate Fastly/other image-optimizer URLs to CF
  equivalents — migration tool) and *custom flows* (auto format-convert, responsive sizing). Quote:
  "automatically apply image optimization to matching requests on your zone without writing code or
  changing URLs." Source: <https://developers.cloudflare.com/changelog/post/2026-05-27-transformation-flows/>.
  **This is the big one for shelf** — it means image optimization can be a *zone config*, not a code
  dependency, and you can migrate off Fastly/Cloudinary without touching app URLs.
- **2026-06-16 (today) — new fit modes** `aspect-crop` (preserve target aspect ratio) and `scale-up`
  (always enlarge), plus an **`upscale` parameter for AI upscaling** (sharper enlargement). Source:
  CF community optimization-features post + WebSearch (2026-06-16)
  <https://community.cloudflare.com/t/cloudflare-images-new-optimization-features-in-images/934090>.
- Earlier 2026: overlay compositing / merging images (draw images on images) — confirmed via CF
  changelog index header (2026-06-16 fetch).

**Why it pairs with R2:** CF Images can transform images that *live in R2* (or S3, or any origin) via
the transformation meter — so shelf can store originals in R2 and serve optimized variants through CF
Images with zero egress and no separate processing server. This is the cleanest managed stack on the
fleet's R2-default.

## imgproxy (imgproxy/imgproxy) — self-host transform server

**Stats (gh, 2026-06-16):** **10,851★**, last push 2026-06-12. Very active. Fast (libvips), secure
(URL signing built-in), Go. The self-host default.

**Last-6-months deltas (MAJOR — v4 dropped):** Source: <https://github.com/imgproxy/imgproxy/releases>.
- **v4.0.0 (2026-05-13)** — headline release: **internal cache for processed images (pro)**,
  **async image downloading + processing** (throughput win), **digital-camera RAW format support
  (pro, load-only).** This is the biggest imgproxy change in a year — async pipeline + built-in cache
  reduce the need for an external cache layer in front. 
- v4.0.1–v4.0.5 (May 19 – Jun 12 2026) — maintenance: wide-gamut ICC profile fix (v4.0.5), AWS
  credentials lifetime fix with `IMGPROXY_S3_ASSUME_ROLE_ARN` (v4.0.4), cache-key fixes (pro),
  ML-inference deadlock fix (pro).
- v3.31.x (parallel maintenance branch, through June 2026) — `IMGPROXY_FAIL_ON_DEPRECATION` (v3.31.0,
  hard-fail on deprecated config — good CI guard), flip processing option, AWS assume-role credential
  fix (v3.31.4). Source: <https://github.com/imgproxy/imgproxy/releases/tag/v3.31.0>.
- v3.27.0 (earlier) — **JXL (JPEG XL) support** matured: `IMGPROXY_AUTO_JXL`, `IMGPROXY_ENFORCE_JXL`,
  `IMGPROXY_JXL_EFFORT`; AVIF speed default → 8; format-quality defaults `webp=79,avif=63,jxl=77`;
  `IMGPROXY_ENABLE_AVIF_DETECTION` → `IMGPROXY_AUTO_AVIF`. Source: newreleases.io/imgproxy v3.27.0.

**imgproxy gotchas an agent must know:**
- **URL signing is mandatory in prod.** Unsigned imgproxy = open image-proxy = SSRF + bandwidth-abuse
  vector. Always set `IMGPROXY_KEY` + `IMGPROXY_SALT` and sign URLs. (This is the #1 imgproxy
  misconfiguration.)
- **Source-URL allowlist** (`IMGPROXY_ALLOWED_SOURCES`) to prevent it fetching arbitrary internal URLs
  (SSRF into your VPC / cloud metadata endpoint).
- **AVIF encode is CPU-heavy** — `IMGPROXY_AVIF_SPEED` trades quality for CPU; default moved to 8
  (faster) in v3.27. Watch CPU on a self-host box under load.
- v4's async pipeline changes failure semantics — a download failure now surfaces differently; re-test
  error handling if you migrate v3→v4.

**Thumbor** is the older Python alternative (still alive, less active); imgproxy is the modern default.

## CDN layer

- **Cloudflare** — the fleet default; pairs with R2 ($0 egress) and CF Images. If you're on R2, you're
  effectively on Cloudflare's CDN already.
- **Bunny.net** — cited in the checklist as the CDN alt; cheap ($0.01–0.06/GB by region), has its own
  **Bunny Optimizer** (image transforms at the edge) + token auth for signed URLs. Best independent-CDN
  choice when not all-in on Cloudflare. (Checklist line 342 names Bunny.)
- **Fastly** — premium, image optimizer exists, but CF Images now offers *provider flows* to migrate
  off Fastly Image Optimizer (signal CF is targeting Fastly's image business).
- **AWS CloudFront** — default if you're on S3; signed URLs/cookies for private content.

## shelf recommendation (taste)
- **On the fleet's R2 default:** store originals in R2, serve via **Cloudflare Images transformation
  flows** (config-not-code) → simplest, cheapest, zero-egress.
- **If you must self-host transforms** (cost control at very high volume, on-prem, or want JXL/RAW
  control): **imgproxy v4** behind the CDN, with signing + source allowlist mandatory.
- Always serve user images from a **separate cookieless domain** (stored-XSS containment).

## GAPS / unconfirmed
- Exact list of CF Images "new fit modes" beyond aspect-crop/scale-up (changelog was <12h old at fetch).
- imgproxy v4 free-tier vs pro feature split for the internal cache (cache is marked "pro").
