// cost.ts — `shelf cost estimate` — egress-first bill estimate + the R2-vs-S3 flip math (O-01/O-05/O-28).
//
// shelf ALWAYS budgets egress before storage (O-01): storage is cents/GB and predictable; egress is the
// four-figure surprise driven by someone else's download behavior. The MECHANISM is gospel; the specific
// per-GB numbers are directional and must be re-verified against the live pricing page before betting prod
// (O-28). We name the WORKLOAD that flips the default, not a tribe.

import type { Command } from "commander";
import { emit, failFrom } from "../lib/output.js";
import { withRun } from "../lib/observability.js";
import { estimateCost, type ProviderBill } from "../lib/cost.js";

// Pricing + bill() + the flip-math live in src/lib/cost.ts (one source of truth, shared with the MCP
// `estimate_cost` tool). MECHANISM is gospel, NUMBERS are directional (O-28); the RSI loop drift-watches.

export function registerCost(program: Command): void {
  const cost = program.command("cost").description("storage cost estimation (egress-first)");

  cost
    .command("estimate")
    .description("egress-first bill estimate + the R2-vs-S3 flip math (mechanism-confident, number-cautious)")
    .requiredOption("--egress-gb <n>", "monthly egress in GB (the number that actually drives the bill)", (v) => parseFloat(v))
    .requiredOption("--storage-gb <n>", "stored data in GB", (v) => parseFloat(v))
    .option("--provider <p>", "focus a single provider (r2|s3); default shows both + the flip", (v) => v)
    .action(async (opts: { egressGb: number; storageGb: number; provider?: string }) => {
      await withRun("cost estimate", [String(opts.egressGb), String(opts.storageGb)], async () => {
        const est = estimateCost(opts.egressGb, opts.storageGb);
        const { r2, s3, cheaperForThisWorkload: cheaper, flipNote } = est;

        const payload =
          opts.provider === "r2"
            ? { ...r2, note: flipNote }
            : opts.provider === "s3"
              ? { ...s3, note: flipNote }
              : est;

        emit(
          payload,
          opts.provider
            ? renderOne(opts.provider, opts.provider === "r2" ? r2 : s3, flipNote)
            : `egress ${opts.egressGb} GB/mo · storage ${opts.storageGb} GB\n` +
                `  R2:  $${r2.totalUsdMo.toFixed(2)}/mo  (storage $${r2.storageUsd.toFixed(2)} + egress $${r2.egressUsd.toFixed(2)})\n` +
                `  S3:  $${s3.totalUsdMo.toFixed(2)}/mo  (storage $${s3.storageUsd.toFixed(2)} + egress $${s3.egressUsd.toFixed(2)})\n` +
                `  → cheaper for THIS workload: ${cheaper}\n  flip: ${flipNote}\n  (numbers directional — O-28)`,
        );
      }).catch(failFrom);
    });
}

function renderOne(provider: string, b: ProviderBill, flipNote: string): string {
  return (
    `${provider.toUpperCase()}: $${b.totalUsdMo.toFixed(2)}/mo (storage $${b.storageUsd.toFixed(2)} + egress $${b.egressUsd.toFixed(2)})\n` +
    `  flip: ${flipNote}\n  (numbers directional — O-28)`
  );
}
