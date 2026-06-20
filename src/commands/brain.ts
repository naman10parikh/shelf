// brain.ts — `shelf brain <query>` — the Memory component's queryable surface.
//
// Wraps A4's BM25 engine (scripts/brain-search.mjs) — a real ranked index over brain/*.md returning the
// file + matched node ID (S-/P-/O-/Dispute/V-). We shell out to the proven engine rather than reimplement
// it (surgical: A4 owns the engine; B2 surfaces it). Resolves the script path from the repo root so it
// works from any cwd.

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emit, failFrom, fail, isJsonMode } from "../lib/output.js";
import { withRun } from "../lib/observability.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/commands/brain.js → repo root is two levels up.
const REPO_ROOT = resolve(__dirname, "..", "..");
const ENGINE = resolve(REPO_ROOT, "scripts", "brain-search.mjs");

export function registerBrain(program: Command): void {
  program
    .command("brain <query...>")
    .description("BM25 ranked search over the expertise brain (brain/*.md) — returns the matched S-/P-/O- node")
    .option("--limit <n>", "max results", (v) => parseInt(v, 10), 5)
    .action(async (queryParts: string[], opts: { limit: number }) => {
      const query = queryParts.join(" ");
      await withRun("brain", [query], async () => {
        // Always ask the engine for JSON; we re-render for human mode so output is consistent.
        const proc = spawnSync("node", [ENGINE, query, "--limit", String(opts.limit), "--json"], {
          encoding: "utf8",
        });
        if (proc.status !== 0) {
          fail(`brain search failed: ${proc.stderr?.trim() || `engine exited ${proc.status}`}`, "BRAIN_FAILED");
        }
        let parsed: { query: string; results: Array<{ rank: number; score: number; file: string; node: string; heading: string }> };
        try {
          parsed = JSON.parse(proc.stdout) as typeof parsed;
        } catch {
          fail(`brain engine returned non-JSON output: ${proc.stdout.slice(0, 200)}`, "BRAIN_PARSE");
        }
        if (isJsonMode()) {
          emit(parsed);
          return;
        }
        const lines = parsed.results.map(
          (r) => `  [${r.rank}] ${r.node.padEnd(10)} ${r.file}  (score ${r.score.toFixed(2)})\n      ${r.heading}`,
        );
        emit(parsed, `brain "${query}":\n${lines.join("\n") || "  (no results)"}`);
      }).catch(failFrom);
    });
}
