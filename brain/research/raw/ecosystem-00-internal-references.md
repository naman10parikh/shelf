---
title: "Internal References — Energy storage/asset conventions + checklist Storage section"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, internal, storage]
researcher: ecosystem (CP123 Wave-R)
---

# Internal References (READ-ONLY, quoted)

These are the Energy-fleet conventions `shelf` must align with. Quoted verbatim from read-only
corpus; not edited.

## 1. Harness Checklist — Object storage / CDN / file uploads section

Source: `~/energy/audit/HARNESS-CHECKLIST-2026.md` lines 339-343 (file dated 2026; the
fleet's canonical "what a complete harness needs" spec).

> ### Object storage / CDN / file uploads
> User-generated content, assets, exports.
> **Default:** **Cloudflare R2** (no egress fees). Alts: **AWS S3**, **UploadThing** (DX upload
> component on S3/R2), **Supabase Storage**, **Bunny** (CDN). **GAP.**
> _Source: a sibling project STACK.md (R2 vs Vercel Blob comparison)._

Also line 79 (component matrix): "**Object storage / CDN / file uploads** — Cloudflare R2 / AWS S3 /
UploadThing / Supabase Storage — **GAP**". Line 398: "Product · C2 infra | Object storage/uploads |
❌ **GAP** — no R2/S3/UploadThing".

**Implication for shelf:** the fleet has *no* storage employee today. shelf is meant to fill this
GAP. The fleet's stated default is R2-first (egress economics), with S3 as the portable baseline and
UploadThing as the DX layer. a sibling project's STACK.md already did an "R2 vs Vercel Blob" comparison —
worth aligning shelf's recommendation to that prior decision.

## 2. Energy asset/screenshot handling conventions

Sources:
- `~/energy/.claude/rules/wikimem-chrome-fallback.md` lines 19-28, 54
- `~/energy/.claude/rules/test-before-build.md` line 31
- Directory listing of `~/energy/content/screenshots/`

Convention: **local-first, disk-first, path-by-date**. Screenshots/audit assets are written under
`~/energy/content/screenshots/<audit-name>-<date>/` and referenced by absolute path in
reports. Quote (wikimem-chrome-fallback.md L54): *"Saving screenshots anywhere other than
`~/energy/content/screenshots/wikimem-audit-<date>/`. The path convention matters for the
chairman's review flow."* This is an **anti-pattern to avoid** — i.e., DO save to the convention path.

The live `content/screenshots/` dir has ~20 dated subdirs (armory-qa, cp121-panel,
rocket-tuser-2026-06-11, etc.) — confirming the date-stamped-subdir pattern is real and active.

## 3. Memory rule — disk-first, never browser localStorage (relevant to upload pipelines)

Source: MEMORY.md index entries `feedback_chrome_mcp_durable_storage`,
`feedback_localstorage_crashes_chrome_mcp`.

> "Chrome MCP bulk capture must persist to disk first — Write raw payload to `resources/unread/`
> immediately after first successful capture; never rely on browser localStorage as durable storage."
> "localStorage in Chrome MCP scrapes can crash the renderer — disk-first batches via `Write`, never
> `localStorage.setItem`."

**Implication for shelf:** the fleet's hard-won lesson is *the client is not durable storage*. For a
storage harness this maps directly to: **never treat the browser/client as the source of truth; the
object store is.** Presigned-PUT-then-confirm-server-side patterns align with this.

## 4. .env.example storage-adjacent keys already present

Source: `~/shelf/.env.example` (inherited from Energy).

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase Storage is reachable
  with these (it's S3-compatible as of 2024+).
- No `R2_*`, `AWS_*`, `S3_*`, `UPLOADTHING_TOKEN`, `TIGRIS_*`, `B2_*` keys yet — these will need to
  be added when shelf wires a concrete backend. (Flagged for the builder.)
- `BROWSERBASE_API_KEY` / `FIRECRAWL_API_KEY` present (research tooling).

## Net takeaway for shelf's POV

1. R2-first is the fleet's stated default — lead the recommendation there, justify with egress math.
2. S3 API compatibility is the portability contract — every backend shelf recommends should speak the
   S3 API so the harness isn't locked in.
3. Disk-first / server-confirmed durability is a fleet value — presigned-upload + server-side-confirm,
   not client-trusted writes.
4. Date-stamped path conventions are how the fleet organizes assets — shelf's key-naming guidance
   should echo that (`<scope>/<date>/<hash>.<ext>`).
