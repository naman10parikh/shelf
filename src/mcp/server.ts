#!/usr/bin/env node
// server.ts — shelf's OWN MCP server (Component 7). NOT the inherited github/context7/memory/obsidian
// template, and NOT merely consuming the Cloudflare R2 MCP (that is a *lens* shelf uses on the R2 default,
// O-23; this server is what shelf *does*). Exposes the storage vertical's nine expertise operations,
// reusing the exact lib code the CLI uses (one source of truth — presigner / validate / keys / cost /
// recommendations / brain / observability), so the MCP and the CLI can never diverge.
//
// Dual-mode (PLAN §4 / HARNESS-OVERRIDES §7; MCP spec 2025-11-25 Streamable-HTTP):
//   - stdio (default)      — `shelf-mcp` / `node dist/mcp/server.js`  → local agent path (Claude Code).
//   - Streamable-HTTP      — `SHELF_MCP_HTTP=1 [SHELF_MCP_PORT=8790] node dist/mcp/server.js` → hosted path.
// The hosted transport is STATELESS (sessionIdGenerator: undefined) so any agent can POST a JSON-RPC
// request without a prior session handshake.
//
// presign_upload uses the AWS-SDK-v3 presigner (region:"auto" + R2 endpoint) so the bar NEVER depends on
// the R2 MCP minting URLs (V-12 unconfirmed). Backend creds may be ABSENT at grade time (D15): the
// presign/lifecycle tools then return an honest "no backend resolved" error, never a fake URL.

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  resolveTarget,
  presignPost,
  presignGet,
  type PresignPostResult,
  type PresignGetResult,
} from "../lib/presigner.js";
import { validateBytes, DEFAULT_ALLOW } from "../lib/validate.js";
import { estimateCost } from "../lib/cost.js";
import { WORKLOADS, pickBackend } from "../lib/recommendations.js";
import { searchBrain, explain } from "../lib/brain.js";
import { newTraceId } from "../lib/observability.js";
import { PutBucketLifecycleConfigurationCommand } from "@aws-sdk/client-s3";

// A tool result: a JSON text block (+ structuredContent so MCP clients get a typed payload). On failure
// we set isError so the agent sees the failure rather than a silent empty result.
type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function err(message: string): ToolResult {
  const payload = { ok: false, error: message };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload, isError: true };
}

