---
title: "Field Intel 02 — Upload-Without-Validation: RCE, Stored XSS, SVG SSRF, Zip Bombs"
type: source
created: 2026-06-16
tags: [field-intelligence, security, file-upload, xss, ssrf, rce, cve]
summary: "Real 2025-2026 CVEs where file upload validation failed. The recurring root cause: Content-Type-header trust, no magic-byte check, and the SVG/polyglot footgun."
sources_meta: "GitHub Security Advisory API (gh) + firecrawl + WebSearch, June 2026. CVE IDs + publish dates verbatim."
---

# Field Intel 02 — Upload-Without-Validation Disasters (2025-2026)

> The single most common file-handling vuln class. Every entry below is a real CVE/advisory with a date.
> The lesson repeats so often it's almost monotonous: **never trust the client-supplied Content-Type; never trust the extension; validate magic bytes; never render SVG from your own origin.**

## 1. CVE-2026-40487 — Postiz Stored XSS via upload validation bypass (THE June-2026 exemplar)

- **Published 2026-04-18. CVSS 8.9 (High). Affects all Postiz < 2.21.6; fixed in 2.21.6.** Postiz = an AI social-media scheduling tool. Source: TheHackerWire <https://www.thehackerwire.com/postiz-stored-xss-via-file-upload-validation-bypass-cve-2026-40487/> (scraped via firecrawl, 2026-06-16).
- **Mechanism (verbatim):** *"The application fails to properly validate the actual content type of uploaded files, instead relying on the user-supplied `Content-Type` header. An attacker can spoof this header to bypass server-side checks, allowing the upload of files like `.html` or `.svg` with malicious content."*
- **The two-layer footgun — why this is the most instructive bug:** *"Once uploaded, the files are served by nginx. Crucially, nginx derives the `Content-Type` for these files from their original extension (e.g., `text/html` for `.html`, `image/svg+xml` for `.svg`). This behavior ensures the browser interprets the uploaded content as intended, executing any embedded scripts in the context of the application's origin, thus enabling Stored XSS."*
  - **TASTE / lesson:** the *upload* layer trusted the request header; the *serving* layer (nginx) re-derived Content-Type from the extension. The attacker controlled BOTH the header (to pass validation) and the extension (to control how it's later served). You must sanitize at BOTH ends — validation at write, and forced `Content-Type` + `Content-Disposition: attachment` at read. One-sided defense fails.
- **Blast radius (verbatim):** *"session riding, account takeover, and full compromise of other users' accounts."* Low privilege (PR:L) authenticated user is enough. Postiz also had a *sibling* CVE-2026-34577 (unauthenticated SSRF via URL proxy) — file-handling surfaces cluster vulnerabilities.

## 2. CVE-2025-61681 — Kuno CMS Stored XSS via SVG upload (Content-Type-only validation)

- **Published 2025-10-03. Severity Moderate.** GHSA-q3w2-2vqp-gx3r. Source: GitHub Security Advisory API via `gh api repos/xuemian168/kuno/security-advisories` (2026-06-16). <https://github.com/xuemian168/kuno/security/advisories/GHSA-q3w2-2vqp-gx3r>
- **Root-cause audit findings (verbatim from advisory):**
  - *"File type validation relies solely on `Content-Type` request headers (can be spoofed/bypassed)"*
  - *"No file content (magic number/structure) analysis performed"*
  - *"No whitelist of allowed file extensions configured"*
- **Attack (verbatim):** *"Construct SVG payload with event handlers; disguise as `.png` on frontend."* The `.svg.png` / double-extension trick (also documented by LazyHackers <https://lazyhackers.in/article/file-upload-rce-polyglot-imagetragick-svg-xss>).

## 3. CVE-2025-61768 — Kuno CMS SSRF via SVG `xlink:href` (the SVG-is-not-an-image lesson)

- **Published 2025-10-06. Severity Medium.** GHSA-4f5f-2c49-5mwm. Same repo, different upload bug — proof that SVG is a *document format*, not an image. Source: same `gh api` call. <https://github.com/xuemian168/kuno/security/advisories/GHSA-4f5f-2c49-5mwm>
- **Mechanism (verbatim):** *"The application's sanitizer or processor for SVG files does not adequately restrict or validate external resources referenced within the SVG's XML structure, specifically via elements like `<image xlink:href="...">`. When the server processes or renders the uploaded malicious SVG file, it follows the xlink:href directive, making an HTTP request to the specified external domain or internal IP address. This turns a standard file upload feature into an SSRF vector."*
- **PoC payload (verbatim):**
  ```xml
  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <image xlink:href="http://xxx.xxx.xxx.xxx:2333" />
  </svg>
  ```
- **TASTE:** an SVG can XSS the browser (client) AND SSRF the server (if server-side rendered, e.g. for thumbnailing). It is the single most dangerous "image" upload. The strong opinion practitioners hold: **never accept SVG uploads from untrusted users; if you must, rasterize to PNG server-side in a sandbox and discard the original, or serve from a sandboxed cookieless domain with a strict CSP.**

## 4. ImageTragick / ImageMagick delegate RCE — still alive in 2025

- The original ImageMagick "delegate" command-injection class (CVE-2016-3714 et al, "ImageTragick" <https://imagetragick.com/>) remains exploitable wherever services process user-submitted images via ImageMagick. INE/Mail.Ru's finding: *"Insufficient filtering for filename passed to delegate's command allows remote code execution… due to insufficient %M param filtering it is possible to conduct shell command injection."* (<https://ine.com/blog/imagetragick-a-tragick-image-conversion-tale>).
- **2025 currency:** Sourcery's vuln DB ("Malicious Image Upload Leading to Code Execution" <https://www.sourcery.ai/vulnerabilities/image-upload-code-execution>) and the `barrracud4/image-upload-exploits` repo <https://github.com/barrracud4/image-upload-exploits> (curated polyglot/exploit media for pentests) confirm image-processing RCE is an *active* surface, not historical. **Lesson: if you run any server-side image transform on user input, the transform library is now part of your attack surface; pin versions, disable risky delegates (`policy.xml`), run in a sandbox.**

## 5. Polyglot files & MIME bypass — the validation-is-hard class

- **Polyglot (verbatim from WebSearch synthesis of LazyHackers/Hackviser):** *"Attackers create files that are valid in multiple formats, such as a file that is both a valid JPEG image and an executable script… these polyglot files can pass image validation checks while still containing executable code."* Sources: OWASP Unrestricted File Upload <https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload>; Hackviser <https://hackviser.com/tactics/pentesting/web/file-upload>.
- **Bypass techniques catalogued (2025):** double extension (`shell.php.jpg`), null-byte, content-type spoof, `.htaccess` upload to re-map handlers, magic-byte prefix + appended payload. DEV "File Upload Vulnerabilities 2025" <https://dev.to/karthiks2116/file-upload-vulnerabilities-2025-55di>.
- **The hard truth (taste):** magic-byte validation defeats naive polyglots but NOT a file that is genuinely-valid-as-image-AND-malicious-when-interpreted-otherwise. The robust defense is *defense-in-depth*: (a) magic-byte allowlist, (b) re-encode/transcode the file (a re-encoded JPEG strips appended payloads), (c) store outside webroot / on a separate origin, (d) serve with forced safe `Content-Type` + `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`, (e) random server-generated filenames (never echo user filename into a path → see field-03 path-traversal).

## 6. Zip bombs / decompression bombs — the "upload eats your disk/RAM" DoS

- A zip bomb is a small archive that expands to terabytes (the classic `42.zip` = 42KB → 4.5PB). Any service that auto-extracts user uploads (avatars-in-zip, document-import, build-artifact upload) without a *decompressed-size cap* and *ratio cap* is a one-request DoS.
- **Defenses (practitioner consensus):** stream-decompress with a hard byte ceiling and an entry-count ceiling; reject compression ratios > N; never extract to a tmpfs/RAM disk without a quota; treat nested archives as hostile (recursive bombs). (Synthesized from OWASP file-upload guidance + general security corpus; flagged as well-established rather than single-source.)
- **TASTE:** "validate the file" usually means content-type/extension to most devs. Senior practitioners also validate *resource consumption*: decompressed size, image pixel dimensions (a 50,000×50,000 "decompression bomb" PNG is ~tiny on disk but OOMs your image library — "pixel flood"), and processing time.

## 7. Cross-cutting recurring root causes (the pattern the data screams)

| # | Root cause | Seen in |
|---|-----------|---------|
| 1 | Trust the client-supplied `Content-Type` header | Postiz CVE-2026-40487, Kuno CVE-2025-61681 |
| 2 | No magic-byte / file-structure check | Kuno CVE-2025-61681 |
| 3 | Serve user uploads from the app's own origin (cookie/CSP context) | Postiz (nginx re-derives type) |
| 4 | Treat SVG as a safe image | Kuno XSS + SSRF (both) |
| 5 | Server-side render/transform untrusted media | ImageTragick, Kuno SSRF |
| 6 | No decompressed-size / pixel-dimension cap | zip bombs, pixel-flood |

## 8. The canonical safe-upload recipe (distilled for shelf's brain)

1. **Validate by magic bytes + allowlist**, never by header or extension.
2. **Generate a random server-side key**; never put the user's filename in a filesystem/S3 path.
3. **Re-encode** images server-side (strips polyglot payloads + EXIF); **rasterize SVG → PNG** or refuse SVG.
4. **Serve uploads from a separate cookieless domain** (e.g. `usercontent.example.net`), with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, a forced safe `Content-Type`, and a restrictive CSP.
5. **Cap everything:** max upload size, max decompressed size, max pixel dimensions, max processing time.
6. **Run media transforms in a sandbox** (E2B / restricted container); disable ImageMagick risky delegates via `policy.xml`.
7. **For direct-to-S3/R2 presigned uploads:** constrain the presigned PUT with `Content-Type` and `content-length-range` conditions in the POST policy so the client can't upload an arbitrary type or a 5TB object (see field-03).

## Open / unconfirmed (→ GAPS-AND-DISPUTES)
- TheHackerWire's CVE-2026-40487 article is AI-generated ("THW AI Reporter") from public disclosures — the *mechanism* matches the standard pattern and the CVE/CVSS/fix-version are checkable, but I could not independently read the upstream GitHub advisory text (Postiz/gitroomhq advisory not returned by my `gh` query). Treat the nginx-re-derivation detail as high-confidence-but-single-source.
- Zip-bomb and pixel-flood defenses are well-established community consensus (OWASP), not tied to one fresh 2026 postmortem — included as durable knowledge, flagged as such.
