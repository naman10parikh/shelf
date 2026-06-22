#!/usr/bin/env node
// runs-view.mjs — aggregate logs/runs.jsonl (the Observability component, layer-a read side).
//
// E2 deliverable. The CLI (src/lib/observability.ts) APPENDS one wide event per `shelf` run; this script
// READS that same append-only file and prints a per-command aggregate (count, ok/fail, p50/p95 measured
// durationMs, total tool-calls) plus the most-recent state-mutating audit lines (key+size+backend+TTL —
// the checklist §10 audit trail). It defines NO second logger — it consumes the schema written by
// observability.ts (keep the two in lockstep). Zero-dep, Node stdlib only.
//
// Usage:
//   node scripts/runs-view.mjs               # aggregate the whole file
//   node scripts/runs-view.mjs --json        # machine-readable summary
//   node scripts/runs-view.mjs --tail 10     # also show the last N raw events
//   node scripts/runs-view.mjs --file <path> # aggregate a different jsonl

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_LOG = resolve(REPO_ROOT, "logs", "runs.jsonl");

function parseArgs(argv) {
  let json = false;
  let tail = 0;
  let file = DEFAULT_LOG;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--tail") tail = Number(argv[++i]) || 0;
    else if (argv[i] === "--file") file = resolve(process.cwd(), argv[++i] ?? "");
  }
  return { json, tail, file };
}

/** Read + parse the jsonl, skipping blank/corrupt lines (telemetry is best-effort, never crash). */
function readEvents(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // skip a partially-written / corrupt line rather than abort the whole aggregate
    }
  }
  return out;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function aggregate(events) {
  const byCommand = new Map();
  let totalToolCalls = 0;
  let okCount = 0;
  let failCount = 0;
  const auditTrail = [];

  for (const e of events) {
    const cmd = typeof e.command === "string" ? e.command : "(unknown)";
    if (!byCommand.has(cmd)) byCommand.set(cmd, { command: cmd, runs: 0, ok: 0, fail: 0, durations: [], toolCalls: 0 });
    const row = byCommand.get(cmd);
    row.runs += 1;
    if (e.ok) {
      row.ok += 1;
      okCount += 1;
    } else {
      row.fail += 1;
      failCount += 1;
    }
    const d = typeof e.durationMs === "number" ? e.durationMs : 0;
    row.durations.push(d);
    const tc = typeof e.toolCalls === "number" ? e.toolCalls : 0;
    row.toolCalls += tc;
    totalToolCalls += tc;
    // The state-mutating audit line (checklist §10): key + size + backend + signed-URL TTL.
    if (e.audit && (e.audit.key !== undefined || e.audit.backend !== undefined)) {
      auditTrail.push({
        ts: e.ts,
        command: cmd,
        key: e.audit.key ?? null,
        sizeBytes: e.audit.sizeBytes ?? null,
        backend: e.audit.backend ?? null,
        signedUrlTtlSeconds: e.audit.signedUrlTtlSeconds ?? null,
        traceId: e.trace?.id ?? null,
      });
    }
  }

  const commands = [...byCommand.values()]
    .map((r) => {
      const sorted = [...r.durations].sort((a, b) => a - b);
      return {
        command: r.command,
        runs: r.runs,
        ok: r.ok,
        fail: r.fail,
        toolCalls: r.toolCalls,
        p50Ms: round(percentile(sorted, 50)),
        p95Ms: round(percentile(sorted, 95)),
        maxMs: round(sorted[sorted.length - 1] ?? 0),
      };
    })
    .sort((a, b) => b.runs - a.runs);

  return {
    totalRuns: events.length,
    ok: okCount,
    fail: failCount,
    totalToolCalls,
    commands,
    auditTrail,
  };
}

function printHuman(summary, recent) {
  const W = (s, n) => String(s).padEnd(n);
  console.log(`shelf runs.jsonl — ${summary.totalRuns} runs (${summary.ok} ok / ${summary.fail} fail), ${summary.totalToolCalls} tool-calls\n`);
  console.log(`${W("COMMAND", 22)}${W("runs", 6)}${W("ok", 5)}${W("fail", 6)}${W("p50ms", 10)}${W("p95ms", 10)}${W("maxms", 10)}`);
  console.log("-".repeat(69));
  for (const c of summary.commands) {
    console.log(`${W(c.command, 22)}${W(c.runs, 6)}${W(c.ok, 5)}${W(c.fail, 6)}${W(c.p50Ms, 10)}${W(c.p95Ms, 10)}${W(c.maxMs, 10)}`);
  }
  if (summary.auditTrail.length > 0) {
    const last = summary.auditTrail.slice(-5);
    console.log(`\nstate-mutating audit trail (last ${last.length} of ${summary.auditTrail.length}) — key · size · backend · signed-URL TTL:`);
    for (const a of last) {
      console.log(`  ${a.ts}  ${a.command}  key=${a.key}  size=${a.sizeBytes}  backend=${a.backend}  ttl=${a.signedUrlTtlSeconds}s  trace=${a.traceId}`);
    }
  }
  if (recent.length > 0) {
    console.log(`\nlast ${recent.length} raw events:`);
    for (const e of recent) {
      console.log(`  ${e.ts}  ${e.command}  ${e.ok ? "ok" : "FAIL"}  ${round(e.durationMs)}ms  trace=${e.trace?.id ?? "?"}`);
    }
  }
}

const { json, tail, file } = parseArgs(process.argv.slice(2));
const events = readEvents(file);
const summary = aggregate(events);

if (json) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} else if (events.length === 0) {
  console.log(`shelf runs.jsonl — no events yet (${file}). Run a \`shelf\` command to populate it.`);
} else {
  const recent = tail > 0 ? events.slice(-tail) : [];
  printHuman(summary, recent);
}
