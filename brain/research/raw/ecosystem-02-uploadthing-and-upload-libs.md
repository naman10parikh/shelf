---
title: "Upload DX layers — UploadThing v7, Uppy, FilePond, react-dropzone (June 2026)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, upload, uploadthing, uppy, dx]
researcher: ecosystem (CP123 Wave-R)
---

# Upload DX layers (the "don't hand-roll the client" tier) — June 2026

## UploadThing (pingdotgg/uploadthing)

**Stats (gh, 2026-06-16):** 5,151★, TypeScript, last push 2026-04-15. Active. Theo/t3.gg's product;
built on S3/R2 under the hood, sells DX + a hosted control plane. Pricing from **$10/mo**; free tier
2GB. Source: <https://docs.uploadthing.com>, <https://sourceforge.net/software/product/UploadThing/>.

**v7 deltas (the migration that bites people):** Source: <https://docs.uploadthing.com/v7> (Migrate v6→v7).
- **Resumable uploads via `createUpload()`** from `uploadthing/client` — pause/resume "as long as the
  presigned URL is still valid." This is UploadThing's answer to tus *without* implementing tus. Means
  "resumable" now has a non-tus camp (vendor-resumable). Verify presigned-URL TTL bounds the resume
  window — a long pause past TTL = unrecoverable, a real footgun.
- **REST API moved to `api.uploadthing.com`** (old `uploadthing.com/api` now 302-redirects). **Explicit
  path-based versioning** — the `x-uploadthing-version` header is no longer required. Migration breakage:
  hardcoded old base URLs + code that sets the version header.
- `UTApi` is the server-side helper (`uploadthing/server`) for server-initiated uploads, deletes,
  listing, signed-URL generation. Source: <https://docs.uploadthing.com/api-reference/ut-api>.

**Honest trade-off:** UploadThing is a *managed layer over* object storage — you pay for DX + their
control plane, and you're somewhat coupled to their API. The checklist explicitly lists it as the "DX
upload component on S3/R2" option, NOT the storage itself. For shelf: recommend as the fastest path to
a working upload UI; recommend R2-direct + presigned for control/cost. Self-hosting UploadThing's full
stack is not a well-trodden path (search did not surface a clean self-host guide; treat as
managed-only). **GAP: self-host story unconfirmed.**

## Uppy (transloadit/uppy) — the dominant front-end widget

**Stats (gh, 2026-06-16):** **30,826★**, last push 2026-06-16 (today — very active). The
batteries-included uploader UI. Maintained by Transloadit (who also maintain tus). The reason most
teams don't hand-roll: dashboard UI, drag-drop, webcam/screen-capture, image editor, retry/resume,
progress, golden-retriever (restore after refresh) all built in.
- `@uppy/tus` → tus resumable backend.
- `@uppy/aws-s3` → presigned S3 multipart directly (no tus server needed). This plugin in 2024+ unified
  the old separate `aws-s3-multipart` plugin — verify you're on the merged plugin, old tutorials
  reference the deprecated split.
- `@uppy/companion` → server component for remote sources (import from Drive/Dropbox/URL) + signing.
Source: <https://github.com/transloadit/uppy>, <https://uppy.io>.

**Taste:** Uppy is the pragmatic default for a real upload UI. Pair `@uppy/aws-s3` with an R2/S3
presigned endpoint and you get resumable multipart with zero custom client code.

## Lighter front-end libs (when you don't want Uppy's weight)

Verified stars via `gh search --topic=file-upload --sort=stars` (2026-06-16):
- **FilePond** (pqina/filepond) — **16,372★**, last push 2026-06-04. Flexible, fun, great image preview
  + client-side transforms; plugin ecosystem. Best "pretty + light" choice.
- **react-dropzone** (react-dropzone/react-dropzone) — **10,985★**, push 2026-02-10. Just the drag-drop
  zone primitive (no upload logic) — you wire the PUT yourself. Most-used React primitive.
- **Dropzone.js** (dropzone/dropzone) — 18,377★ but **last push 2024-07-15** (stale-ish; classic, but
  flag the cadence). 
- **formidable** (node-formidable/formidable) — 7,177★, push 2026-05-18. The Node *server-side*
  multipart/form-data parser — relevant when you accept uploads *through* your server instead of
  direct-to-bucket.
- **compressorjs** (fengyuanchen) — 5,913★ — client-side image compression before upload (cut bytes at
  the source). Pairs well with any uploader.

## The architectural fork shelf must articulate

There are exactly three upload architectures, and the agent should pick deliberately:
1. **Direct-to-bucket via presigned** (browser → S3/R2). Cheapest, no upload bandwidth through your
   server, but you lose the chance to validate/scan synchronously (must do it async post-upload).
   Best with `@uppy/aws-s3` or a small custom fetch.
2. **Through-your-server** (browser → your API → bucket). Lets you validate/scan/transform inline, but
   your server eats the bandwidth + memory (use streaming, `formidable`/busboy, never buffer whole
   files). Doesn't scale for large/many files.
3. **Managed (UploadThing / Uppy+Companion / Transloadit).** Fastest to ship, ongoing cost, some
   lock-in. Best when speed-to-market > cost/control.

## GAPS / unconfirmed
- UploadThing self-host viability (no clean guide found).
- Whether `@uppy/aws-s3` multipart works against R2/Tigris/B2 without quirks (S3-compat is usually fine
  but CORS + multipart-complete edge cases vary — must test per provider).
