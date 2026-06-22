// cost.ts (lib) — egress-first bill estimate logic, shared by the CLI (`shelf cost estimate`) and the MCP
// (`estimate_cost`). O-01 (budget egress before storage), O-05 (the R2-vs-S3 flip), O-28 (mechanism is
// gospel, the number is directional — re-verify the live pricing page; the RSI loop drift-watches these).
//
// One source of truth: the command file and the MCP tool both import estimateCost() so the flip-math and
// the O-28 caveat never drift between surfaces.

// Directional list prices (USD), June-2026 snapshot — MECHANISM is gospel, NUMBERS are directional (O-28).
// Re-verify against the provider pricing page before betting prod; the RSI loop (E4) drift-watches these.
export const PRICING = {
  r2: { storagePerGbMo: 0.015, egressPerGb: 0.0 }, // R2: $0 egress is the whole point
  s3: { storagePerGbMo: 0.023, egressPerGb: 0.09 }, // S3 Standard + ~$0.09/GB internet egress
} as const;

export interface ProviderBill {
  provider: keyof typeof PRICING;
  storageUsd: number;
  egressUsd: number;
  totalUsdMo: number;
  storagePerGbMo: number;
  egressPerGb: number;
}

export interface CostEstimate {
  r2: ProviderBill;
  s3: ProviderBill;
  cheaperForThisWorkload: "r2" | "s3";
  flipNote: string;
  caveat: string;
}

/** Compute one provider's monthly bill from storage + egress GB. */
export function bill(provider: keyof typeof PRICING, storageGb: number, egressGb: number): ProviderBill {
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

/**
 * Full egress-first estimate across both providers + the flip note (which workload shape flips the
 * default) + the O-28 directional-number caveat. The flip is the expertise; the number is directional.
 */
export function estimateCost(egressGb: number, storageGb: number): CostEstimate {
  const r2 = bill("r2", storageGb, egressGb);
  const s3 = bill("s3", storageGb, egressGb);
  const cheaper = r2.totalUsdMo <= s3.totalUsdMo ? "r2" : "s3";
  const flipNote =
    egressGb <= 0
      ? "egress ≈ 0 → R2's zero-egress benefit is UNUSED; you'd pay R2's ~2.5× storage premium for nothing. For cold/archival prefer B2/Wasabi or S3 Glacier/IA (O-05/P-26)."
      : `egress-driven: R2's $0 egress saves ~$${(s3.egressUsd - r2.egressUsd).toFixed(2)}/mo here. But R2 is the WRONG default for write-heavy (Class A $4.50/M, P-25), event-driven (no S3 events), and cold/archival (O-05).`;
  return {
    r2,
    s3,
    cheaperForThisWorkload: cheaper,
    flipNote,
    caveat: "Numbers are directional (O-28) — re-verify the live pricing page before betting prod.",
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
