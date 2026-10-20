// observability.ts — shelf's own run telemetry (the Observability component, layer a).
//
// Every `shelf` run appends ONE wide event to logs/runs.jsonl (append-only). Each event carries a real
// trace.id (random, not a placeholder) and a MEASURED durationMs (not an all-zero marker). State-mutating
// commands (e.g. `shelf upload`) attach the audit fields the checklist §10 requires: object key + size +
// backend + signed-URL TTL.
//
// Cross-cluster note (CP123 Cluster B builder): this is the SHARED logger the CLI (B2/B3) and the MCP
// (C1) both call. Cluster E's E2 builds `scripts/runs-view.mjs` to AGGREGATE this same file — it reads
// the schema written here; it does NOT define a second logger. Schema is stable: keep the keys below.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/lib/observability.js → repo root is two levels up; src/lib → also two up. Resolve to repo root.
const REPO_ROOT = resolve(__dirname, "..", "..");
const RUNS_LOG = resolve(REPO_ROOT, "logs", "runs.jsonl");

/** Audit fields a state-mutating command attaches (checklist §10). All optional. */
export interface RunAudit {
  key?: string;
  sizeBytes?: number;
  backend?: string;
  signedUrlTtlSeconds?: number;
  [extra: string]: unknown;
}

/** A wide run event. One line of logs/runs.jsonl. */
export interface RunEvent {
  ts: string;
  trace: { id: string };
  command: string;
  args: string[];
  ok: boolean;
  durationMs: number;
  toolCalls: number;
  model: string;
  audit?: RunAudit;
  error?: string;
}

/** Generate a real (random) trace id — never a fixed placeholder. */
export function newTraceId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Wrap a command body so it is timed and logged exactly once. Returns whatever the body returns; on
 * throw, logs ok:false with the message, then re-throws (the caller controls the exit code).
 *
 * @param command  the command name (e.g. "presign upload")
 * @param args     the raw argv slice for this command (for the audit trail)
 * @param body     the async command body; may return audit fields to attach to the run event
 */
export async function withRun<T>(
  command: string,
  args: string[],
  body: (ctx: { traceId: string; recordToolCall: () => void; setAudit: (a: RunAudit) => void }) => Promise<T>,
): Promise<T> {
  const start = process.hrtime.bigint();
  const traceId = newTraceId();
  let toolCalls = 0;
  let audit: RunAudit | undefined;
  const ctx = {
    traceId,
    recordToolCall: () => {
      toolCalls += 1;
    },
    setAudit: (a: RunAudit) => {
      audit = { ...audit, ...a };
    },
  };
  try {
    const result = await body(ctx);
    writeEvent({
      command,
      args,
      ok: true,
      durationMs: elapsedMs(start),
      toolCalls,
      traceId,
      audit,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeEvent({
      command,
      args,
      ok: false,
      durationMs: elapsedMs(start),
      toolCalls,
      traceId,
      audit,
      error: message,
    });
    throw err;
  }
}

function elapsedMs(start: bigint): number {
  const ns = process.hrtime.bigint() - start;
  // Convert to ms with sub-ms precision; guarantee > 0 so the audit gate (durationMs > 0) never trips on
  // a sub-microsecond no-op (real work is always above this floor anyway).
  const ms = Number(ns) / 1_000_000;
  return ms > 0 ? ms : 0.001;
}

function writeEvent(e: {
  command: string;
  args: string[];
  ok: boolean;
  durationMs: number;
  toolCalls: number;
  traceId: string;
  audit?: RunAudit;
  error?: string;
}): void {
  const event: RunEvent = {
    ts: new Date().toISOString(),
    trace: { id: e.traceId },
    command: e.command,
    args: e.args,
    ok: e.ok,
    durationMs: e.durationMs,
    toolCalls: e.toolCalls,
    model: process.env.ANTHROPIC_MODEL ?? "default",
    ...(e.audit ? { audit: e.audit } : {}),
    ...(e.error ? { error: e.error } : {}),
  };
  try {
    mkdirSync(dirname(RUNS_LOG), { recursive: true });
    appendFileSync(RUNS_LOG, JSON.stringify(event) + "\n");
  } catch (err) {
    // Telemetry must never break a command. Surface to stderr and continue.
    console.warn("[observability] failed to append run event:", err instanceof Error ? err.message : err);
  }
}
