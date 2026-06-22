#!/usr/bin/env node
// mcp-smoke.mjs — C1 verification harness: spawn shelf's own MCP server over stdio, list tools,
// and round-trip presign_upload. NOT a product surface — a reproducible verify for the C1 board item
// (HARNESS-OVERRIDES §7 evidence: "tools/list returns the 9 names; tools/call presign_upload round-trips").
// Runs against dist/mcp/server.js with an S3_ENDPOINT so presign_upload returns a real URL with no creds.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED = [
  "presign_upload",
  "presign_get",
  "validate_file",
  "set_lifecycle",
  "find_orphans",
  "estimate_cost",
  "pick_backend",
  "explain_pitfall",
  "search_brain",
];

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/mcp/server.js"],
  // MinIO-shaped env so presign_upload mints a real POST policy URL without provider creds.
  env: {
    ...process.env,
    S3_ENDPOINT: "http://localhost:9000",
    S3_ACCESS_KEY_ID: "minioadmin",
    S3_SECRET_ACCESS_KEY: "minioadmin",
  },
});

const client = new Client({ name: "shelf-smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
const missing = EXPECTED.filter((n) => !names.includes(n));
console.log("tools/list ->", names.join(", "));
if (missing.length) {
  console.error("MISSING:", missing.join(", "));
  await client.close();
  process.exit(1);
}

// tools/call presign_upload — must return a url + the signed fields (the POST policy / signed set).
const res = await client.callTool({
  name: "presign_upload",
  arguments: { bucket: "shelf-accept", key: "smoke/object.bin", maxBytes: 1048576 },
});
const payload = JSON.parse(res.content[0].text);
const hasUrl = typeof payload.url === "string" && payload.url.length > 0;
const hasFields = payload.fields && typeof payload.fields === "object";
const hasClr = JSON.stringify(payload.conditions ?? []).includes("content-length-range");
console.log("tools/call presign_upload -> url?", hasUrl, "| fields?", !!hasFields, "| content-length-range?", hasClr, "| backend:", payload.backend);

// Also round-trip search_brain so the Memory-over-brain path is proven through the MCP, not just the CLI.
const brainRes = await client.callTool({
  name: "search_brain",
  arguments: { query: "presigned PUT size limit", limit: 3 },
});
const brainPayload = JSON.parse(brainRes.content[0].text);
const top3 = (brainPayload.results ?? []).map((r) => r.node ?? r.id ?? r.file).join(", ");
console.log("tools/call search_brain top3 ->", top3);

await client.close();

if (hasUrl && hasFields && hasClr) {
  console.log("C1 SMOKE: PASS");
  process.exit(0);
}
console.error("C1 SMOKE: FAIL (presign_upload payload incomplete)");
process.exit(1);
