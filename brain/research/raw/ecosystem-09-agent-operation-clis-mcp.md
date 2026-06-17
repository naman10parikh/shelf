---
title: "What an AGENT (not a human) needs to operate storage — CLIs, APIs, MCP servers (June 2026)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, agent, mcp, cli, rclone]
researcher: ecosystem (CP123 Wave-R)
---

# Agent-native storage operation — CLIs, APIs, MCP servers (June 2026)

This is the section that matters most for shelf (an *agent* employee). An agent's "hands" for storage
are CLIs + SDKs + MCP servers, not a web dashboard.

## MCP servers (the agent-native control plane)

### Cloudflare — official, the best-supported (matches fleet R2 default)
- `cloudflare/mcp-server-cloudflare` — **3,867★, last push 2026-06-08** (active). Cloudflare ships a
  **suite of hosted remote MCP servers** (Workers, R2, KV, D1, DNS, Workers AI). Source:
  <https://github.com/cloudflare/mcp-server-cloudflare>,
  <https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/>.
- **R2 object tools exposed:** `r2_list_buckets`, `r2_create_bucket`, `r2_delete_bucket`,
  `r2_list_objects`, `r2_get_object`, `r2_put_object`, `r2_delete_object`. Auth = Cloudflare API token,
  least-privilege per service; transport = HTTP (hosted) or stdio (local via `wrangler`). Source:
  <https://www.npmjs.com/package/@cloudflare/mcp-server-cloudflare>, antigravity.codes/mcp/cloudflare.
- **This is the cleanest agent path on the fleet's R2 default** — an agent can do full bucket+object
  CRUD over MCP with a scoped token. shelf should wire this in `.mcp.json`.

### AWS — official, but NOT object-CRUD focused
- `awslabs/mcp` — **9,281★, push 2026-06-17** (very active, the AWS MCP monorepo). Source:
  <https://github.com/awslabs/mcp>.
- The S3 server is **`s3-tables-mcp-server`** (announced 2025-07-15) — it targets **S3 Tables / Apache
  Iceberg** (create/query tables, generate tables from CSV, read-only SQL, metadata discovery), NOT
  general object PUT/GET. Source: <https://awslabs.github.io/mcp/servers/s3-tables-mcp-server>,
  <https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-s3-tables-mcp-server>. **Finding/GAP: there
  is no first-party AWS MCP for plain S3 object CRUD as of June 2026** — for that the agent uses the AWS
  CLI/SDK or a third-party S3 MCP.

### Generic S3-compatible MCP servers (fragmented, low-star, choose carefully)
- The general-purpose object-CRUD S3 MCP space is a **long tail of low/zero-star one-offs** (e.g.
  `tech4life87/s3mcpserver`, `diabloneo/s3-mcp` "access to S3-compatible storage",
  `TocharianOU/aws-s3-mcp`). **No clear community winner.** Source: `gh search repos "s3 mcp"`
  (2026-06-16). `diabloneo/s3-mcp` is notable for explicitly targeting *any* S3-compatible endpoint
  (works against R2/B2/Tigris/MinIO), but vet it before prod. **shelf may want to build/own a thin
  S3-compatible MCP** rather than depend on an unmaintained one — this is a genuine gap shelf could fill.
- `mcp.pipedream.com/app/cloudflare_r2` — Pipedream's hosted R2 MCP (managed, no self-host).

## CLIs (the agent's hands when there's no MCP)

- **`rclone`** — THE multi-backend CLI ("rsync for cloud storage"). v1.70.x (2026; patches through
  v1.70.3). Speaks S3, R2, B2, Tigris, GCS, Azure, MinIO, +60 backends. Agent-critical commands:
  - `rclone copy/sync` — multipart automatically for large files; `--s3-max-upload-parts`,
    `--b2-upload-concurrency` tune it.
  - **`rclone backend list-multipart-uploads <remote>:`** — list orphaned multiparts (the invisible
    cost). Pair with cleanup. Source: <https://rclone.org/changelog/>, <https://rclone.org/b2/>.
  - `--s3-no-check-bucket` — fewer ops/permissions (matters for least-privilege agent tokens).
  - v1.70.0 added providers MEGA, S4, Pure Storage FlashBlade.
  - **Best single tool for cross-provider migration** (the "move from S3 to R2" job) — `rclone sync`.
- **`aws` CLI** — `aws s3 cp` auto-multiparts files >8MB; `aws s3api` for presign
  (`aws s3 presign s3://bucket/key --expires-in 300`), multipart, lifecycle, object-lock. The agent's
  baseline for S3 + any S3-compatible endpoint (`--endpoint-url`).
- **`wrangler`** — Cloudflare's CLI; `wrangler r2 object put/get/delete`, `wrangler r2 bucket create`,
  and runs the CF MCP locally over stdio. The R2-native agent CLI.
- **`b2`** — Backblaze's official CLI (`b2 upload-file`, `b2 sync`). B2 is also reachable via the S3 CLI
  with `--endpoint-url`.
- **`s5cmd`** — very fast parallel S3 CLI (Go); good for bulk operations at scale where `aws s3` is slow.
- **`mc`** (MinIO Client) — speaks S3-compatible everywhere; nice for scripting + admin.

## SDKs (when the agent writes code)
- **AWS SDK v3 (JS)** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — the canonical way to
  generate presigned PUT/POST in Node. Works against R2/B2/Tigris with `endpoint` + `region:"auto"`.
- `@aws-sdk/lib-storage` `Upload` — handles multipart automatically (the "just upload this big buffer"
  helper). Use this instead of hand-rolling multipart.
- Python: `boto3` (+ `botocore`) — `generate_presigned_post` (verify the content-length-range bug,
  ecosystem-03), `upload_file` auto-multiparts.

## The agent's storage playbook (decision tree shelf should encode)
1. **Provider is R2** → prefer the **Cloudflare MCP** (`r2_*` tools) or `wrangler`; for migration use
   `rclone`. Presigned via AWS SDK v3 with `region:"auto"` + the R2 S3 endpoint. **Set CORS explicitly.**
2. **Provider is S3** → AWS CLI/SDK; no first-party object-CRUD MCP, so CLI or a vetted third-party MCP.
   For Iceberg/analytics over stored data → `s3-tables-mcp-server`.
3. **Any S3-compatible (B2/Tigris/MinIO)** → `rclone` / `aws --endpoint-url` / `diabloneo/s3-mcp`.
4. **Cross-provider migration** → `rclone sync` (or Tigris shadow buckets if moving *to* Tigris).
5. **Large/flaky uploads** → tusd server + tus client; agent drives it over HTTP (no MCP exists).
6. **Always:** abort-incomplete-multipart lifecycle rule (find orphans via
   `rclone backend list-multipart-uploads`).

## GAPS / unconfirmed
- No vetted, maintained, high-star general-purpose S3-object-CRUD MCP server exists — best candidate
  `diabloneo/s3-mcp` is unvetted. shelf may need to own one.
- Whether the Cloudflare R2 MCP supports presigned-URL *generation* as a tool (vs just CRUD) — not
  confirmed; verify (agents often need to *hand a URL to a user*, not stream bytes through MCP).
- rclone exact latest patch + whether v1.71 shipped by build time.
