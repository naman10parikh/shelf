---
name: safe-serve
description: Serve user files safely on BOTH sides — write-side magic-byte validate + read-side forced Content-Type + Content-Disposition attachment + nosniff + cookieless domain + CSP (one-sided defense is no defense), and DON'T invalidate the CDN on deploys — change the URL (content-hashed immutable assets + no-cache pointer). Use when configuring how uploaded files are served / cached.
trigger: When configuring how user uploads are served, setting CDN cache headers, debugging stale assets after a deploy, or hardening the serving layer against stored XSS.
---

# safe-serve — two-sided headers, change-the-URL-not-invalidate

> **The stance (brain O-11 / O-20 / O-03):** sanitize at BOTH the write side AND the read side — the most
> instructive bug in the corpus (Postiz CVE-2026-40487) failed *because* defense was one-sided. And for
> delivery: **don't invalidate the CDN for normal deploys — change the URL.** Content-hashed immutable
> assets + a no-cache pointer collapse the entire invalidation problem (propagation delay, the 15-path
> cap, the origin stampede) to zero.
> Source of truth: `brain/OPINIONS.md` **O-11 / O-20 / O-03**, `brain/BATTLE-TESTED-SCENARIOS.md`
> **S4 / S12**, `brain/KNOWN-PITFALLS.md` **P-08 / P-31 / P-32 / P-33 / P-34**.
> Run `shelf explain O-11` for the full stance.

## Trigger

User uploads are about to be served, OR a stored-XSS got through because the serving layer re-derived
`Content-Type` from the extension (S4/P-08), OR after a deploy users still see the old asset / an edited
S3 object keeps serving stale because the CDN didn't notice it changed (S12/P-31).

## Steps

1. **Emit the two-sided safe-serve config.** `shelf serve-config --bucket B --json` produces the read-side
   headers: a **forced** safe `Content-Type` (never derived from the extension), `Content-Disposition:
   attachment`, `X-Content-Type-Options: nosniff`, a restrictive CSP, and serving from a **separate
   cookieless domain** (O-11/S4). This is the read half; the write half is the `validate-upload` skill
   (magic-byte validate + random key) — you need **both** (P-08; one-sided defense is no defense).
2. **Set the two-tier CDN cache policy** (O-20/S12/P-33): content-hashed immutable assets get
   `Cache-Control: max-age=31536000, immutable`; the HTML/API **pointer** that references them gets
   `no-cache`/short-TTL. The pointer must NOT be heavily cached or users load old hashed names (P-33).
3. **Change the URL, don't purge.** New content = a new key/URL → no 10–60s propagation window, no
   `TooManyInvalidationsInProgress` 15-path cap, no `/*` origin thundering herd (O-20/P-31/P-32). For
   user uploads that change (avatar, edited doc): **immutable key + DB pointer** (a new upload is a new
   key + a pointer update), never overwrite-in-place (O-03/P-34).
4. **Reserve purge for emergencies only** — pulling leaked/illegal content — via Cache Tags / surrogate
   keys, never `/*` on a deploy (O-20/P-32).
5. **Put a CDN in front of every hot byte** and never proxy file bytes through your own serverless
   function (the 6 MB Lambda / 29s API-Gateway wall) — direct-to-storage upload, CDN-fronted download
   (O-04).

## Output

A serve configuration: the read-side header set (forced type + attachment + nosniff + CSP + cookieless
domain) plus the two-tier CDN cache policy (immutable hashed assets + no-cache pointer) and the
change-the-URL guidance. Verify: `shelf serve-config --bucket X --json` emits parseable JSON containing
the forced-Content-Type + `Content-Disposition: attachment` + `nosniff` headers and the
`max-age=31536000, immutable` / `no-cache` two-tier policy.

## Anti-patterns (refuse these)

- Validating only on upload and trusting the serving layer (S4/P-08) — the bug is two-sided; force the
  type + attachment + nosniff on serve.
- Letting nginx/the CDN re-derive `Content-Type` from the `.ext` (`.html`/`.svg` then execute — P-08).
- `aws cloudfront create-invalidation --paths '/*'` on every deploy (S12/P-32) — change the URL instead.
- Overwrite-in-place on a stable key for mutable user content (stale CDN + concurrent-edit races —
  O-03/P-34); use immutable keys + a DB pointer.
