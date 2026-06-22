#!/usr/bin/env node
/**
 * web/server.mjs — shelf cockpit HTTP server (G1, the local cockpit).
 *
 * Zero-dependency Node stdlib `node:http` server (NOT Python — shelf is a pnpm/Node repo; this is the
 * faithful adaptation of the proven sibling cockpit pattern, e.g. tally/web/server.mjs, to shelf's
 * actual toolchain). No build step for the SPA. Serves the vanilla-JS SPA + read-only JSON endpoints.
 *
 * READ-MOSTLY (the cockpit never mutates): the only shelf verbs it shells are the read/analyze
 * surface — `shelf brain` (BM25 over brain/*.md), `shelf explain` (a named S-/P-/O-/Dispute/V-/JTBD
 * id or a free-text topic), `shelf backend pick` (a pure recommender), `shelf cost estimate` (pure
 * arithmetic over a pricing table — no provider, no creds). All other views are plain file reads
 * (brain/*.md, logs/runs.jsonl, eval/golden/*.json). It never mints a presigned URL against a live
 * bucket, never uploads, never migrates, never touches creds from the browser.
 *
 * Security:
 *   - Static files are served only from web/ (resolve + prefix-check → path-traversal guard).
 *   - The brain query / explain id / workload / cost numbers flow to the CLI as an argv ARRAY via
 *     spawnSync (never a shell string); the explain id is validated against a strict allow-pattern,
 *     the workload against a fixed allow-list, and the cost numbers are coerced to finite numbers.
 *   - Bound to 127.0.0.1 only; no auth (the chairman's eyes only).
 *   - Only GET/HEAD accepted; a POST to a data endpoint is a 405 (read-only cockpit).
 *
 * Error contract: a typed JSON body {error} always; 400 bad input, 404 not found, 502 CLI failure,
 * 504 CLI timeout, 500 otherwise. The server boots even if dist/ is unbuilt — the endpoints then
 * return an honest 502 (CLI missing), never a crash.
 */

import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";

// ----------------------------------------------------------------- bootstrap ---
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // web/ → repo root
const WEB = join(REPO, "web");
// shelf's bin entry IS the built CLI (package.json bin.shelf = ./dist/index.js). The cockpit shells
// the same compiled CLI the MCP server and the eval suite use — single source of truth.
const CLI = join(REPO, "dist", "index.js");
const PORT = Number(process.env.SHELF_WEB_PORT ?? "7779");
const HOST = "127.0.0.1";

/**
 * The brain artifacts, in the stable display order (mirrors brain/MOC + the bm25 corpus). Only files
 * that actually exist are surfaced (defensive — the list is the allow-list, never an arbitrary path).
 */
const BRAIN_FILES = [
  "BATTLE-TESTED-SCENARIOS.md",
  "EXPERTISE-MAP.md",
  "OPINIONS.md",
  "KNOWN-PITFALLS.md",
  "TOOL-MATRIX.md",
  "GAPS-AND-DISPUTES.md",
  "MOC - shelf.md",
];

/** The workloads `backend pick` accepts (its own enum). Allow-list — never a free string to the CLI. */
const WORKLOADS = ["hot-public", "write-heavy", "cold", "event-driven", "compliance"];

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** A carried HTTP status for the error contract. */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ------------------------------------------------------------------- helpers ---

/**
 * Run the shelf CLI with the given argv (array — never a shell string). Returns parsed JSON.
 * shelf's `--json` is a global flag flipped in a preAction hook, so it must come BEFORE the
 * subcommand (`shelf --json brain <q>`), which is exactly how we order it here.
 *
 * The CLI prints a single pretty-printed JSON document on stdout for data commands. We parse the
 * whole trimmed stdout; if anything wraps it, we fall back to the first-`{`…last-`}` slice.
 */
