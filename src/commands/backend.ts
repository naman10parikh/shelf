// backend.ts — `shelf backend pick --workload <...>` — per-workload backend recommendation (O-05/O-06/S3).
//
// The 2025 gospel "S3 is the safe default" is dead; the 2026 reflex "R2 is the cheap default" is ALSO
// wrong. The expert move is PER-WORKLOAD (O-05). shelf names the recommendation AND the condition that
// flips it (O-27) — the flip condition is the expertise; anyone can have an opinion.

import type { Command } from "commander";
import { emit, failFrom, fail } from "../lib/output.js";
import { withRun } from "../lib/observability.js";

type Workload = "hot-public" | "write-heavy" | "cold" | "event-driven" | "compliance";

const RECS: Record<Workload, { backend: string; why: string; flipWhen: string }> = {
  "hot-public": {
    backend: "Cloudflare R2",
    why: "download-many / hot public media: R2's $0 egress wins decisively (~$15/mo vs ~$891/mo at 10 TB egress on S3). Front it with the CDN you're already on (O-04/O-05).",
    flipWhen: "Flip to S3+CloudFront only if you need S3 event notifications on these objects, or compliance WORM (R2 can't do certified WORM — P-30).",
  },
  "write-heavy": {
    backend: "S3 (or batch the writes)",
    why: "R2 egress is free but Class A (write) ops are $4.50/M → 100M writes/mo = $450/mo in write fees alone (P-25). Thumbnail-gen / log-shipping / per-event object writes get expensive on R2.",
    flipWhen: "Stay on R2 if the workload is also egress-heavy AND you batch writes to cut Class A op count; the egress savings can still dominate.",
  },
  cold: {
    backend: "B2 / Wasabi (archival) or S3 Glacier/IA (tiered)",
    why: "R2 storage $0.015/GB is ~2.5× Wasabi/B2 and has NO Glacier/IA tiering → ~69% pricier than S3+lifecycle on cold/data-lake (P-26). With egress ≈ 0, R2's only benefit is unused.",
    flipWhen: "Never default cold data to R2. If a small amount of cold data lives alongside hot R2 data, the operational simplicity of one provider may still win — compute it, don't moralize it.",
  },
  "event-driven": {
    backend: "S3",
    why: "R2 has no S3-style event notifications — if your pipeline triggers Lambdas / queues on object-created, you need S3 events (or you rebuild the control plane). 'S3-compatible' is a DATA-plane promise only (P-37).",
    flipWhen: "Flip to R2 only if you move the trigger off object-events (e.g. the uploader notifies a queue directly) — then R2's egress savings apply.",
  },
  compliance: {
    backend: "S3 compliance mode (or B2 compliance mode)",
    why: "Certified WORM (SEC 17a-4) needs S3/B2 COMPLIANCE-mode Object Lock — nobody (not even root) can delete until expiry. R2 Bucket Locks are governance-grade only (admins can remove rules) — do NOT promise certified WORM on R2 (P-30).",
    flipWhen: "If the requirement is governance-grade retention (not certified), R2 Bucket Locks suffice and you keep the egress benefit. Enable Object Lock AT BUCKET CREATION — it can't be added later (P-29).",
  },
};

export function registerBackend(program: Command): void {
  const backend = program.command("backend").description("storage backend selection (per-workload)");

  backend
    .command("pick")
    .description("recommend a backend for a workload + the condition that flips it (O-05/O-27)")
    .requiredOption("--workload <type>", `one of: ${Object.keys(RECS).join(", ")}`)
    .action(async (opts: { workload: string }) => {
      await withRun("backend pick", [opts.workload], async () => {
        const wl = opts.workload as Workload;
        const rec = RECS[wl];
        if (!rec) {
          fail(`unknown workload '${opts.workload}'. Choose one of: ${Object.keys(RECS).join(", ")}`, "BAD_WORKLOAD");
        }
        emit(
          { workload: wl, ...rec, default: "R2 is the fleet default but TRAFFIC-AWARE, not dogma (O-05)." },
          `workload: ${wl}\n  → recommend: ${rec.backend}\n  why: ${rec.why}\n  flips when: ${rec.flipWhen}`,
        );
      }).catch(failFrom);
    });
}
