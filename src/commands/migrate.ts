// migrate.ts — `shelf migrate plan --from --to` (O-24 / P-27 / P-37).
//
// Emits an rclone-driven migration plan that BUDGETS THE ONE-TIME EXIT EGRESS (the un-budgeted surprise:
// leaving S3 pays $0.09/GB once on the full dataset — NixOS ≈ $32K, P-27) and FLAGS the control-plane
// features that won't port ("S3-compatible" is a data-plane promise only — P-37). The data plane moves;
// the control plane (events, lifecycle tiering, IAM condition keys, cross-region replication) does not.

import type { Command } from "commander";
import { emit, failFrom } from "../lib/output.js";
import { withRun } from "../lib/observability.js";

const S3_EGRESS_PER_GB = 0.09; // directional (O-28)

const CONTROL_PLANE_GAPS: Record<string, string[]> = {
  r2: ["S3 event notifications (R2 has none — rebuild via the uploader notifying a queue)", "S3 lifecycle tiering / Glacier-IA (no equivalent)", "s3: IAM condition keys", "cross-region replication"],
  b2: ["partial S3-compat — verify conditional writes (If-None-Match) + object-lock per your needs", "S3 event notifications"],
  tigris: ["partial S3-compat — verify the exact S3 calls you depend on", "S3 event notifications"],
};

export function registerMigrate(program: Command): void {
  const migrate = program.command("migrate").description("cross-provider migration (rclone-driven)");

  migrate
    .command("plan")
    .description("emit an rclone migration plan + the one-time exit-egress budget + control-plane gaps")
    .requiredOption("--from <provider:bucket>", "source, e.g. s3:my-bucket")
    .requiredOption("--to <provider:bucket>", "destination, e.g. r2:my-bucket")
    .option("--storage-gb <n>", "stored data in GB (to budget the one-time exit egress)", (v) => parseFloat(v))
    .action(async (opts: { from: string; to: string; storageGb?: number }) => {
      await withRun("migrate plan", [opts.from, opts.to], async () => {
        const fromProvider = opts.from.split(":")[0]?.toLowerCase() ?? "";
        const toProvider = opts.to.split(":")[0]?.toLowerCase() ?? "";
        const exitEgressUsd = fromProvider === "s3" && opts.storageGb !== undefined ? round(opts.storageGb * S3_EGRESS_PER_GB) : null;
        const gaps = CONTROL_PLANE_GAPS[toProvider] ?? [`verify the destination's S3-compatibility for the exact control-plane features you use (P-37)`];

        const steps = [
          `rclone sync ${opts.from} ${opts.to} --progress --transfers 16 --checkers 32`,
          `# verify: rclone check ${opts.from} ${opts.to}`,
          `# then set the day-one lifecycle rule on the destination: shelf lifecycle set --bucket ${opts.to.split(":")[1] ?? "<bucket>"}`,
        ];

        emit(
          {
            from: opts.from,
            to: opts.to,
            rcloneSteps: steps,
            oneTimeExitEgressUsd: exitEgressUsd,
            exitEgressNote:
              fromProvider === "s3"
                ? `Leaving S3 pays $${S3_EGRESS_PER_GB}/GB ONCE on the full dataset — BUDGET IT (P-27). ${exitEgressUsd === null ? "Pass --storage-gb for the number." : `≈ $${exitEgressUsd} for ${opts.storageGb} GB.`}`
                : "Source is not S3 — exit-egress may still apply; check the source provider's egress pricing.",
            controlPlaneGaps: gaps,
            caveat: "'S3-compatible' moves the DATA plane only (GET/PUT/multipart/presign). The control plane above does NOT port — rebuild it on the target (P-37). Numbers directional (O-28).",
          },
          `migrate ${opts.from} → ${opts.to}\n  steps:\n    ${steps.join("\n    ")}\n  one-time exit egress: ${exitEgressUsd === null ? "(pass --storage-gb)" : `$${exitEgressUsd}`}\n  control-plane that WON'T port:\n    - ${gaps.join("\n    - ")}`,
        );
      }).catch(failFrom);
    });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
