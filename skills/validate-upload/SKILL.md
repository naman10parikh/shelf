---
name: validate-upload
description: Validate an upload the way a senior engineer does — by MAGIC BYTES (never the client Content-Type or extension), with resource-consumption caps (decompressed size + ratio + pixel dims + time, not just type), a random server-side key (never the user's filename), and a hard REFUSAL of SVG from untrusted users. Use before accepting any user file.
trigger: When validating a user upload, accepting an avatar/image/document, handling SVG, or hardening an upload endpoint against stored XSS / SSRF / zip-bomb / path-traversal.
---

# validate-upload — magic bytes not headers, cap resource use, random keys, refuse SVG

> **The stance (brain O-02 / O-13 / O-10):** **NEVER trust the client** — not the filename, not the
> `Content-Type` header, not the extension. The object store + server-side re-validation is the only
> source of truth. "Validate the file" means magic-byte structure **AND** what the file does to your
> machine (decompressed size, compression ratio, pixel dimensions, time) — not content-type alone.
> Source of truth: `brain/OPINIONS.md` **O-02 / O-13 / O-10**, `brain/BATTLE-TESTED-SCENARIOS.md`
> **S4 / S5 / S15 / S13**, `brain/KNOWN-PITFALLS.md` **P-07 / P-09 / P-11 / P-12 / P-15**.
> Run `shelf explain O-02` for the full stance.

## Trigger

An upload endpoint accepts user files, OR an attacker uploaded an `.html` renamed `cat.png` with spoofed
`Content-Type: image/png` and it stored as a "PNG" (S4/P-07), OR an SVG triggered server SSRF to
`169.254.169.254` (S5/P-09), OR a 40 KB zip OOM-killed the import worker (S15/P-11).

## Steps

1. **Sniff magic bytes, not headers.** `shelf validate <file> --allow png,jpeg,pdf --json`. shelf uses
   `file-type` to read the actual byte signature and rejects a file whose structure doesn't match the
   allowlist — the request `Content-Type` and the `.ext` are attacker-controlled and ignored (O-02/P-07).
2. **Refuse SVG from untrusted users.** SVG is an XML *document*, not an image — it XSSes the browser via
   event handlers and SSRFs the server when rendered for thumbnailing (O-10/S5/P-09). `shelf validate`
   refuses it; if you truly must accept it, rasterize-to-PNG in a sandbox and discard the original — never
   "sanitize it lightly," never server-side-render raw user SVG.
3. **Cap resource consumption, not just type** (`--max-bytes --max-pixels --max-ratio`). A 42 KB zip
   expands to 4.5 PB; a 50,000×50,000 PNG is tiny on disk but OOMs the decoder (O-13/S15/P-11). Cap
   decompressed size + entry count + compression ratio + pixel dims + processing time; treat nested
   archives as hostile.
4. **Generate a random server-side key — never echo the user filename into the object key.** That single
   move kills path-traversal (`../../etc`), the non-ASCII encoding-mismatch class (`Письмо.pdf` → sign-
   time ≠ upload-time → "No file found"), and overwrite-in-place cache staleness at once (P-12/P-15/S13).
   Store the original filename in metadata/DB; set `Content-Disposition: attachment; filename*=UTF-8''...`
   on download.
5. **Pair with read-side defense.** Validation on upload is only half — the serving layer must force a
   safe `Content-Type` + `attachment` + `nosniff` (see the `safe-serve` skill / O-11). One-sided defense
   is no defense (S4 is two-sided).

## Output

A pass/fail verdict per file with the detected real type, the matched/rejected rule, and (on reject) the
specific reason (wrong magic bytes / SVG-refused / oversize / ratio-exceeded / pixel-flood). Exit code is
load-bearing: **non-zero on reject, 0 on a valid allowed file.** Verify: `shelf validate
eval/fixtures/fake.png --json` exits non-zero (an `.html` magic-byte reject) and
`shelf validate eval/fixtures/hello.png` exits 0 (a real PNG).

## Anti-patterns (refuse these)

- Validating by the request `Content-Type` header or the `.ext` (the #1 CVE root cause — Postiz
  CVE-2026-40487, Kuno CVE-2025-61681; P-07).
- "SVG is an image format, allow it" (O-10/P-09) — it's a document; refuse or rasterize-in-sandbox.
- Checking type but not resource consumption (zip bomb / pixel flood — O-13/P-11).
- Putting the user's filename in the object key (P-12/P-15) — random UUID key, filename in metadata.