/** Build the shelf MCP server with all nine tools registered. */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "shelf", version: "0.1.0" });

  // 1) presign_upload — POST policy by default (size+type bounded, S6); --put can't bound size (P-01).
  server.registerTool(
    "presign_upload",
    {
      description:
        "Mint a presigned upload URL. Default = POST policy (size+type bounded server-side, the gate PUT cannot give — O-14/S6). put:true returns a PUT URL with the loud 'PUT can't enforce size' warning (P-01).",
      inputSchema: {
        bucket: z.string(),
        key: z.string(),
        maxBytes: z.number().int().positive().optional(),
        contentType: z.string().optional(),
        ttl: z.number().int().positive().optional(),
        put: z.boolean().optional(),
      },
    },
    async ({ bucket, key, maxBytes, contentType, ttl, put }): Promise<ToolResult> => {
      try {
        const target = resolveTarget();
        const ttlSeconds = ttl ?? 300;
        if (put) {
          // PUT path: deliberately surfaced behind put:true with the can't-bound-size warning (P-01).
          const { presignPut } = await import("../lib/presigner.js");
          const res = await presignPut({ target, bucket, key, ttlSeconds, ...(contentType ? { contentType } : {}) });
          return ok({ ...res, backend: target.backend });
        }
        const res: PresignPostResult = await presignPost({
          target,
          bucket,
          key,
          maxBytes: maxBytes ?? 25 * 1024 * 1024,
          ttlSeconds,
          ...(contentType ? { contentTypePrefix: contentType } : {}),
        });
        return ok({ ...res, backend: target.backend });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // 2) presign_get — short-TTL bearer GET (O-15).
  server.registerTool(
    "presign_get",
    {
      description: "Mint a short-TTL presigned GET URL (signed-URL access control). A bearer capability — keep TTL short (O-15/P-06).",
      inputSchema: { bucket: z.string(), key: z.string(), ttl: z.number().int().positive().optional() },
    },
    async ({ bucket, key, ttl }): Promise<ToolResult> => {
      try {
        const target = resolveTarget();
        const res: PresignGetResult = await presignGet({ target, bucket, key, ttlSeconds: ttl ?? 300 });
        return ok({ ...res, backend: target.backend });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // 3) validate_file — magic-byte + resource-consumption pipeline; refuses SVG-from-untrusted (O-02/O-13).
  server.registerTool(
    "validate_file",
    {
      description:
        "Validate bytes by MAGIC BYTES (not the client header/extension — O-02/P-07) + resource-consumption caps (size/pixels/ratio — O-13/P-11); refuses SVG-from-untrusted (O-10/P-09). Pass a base64 'bytes' or a local 'path'.",
      inputSchema: {
        path: z.string().optional(),
        bytes: z.string().optional().describe("base64-encoded file bytes (alternative to path)"),
        allow: z.array(z.string()).optional(),
        maxBytes: z.number().int().positive().optional(),
        maxPixels: z.number().int().positive().optional(),
        maxRatio: z.number().positive().optional(),
      },
    },
    async ({ path, bytes, allow, maxBytes, maxPixels, maxRatio }): Promise<ToolResult> => {
      try {
        let buf: Buffer;
        if (bytes) buf = Buffer.from(bytes, "base64");
        else if (path) buf = await readFile(path);
        else return err("provide either 'path' (a local file) or 'bytes' (base64)");
        const result = await validateBytes(buf, {
          ...(allow ? { allow } : {}),
          ...(maxBytes !== undefined ? { maxBytes } : {}),
          ...(maxPixels !== undefined ? { maxPixels } : {}),
          ...(maxRatio !== undefined ? { maxRatio } : {}),
        });
        // ok:false is a VALID validation verdict (a rejected file), not a tool error — return it plainly so
        // the agent sees the reasons. (Unlike presign, where ok:false means the operation failed.)
        return ok({ allowDefault: DEFAULT_ALLOW, ...result });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // 4) set_lifecycle — the day-one abort-incomplete-multipart rule (O-17/S11).
  server.registerTool(
    "set_lifecycle",
    {
      description: "Set the abort-incomplete-multipart-uploads lifecycle rule on a bucket (the #1 invisible-bill defense — O-17/S11).",
      inputSchema: { bucket: z.string(), abortAfterDays: z.number().int().positive().optional() },
    },
    async ({ bucket, abortAfterDays }): Promise<ToolResult> => {
      try {
        const target = resolveTarget();
        const days = abortAfterDays ?? 7;
        const rule = {
          ID: "shelf-abort-incomplete-multipart",
          Status: "Enabled" as const,
          Filter: { Prefix: "" },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: days },
        };
        await target.client.send(
          new PutBucketLifecycleConfigurationCommand({ Bucket: bucket, LifecycleConfiguration: { Rules: [rule] } }),
        );
        return ok({ ok: true, bucket, abortAfterDays: days, backend: target.backend, rule });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // 5) find_orphans — hunt orphaned multiparts via rclone (P-24); honest no-remote fallback.
  server.registerTool(
    "find_orphans",
    {
      description: "Find orphaned multipart uploads (the invisible cost) via rclone backend list-multipart-uploads (P-24/S11).",
      inputSchema: { bucket: z.string(), remote: z.string().optional() },
    },
    async ({ bucket, remote }): Promise<ToolResult> => {
      const r = remote ?? process.env.RCLONE_REMOTE;
      if (!r) {
        return ok({ ok: false, bucket, reason: "no rclone remote configured", howto: `rclone backend list-multipart-uploads <remote>:${bucket}` });
      }
      const proc = spawnSync("rclone", ["backend", "list-multipart-uploads", `${r}:${bucket}`], { encoding: "utf8" });
      if (proc.error || proc.status !== 0) {
        return ok({ ok: false, bucket, remote: r, reason: "rclone unavailable", howto: `rclone backend list-multipart-uploads ${r}:${bucket}` });
      }
      return ok({ ok: true, bucket, remote: r, raw: proc.stdout.trim() });
    },
  );

  // 6) estimate_cost — egress-first bill + the R2-vs-S3 flip (O-01/O-05/O-28).
  server.registerTool(
    "estimate_cost",
    {
      description: "Egress-first storage cost estimate + the R2-vs-S3 flip math (mechanism gospel, number directional — O-01/O-05/O-28).",
      inputSchema: { egressGb: z.number().nonnegative(), storageGb: z.number().nonnegative(), provider: z.enum(["r2", "s3"]).optional() },
    },
    async ({ egressGb, storageGb, provider }): Promise<ToolResult> => {
      const est = estimateCost(egressGb, storageGb);
      if (provider === "r2") return ok({ ...est.r2, note: est.flipNote, caveat: est.caveat });
      if (provider === "s3") return ok({ ...est.s3, note: est.flipNote, caveat: est.caveat });
      return ok(est as unknown as Record<string, unknown>);
    },
  );

  // 7) pick_backend — per-workload recommendation + the flip-condition (O-05/O-27).
  server.registerTool(
    "pick_backend",
    {
      description: `Recommend a storage backend for a workload + the condition that flips it (O-05/O-27). Workloads: ${WORKLOADS.join(", ")}.`,
      inputSchema: { workload: z.enum(["hot-public", "write-heavy", "cold", "event-driven", "compliance"]) },
    },
    async ({ workload }): Promise<ToolResult> => {
      const rec = pickBackend(workload);
      if (!rec) return err(`unknown workload '${workload}'. Choose one of: ${WORKLOADS.join(", ")}`);
      return ok(rec as unknown as Record<string, unknown>);
    },
  );

  // 8) explain_pitfall — extract a named brain section (S-/P-/O-/V-/Dispute) or fall back to BM25 (teaching).
  server.registerTool(
    "explain_pitfall",
    {
      description: "Explain a named scenario/pitfall/opinion (S-/P-/O-/V-/JTBD-/Dispute id) or a free-text topic — the teaching surface over brain/.",
      inputSchema: { id: z.string() },
    },
    async ({ id }): Promise<ToolResult> => {
      try {
        const res = explain(id);
        return ok({ matched: res.matched, section: res.section, alternatives: res.alternatives });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // 9) search_brain — BM25 ranked search over brain/ (the Memory component's queryable layer, A4 engine).
  server.registerTool(
    "search_brain",
    {
      description: "BM25 ranked search over the expertise brain (brain/*.md) — returns the file + matched S-/P-/O- node.",
      inputSchema: { query: z.string(), limit: z.number().int().positive().optional() },
    },
    async ({ query, limit }): Promise<ToolResult> => {
      try {
        const results = searchBrain(query, limit ?? 5);
        return ok({ query, results });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  return server;
}

/** Start over stdio (default) or Streamable-HTTP (SHELF_MCP_HTTP set). */
async function main(): Promise<void> {
  const server = buildServer();

  if (process.env.SHELF_MCP_HTTP) {
    const port = Number(process.env.SHELF_MCP_PORT ?? 8790);
    // Stateless: no session id generator (MCP spec 2025-11-25) — any agent POSTs a JSON-RPC request.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const http = createServer((req, res) => {
      void transport.handleRequest(req, res);
    });
    http.listen(port, "127.0.0.1", () => {
      process.stderr.write(`shelf MCP (Streamable-HTTP) listening on http://127.0.0.1:${port}/mcp  trace=${newTraceId()}\n`);
    });
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("shelf MCP (stdio) ready\n");
}

// Run only when invoked directly (not when imported by a test harness). The `shelf-mcp` bin that npx and
// the plugin start is a symlink in node_modules/.bin, so resolve it before matching the file name.
function entryPath(): string {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) : "";
  } catch {
    return process.argv[1] ?? ""; // Intentionally silent: an unresolvable argv[1] falls back to the raw path.
  }
}
const invokedDirectly = /server\.(js|ts)$/.test(entryPath());
if (invokedDirectly) {
  main().catch((e: unknown) => {
    process.stderr.write(`shelf MCP failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
