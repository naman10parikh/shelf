// eval.ts — `shelf eval [--level 1|2|3]` — the CLI surface for the eval pyramid.
//
// CLUSTER BOUNDARY: this B3 command is the CLI ENTRY POINT only; Cluster E (E1) owns the eval LOGIC under
// eval/ (L1 structural / L2 golden / L3 judge, mapped to brain S-IDs). This delegates to E1's runner
// (eval/run.mjs) so E1 can drop it in without touching the CLI. If the runner isn't present yet, we say so
// honestly (exit non-zero) rather than fake a green.

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emit, failFrom, fail } from "../lib/output.js";
import { withRun } from "../lib/observability.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
// E1's runner, by convention (mirrors the sibling-repo eval/run.mjs pattern).
const RUNNER_CANDIDATES = [resolve(REPO_ROOT, "eval", "run.mjs"), resolve(REPO_ROOT, "eval", "run.js")];

export function registerEval(program: Command): void {
  program
    .command("eval")
    .description("run the eval pyramid (L1 structural / L2 golden / L3 judge) — delegates to eval/ (Cluster E)")
    .option("--level <n>", "1 | 2 | 3 (default: all)", (v) => parseInt(v, 10))
    .action(async (opts: { level?: number }) => {
      await withRun("eval", opts.level ? ["--level", String(opts.level)] : [], async ({ recordToolCall }) => {
        const runner = RUNNER_CANDIDATES.find((p) => existsSync(p));
        if (!runner) {
          fail(
            "eval runner not found (expected eval/run.mjs). The eval logic is Cluster E's E1 deliverable; " +
              "this CLI command delegates to it. Once E1 lands eval/run.mjs, `shelf eval` will run the pyramid.",
            "EVAL_RUNNER_MISSING",
          );
        }
        const args = opts.level ? ["--level", String(opts.level)] : [];
        recordToolCall();
        const proc = spawnSync("node", [runner, ...args], { encoding: "utf8", stdio: "inherit" });
        if (proc.status !== 0) {
          fail(`eval failed (runner exited ${proc.status})`, "EVAL_FAILED");
        }
        emit({ ok: true, level: opts.level ?? "all", runner }, `✓ eval passed (${opts.level ? `L${opts.level}` : "all levels"})`);
      }).catch(failFrom);
    });
}