function runShelfJson(args, timeoutMs = 30_000) {
  if (!existsSync(CLI)) {
    throw new ApiError(502, `shelf CLI missing — looked for ${CLI} (run: pnpm build)`);
  }
  const res = spawnSync(process.execPath, [CLI, "--json", ...args], {
    cwd: REPO,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (res.error && res.error.code === "ETIMEDOUT") {
    throw new ApiError(504, `shelf CLI timed out after ${timeoutMs}ms: ${args.join(" ")}`);
  }
  if (res.signal === "SIGTERM") {
    throw new ApiError(504, `shelf CLI was killed (timeout ${timeoutMs}ms): ${args.join(" ")}`);
  }
  if (res.error) throw new ApiError(502, `shelf CLI failed: ${res.error.message}`);
  const out = (res.stdout ?? "").trim();
  if (!out) {
    throw new ApiError(
      502,
      `shelf CLI emitted no output (rc=${res.status}): ${(res.stderr ?? "").slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(out);
  } catch {
    const first = out.indexOf("{");
    const last = out.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(out.slice(first, last + 1));
      } catch {
        /* fall through to the typed error */
      }
    }
    throw new ApiError(502, "shelf CLI emitted unparseable JSON");
  }
}

/** Read a brain artifact's raw markdown (one of the known set — never an arbitrary path). */
function readBrainFile(name) {
  if (!BRAIN_FILES.includes(name)) throw new ApiError(400, `not a brain artifact: ${name}`);
  const p = join(REPO, "brain", name);
  if (!existsSync(p)) throw new ApiError(404, `brain artifact missing: ${name}`);
  return readFileSync(p, "utf8");
}

/** Only return brain files that actually exist on disk (so the UI never shows a dead artifact). */
function presentBrainFiles() {
  return BRAIN_FILES.filter((f) => existsSync(join(REPO, "brain", f)));
}

/**
 * Tail the last N lines of logs/runs.jsonl as parsed wide-events (newest first). shelf's logger
 * writes `trace` as `{id}`, `toolCalls` as a number, and `ok` as a boolean — normalize to
 * cockpit-friendly scalars (traceId string + outcome ok|fail).
 */
function readRunLog(limit = 80) {
  const p = join(REPO, "logs", "runs.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.trim().startsWith("{"));
  const tail = lines.slice(-limit).reverse();
  const rows = [];
  for (const line of tail) {
    try {
      const r = JSON.parse(line);
      const traceId = r.trace && typeof r.trace === "object" ? r.trace.id : (r.trace ?? "");
      const toolCount = Array.isArray(r.toolCalls) ? r.toolCalls.length : (r.toolCalls ?? 0);
      rows.push({
        ts: r.ts ?? "",
        command: r.command ?? "",
        args: Array.isArray(r.args) ? r.args.join(" ") : "",
        model: r.model ?? "",
        durationMs: typeof r.durationMs === "number" ? r.durationMs : null,
        traceId: traceId ?? "",
        toolCount,
        outcome: r.ok === true ? "ok" : r.ok === false ? "fail" : "—",
      });
    } catch {
      /* skip a corrupt line — the run log is append-only but be defensive */
    }
  }
  return rows;
}

/**
 * Read the golden-task suite (eval/golden/GT-*.json) as the Eval-scores view. Pure file reads of the
 * committed eval contract — the same tasks `shelf eval` runs (L1 structural / L2 golden / L3 judge).
 * We surface per-task id/scenario/title/levels/ci-blocking + a check count + a coverage rollup, so
 * the cockpit shows the eval pyramid without having to spin up MinIO/E2B/an LLM judge.
 */
function readGoldenTasks() {
  const dir = join(REPO, "eval", "golden");
  if (!existsSync(dir)) return { tasks: [], rollup: { total: 0, ciBlocking: 0, byLevel: {} } };
  const files = readdirSync(dir)
    .filter((f) => /^GT-.*\.json$/.test(f))
    .sort((a, b) => {
      const na = Number(a.replace(/\D/g, "")) || 0;
      const nb = Number(b.replace(/\D/g, "")) || 0;
      return na - nb;
    });
  const tasks = [];
  const byLevel = { L1: 0, L2: 0, L3: 0 };
  let ciBlocking = 0;
  for (const f of files) {
    try {
      const t = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const levels = Array.isArray(t.level) ? t.level : t.level ? [t.level] : [];
      for (const lv of levels) if (byLevel[lv] != null) byLevel[lv] += 1;
      if (t.ciBlocking) ciBlocking += 1;
      tasks.push({
        id: t.id ?? f.replace(/\.json$/, ""),
        scenario: t.scenario ?? "",
        title: t.title ?? "",
        levels,
        ciBlocking: Boolean(t.ciBlocking),
        checks: Array.isArray(t.checks) ? t.checks.length : 0,
        evalCheck: t.evalCheck ?? "",
      });
    } catch {
      /* skip a malformed fixture — keep the rest of the suite visible */
    }
  }
  return { tasks, rollup: { total: tasks.length, ciBlocking, byLevel } };
}

// -------------------------------------------------------------------- routes ---

function apiBrain(query) {
  const q = (query ?? "").trim();
  if (!q) throw new ApiError(400, "missing query (?q=)");
  if (q.length > 200) throw new ApiError(400, "query too long");
  // argv array — the query is split into tokens (shelf brain takes <query...>) and never touches a
  // shell. The BM25 search is fast, but allow a generous window for a cold corpus.
  return runShelfJson(["brain", ...q.split(/\s+/)], 60_000);
}

function apiExplain(id) {
  const raw = (id ?? "").trim();
  if (!raw) throw new ApiError(400, "missing id (?id=)");
  if (raw.length > 60) throw new ApiError(400, "id too long");
  // Strict ID shapes: S<n> | P-<n> | O-<n> | Dispute <A-Z> | V-<n> | JTBD-<n>. Reject anything else
  // (this endpoint is for the brain-browser hit-clicks; free-text "ask" goes through /api/explain-text).
  if (!/^(S\d+|P-\d+|O-\d+|V-\d+|JTBD-?\d+|Dispute\s+[A-Za-z])$/.test(raw)) {
    throw new ApiError(400, `not a valid brain id: ${raw} (expected S6, P-01, O-14, JTBD-8, or "Dispute F")`);
  }
  // "Dispute F" is two tokens — pass them as separate argv items, never a quoted shell string.
  return runShelfJson(["explain", ...raw.split(/\s+/)], 30_000);
}

/** Ask-the-employee: a free-text topic OR an id, both shelled through `shelf explain`. */
function apiExplainText(topic) {
  const t = (topic ?? "").trim();
  if (!t) throw new ApiError(400, "missing topic (?q=)");
  if (t.length > 200) throw new ApiError(400, "topic too long");
  return runShelfJson(["explain", ...t.split(/\s+/)], 60_000);
}

function apiBackendPick(workload) {
  const w = (workload ?? "").trim();
  if (!WORKLOADS.includes(w)) {
    throw new ApiError(400, `not a known workload: ${w} (one of: ${WORKLOADS.join(", ")})`);
  }
  return runShelfJson(["backend", "pick", "--workload", w], 30_000);
}

function apiCostEstimate(params) {
  const egress = Number(params.get("egressGb"));
  const storage = Number(params.get("storageGb"));
  if (!Number.isFinite(egress) || egress < 0) throw new ApiError(400, "egressGb must be a non-negative number");
  if (!Number.isFinite(storage) || storage < 0) throw new ApiError(400, "storageGb must be a non-negative number");
  return runShelfJson(
    ["cost", "estimate", "--egress-gb", String(egress), "--storage-gb", String(storage)],
    30_000,
  );
}

function serveStatic(req, res, pathname) {
  // Map "/" → index.html; resolve and confine to web/.
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = resolve(WEB, rel);
  if (target !== WEB && !target.startsWith(WEB + "/")) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  if (!existsSync(target)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const type = STATIC_TYPES[extname(target)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(readFileSync(target));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

const server = createServer((req, res) => {
  try {
    // Read-only surface: only GET (+HEAD) is accepted (no mutate-from-browser).
    if (req.method !== "GET" && req.method !== "HEAD") {
      throw new ApiError(405, "read-only cockpit — only GET is allowed");
    }
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    const p = url.pathname;

    if (p === "/api/health") return sendJson(res, 200, { ok: true, repo: "shelf", cli: existsSync(CLI) });
    if (p === "/api/brain-files") return sendJson(res, 200, { files: presentBrainFiles() });
    if (p === "/api/brain-file")
      return sendJson(res, 200, { name: url.searchParams.get("name"), markdown: readBrainFile(url.searchParams.get("name")) });
    if (p === "/api/brain") return sendJson(res, 200, apiBrain(url.searchParams.get("q")));
    if (p === "/api/explain") return sendJson(res, 200, apiExplain(url.searchParams.get("id")));
    if (p === "/api/explain-text") return sendJson(res, 200, apiExplainText(url.searchParams.get("q")));
    if (p === "/api/backend") return sendJson(res, 200, apiBackendPick(url.searchParams.get("workload")));
    if (p === "/api/cost") return sendJson(res, 200, apiCostEstimate(url.searchParams));
    if (p === "/api/runs") return sendJson(res, 200, { runs: readRunLog(Number(url.searchParams.get("limit") ?? "80")) });
    if (p === "/api/eval") return sendJson(res, 200, readGoldenTasks());
    if (p === "/api/workloads") return sendJson(res, 200, { workloads: WORKLOADS });

    // Anything else is a static asset request.
    return serveStatic(req, res, p);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  // One structured line — shelf dogfoods its own run telemetry; emit a clean machine line + a human line.
  process.stdout.write(
    JSON.stringify({ event: "cockpit.listening", url: `http://${HOST}:${PORT}`, cli: existsSync(CLI) }) + "\n",
  );
  process.stdout.write(`shelf cockpit → http://${HOST}:${PORT}  (Ctrl-C to stop)\n`);
});

// Honest shutdown on SIGINT/SIGTERM (the serve.sh launcher + any webServer wrapper send these).
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
