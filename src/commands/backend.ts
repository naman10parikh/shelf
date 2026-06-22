// backend.ts — `shelf backend pick --workload <...>` — per-workload backend recommendation (O-05/O-06/S3).
//
// The 2025 gospel "S3 is the safe default" is dead; the 2026 reflex "R2 is the cheap default" is ALSO
// wrong. The expert move is PER-WORKLOAD (O-05). shelf names the recommendation AND the condition that
// flips it (O-27) — the flip condition is the expertise; anyone can have an opinion.

import type { Command } from "commander";
import { emit, failFrom, fail } from "../lib/output.js";
import { withRun } from "../lib/observability.js";
import { WORKLOADS, pickBackend } from "../lib/recommendations.js";

// The per-workload recommendation map lives in src/lib/recommendations.ts (one source of truth, shared
// with the MCP `pick_backend` tool). O-05 (R2 default but traffic-aware), O-27 (name the flip-condition).

export function registerBackend(program: Command): void {
  const backend = program.command("backend").description("storage backend selection (per-workload)");

  backend
    .command("pick")
    .description("recommend a backend for a workload + the condition that flips it (O-05/O-27)")
    .requiredOption("--workload <type>", `one of: ${WORKLOADS.join(", ")}`)
    .action(async (opts: { workload: string }) => {
      await withRun("backend pick", [opts.workload], async () => {
        const rec = pickBackend(opts.workload);
        if (!rec) {
          fail(`unknown workload '${opts.workload}'. Choose one of: ${WORKLOADS.join(", ")}`, "BAD_WORKLOAD");
        }
        emit(
          rec,
          `workload: ${rec.workload}\n  → recommend: ${rec.backend}\n  why: ${rec.why}\n  flips when: ${rec.flipWhen}`,
        );
      }).catch(failFrom);
    });
}
