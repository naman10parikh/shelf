// cost.ts — `shelf cost estimate` — egress-first bill estimate + the R2-vs-S3 flip math (O-01/O-05/O-28).
//
// shelf ALWAYS budgets egress before storage (O-01): storage is cents/GB and predictable; egress is the
// four-figure surprise driven by someone else's download behavior. The MECHANISM is gospel; the specific
// per-GB numbers are directional and must be re-verified against the live pricing page before betting prod
// (O-28). We name the WORKLOAD that flips the default, not a tribe.

import type { Command } from "commander";
import { emit, failFrom } from "../lib/output.js";
import { withRun } from "../lib/observability.js";

// Directional list prices (USD), June-2026 snapshot — MECHANISM is gospel, NUMBERS are directional (O-28).
// Re-verify against the provider pricing page before betting prod; the RSI loop (E4) drift-watches these.
const PRICING = {
  r2: { storagePerGbMo: 0.015, egressPerGb: 0.0 }, // R2: $0 egress is the whole point
  s3: { storagePerGbMo: 0.023, egressPerGb: 0.09 }, // S3 Standard + ~$0.09/GB internet egress
} as const;

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
        const r2 = bill("r2", opts.storageGb, opts.egressGb);
        const s3 = bill("s3", opts.storageGb, opts.egressGb);

        // The flip: R2 wins when egress dominates; S3+lifecycle wins for cold/archival (no egress) where
        // R2's storage premium (~2.5×) is paid for nothing, and for write-heavy (R2 Class A fees, P-25).
        const cheaper = r2.totalUsdMo <= s3.totalUsdMo ? "r2" : "s3";
        const flipNote =
          opts.egressGb <= 0
            ? "egress ≈ 0 → R2's zero-egress benefit is UNUSED; you'd pay R2's ~2.5× storage premium for nothing. For cold/archival prefer B2/Wasabi or S3 Glacier/IA (O-05/P-26)."
            : `egress-driven: R2's $0 egress saves ~$${(s3.egressUsd - r2.egressUsd).toFixed(2)}/mo here. But R2 is the WRONG default for write-heavy (Class A $4.50/M, P-25), event-driven (no S3 events), and cold/archival (O-05).`;

        const payload =
          opts.provider === "r2"
            ? { ...r2, note: flipNote }
            : opts.provider === "s3"
              ? { ...s3, note: flipNote }
              : { r2, s3, cheaperForThisWorkload: cheaper, flipNote, caveat: "Numbers are directional (O-28) — re-verify the live pricing page before betting prod." };

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

function bill(provider: keyof typeof PRICING, storageGb: number, egressGb: number) {
  const p = PRICING[provider];
  const storageUsd = storageGb * p.storagePerGbMo;
  const egressUsd = egressGb * p.egressPerGb;
  return {
    provider,
    storageUsd: round(storageUsd),
    egressUsd: round(egressUsd),
    totalUsdMo: round(storageUsd + egressUsd),
    storagePerGbMo: p.storagePerGbMo,
    egressPerGb: p.egressPerGb,
  };
}

function renderOne(provider: string, b: ReturnType<typeof bill>, flipNote: string): string {
  return (
    `${provider.toUpperCase()}: $${b.totalUsdMo.toFixed(2)}/mo (storage $${b.storageUsd.toFixed(2)} + egress $${b.egressUsd.toFixed(2)})\n` +
    `  flip: ${flipNote}\n  (numbers directional — O-28)`
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
