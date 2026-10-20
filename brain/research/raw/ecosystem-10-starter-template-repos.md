---
title: "Best starter / template / example repos for storage + uploads (June 2026)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, starter-repos, templates, examples]
researcher: ecosystem (CP123 Wave-R)
---

# Best starter / template / example repos (June 2026)

All stars + last-push verified via `gh api` / `gh search` on 2026-06-16. Ranked by usefulness to shelf,
with honest "why / why not."

## Canonical tool repos (not "starters" but the things you build on)

| Repo | Stars | Last push | Why it's the reference |
|---|---|---|---|
| **transloadit/uppy** | **30,826** | 2026-06-16 | The dominant upload-UI widget. `@uppy/aws-s3` (presigned multipart) + `@uppy/tus` (resumable) + `@uppy/companion` (server/remote sources). If you want a real upload UI, start here. Very active. <https://github.com/transloadit/uppy> |
| **imgproxy/imgproxy** | **10,851** | 2026-06-12 | The self-host image-transform server. v4.0.0 (May 2026) added async pipeline + internal cache + RAW. Has examples/docker-compose in-repo. <https://github.com/imgproxy/imgproxy> |
| **tus/tusd** | **3,805** | 2026-06-16 | Reference resumable-upload server. `examples/` + docker images. v2.10.0 today. <https://github.com/tus/tusd> |
| **pingdotgg/uploadthing** | **5,151** | 2026-04-15 | The managed DX layer; the monorepo has framework examples (`examples/`) for Next/Expo/etc. v7 resumable. <https://github.com/pingdotgg/uploadthing> |
| **rclone/rclone** | (60k-class) | 2026 (v1.70.x) | The agent's cross-provider CLI. Not a starter, but THE migration/ops tool. <https://github.com/rclone/rclone> |

## Best actual STARTER / EXAMPLE repos

1. **uploadthing `examples/` (in pingdotgg/uploadthing)** — *the* fastest path to a working upload in
   Next.js/React/Expo/SolidStart/SvelteKit. Official, maintained, framework-matrix. **Why:** copy-paste
   working presigned-resumable upload + UI in minutes. **Why not:** couples you to UploadThing's hosted
   plane (not R2-direct). Best for "ship an upload UI today."

2. **vercel/storage** — **590★, push 2026-06-15** (active, official). Monorepo for Vercel Blob / KV /
   Postgres SDKs with **upload examples** (client-upload + server-upload patterns, presigned-style via
   Vercel Blob). **Why:** clean, current, Next-native reference for the client-upload vs server-upload
   fork. a sibling project's STACK.md already compared **R2 vs Vercel Blob** (per the internal checklist) — this
   repo is the Blob side of that decision. **Why not:** Vercel Blob is its own (pricier, egress-billed)
   product, not S3/R2. Read it for the *patterns*, not as the storage choice. <https://github.com/vercel/storage>

3. **anomalyco/sst** (formerly sst/sst) — **26,079★, push 2026-06-04** (very active; note the org
   rename to anomalyco — a real ownership signal to flag). **Why:** SST's `Bucket` construct + examples
   are the cleanest IaC-first way to stand up an S3 bucket with presigned-upload + Lambda triggers
   (the foundation for the virus-scan pipeline). Best "infrastructure-as-code, do it right" starter.
   **Why not:** AWS/CDK-centric; overkill if you just want R2 + a presign endpoint. <https://github.com/anomalyco/sst>

4. **rajeshdavidbabu/s3-upload-thing** — **115★, push 2024-10-12** (STALE — flag). A minimal Next.js +
   Uppy + AWS SDK presigned uploader. **Why:** small, readable, shows the direct-to-S3 presigned pattern
   end to end. **Why not:** 20 months stale; SDK + Uppy APIs have moved (Uppy merged the multipart
   plugin since). Use as a *concept reference*, not a copy-paste base. <https://github.com/rajeshdavidbabu/s3-upload-thing>

5. **ministryofjustice/opg-s3-antivirus** — (UK gov, maintained) — the cleanest real-world **S3 +
   ClamAV virus-scan** reference (incoming→scan→clean/quarantine, definitions updater, IaC). **Why:**
   production-grade, government-maintained, shows the full quarantine lifecycle that the archived
   `bucket-antivirus-function` no longer does. Best AV starter. <https://github.com/ministryofjustice/opg-s3-antivirus>

## Honorable mentions / primitives
- **pqina/filepond** (16,372★) — pretty, light upload UI with client-side image transform; great
  alternative to Uppy when you don't need resumable. <https://github.com/pqina/filepond>
- **react-dropzone/react-dropzone** (10,985★) — just the drag-drop zone; you wire the PUT. The minimal
  React primitive.
- **node-formidable/formidable** (7,177★) — server-side multipart parser for the through-your-server
  upload architecture (stream, don't buffer).
- **abhinavbom/clara** (34★, 2026-01) — ClamAV **+ YARA** S3 scanner; small but the most capable OSS AV
  option. <https://github.com/abhinavbom/clara>

## STALE / ARCHIVED — do NOT use as a base (but know they exist)
- **bluesentry/bucket-antivirus-function** (533★) — **ARCHIVED, last push 2024-04.** The once-canonical
  S3 ClamAV repo; everyone copied it; now unmaintained. Use `opg-s3-antivirus` or `clara` instead.
- **dropzone/dropzone** (18,377★) — push 2024-07; classic but cadence stalled.
- **ryanto/next-s3-upload** (592★) — push 2024-12; popular Next.js presigned-hook lib but ~18mo stale.

## shelf's recommended starting stack (synthesized taste)
- **Upload UI:** Uppy (`@uppy/aws-s3` for presigned multipart; add `@uppy/tus`+tusd only if you need
  resume-after-sleep). FilePond if you want lighter + no resume.
- **Storage:** R2 (fleet default) via AWS SDK v3 presigned POST (`region:"auto"`, R2 endpoint, **CORS
  set explicitly**).
- **Transforms:** Cloudflare Images transformation-flows (managed) or imgproxy v4 (self-host, signed).
- **AV:** `opg-s3-antivirus` pattern (or AWS GuardDuty Malware Protection for S3 if on AWS).
- **IaC:** SST/CDK or Terraform to wire bucket + lifecycle (abort-incomplete-multipart!) + triggers.
- **Agent ops:** Cloudflare MCP (`r2_*`) + rclone for migration.

## GAPS / unconfirmed
- No single high-star, current, R2-direct (not UploadThing) presigned-upload Next.js starter found —
  the freshest minimal ones are stale or low-star. shelf could publish one (gap to fill).
- Whether opg-s3-antivirus is generalizable off-AWS (it's AWS-specific).
