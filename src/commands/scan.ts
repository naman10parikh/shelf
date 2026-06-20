// scan.ts — `shelf scan setup --bucket --platform` (O-18 / O-19 / S14).
//
// Scaffolds the incoming→scan→clean/quarantine LIFECYCLE (shelf writes the config an agent deploys — it
// does NOT run a scanner in-process). On AWS the managed default is GuardDuty Malware Protection for S3;
// off-AWS it's the maintained ClamAV pattern (opg-s3-antivirus / clara) — NEVER the archived
// bucket-antivirus-function (P-39). An object is `pending`/unservable until the scan flips it clean
// (O-18 / P-38); the definitions updater (freshclam) is the most-skipped piece — include it.

import type { Command } from "commander";
import { emit, failFrom } from "../lib/output.js";
import { withRun } from "../lib/observability.js";

export function registerScan(program: Command): void {
  const scan = program.command("scan").description("malware-scan scaffolding (a pattern you own off-AWS)");

  scan
    .command("setup")
    .description("scaffold the incoming→scan→clean/quarantine lifecycle (GuardDuty on AWS / ClamAV off-AWS)")
    .requiredOption("--bucket <bucket>", "target bucket")
    .option("--platform <p>", "aws | other", (v) => v, "other")
    .action(async (opts: { bucket: string; platform: string }) => {
      await withRun("scan setup", ["--bucket", opts.bucket, "--platform", opts.platform], async () => {
        const aws = opts.platform === "aws";
        const plan = {
          bucket: opts.bucket,
          platform: aws ? "aws" : "other",
          engine: aws
            ? "GuardDuty Malware Protection for S3 (managed; ML+heuristic beyond ClamAV; defs every ~15 min)"
            : "ClamAV via the MAINTAINED opg-s3-antivirus pattern (or `clara` for ClamAV+YARA) — NEVER the archived bucket-antivirus-function (P-39)",
          lifecycle: [
            "1. uploads land in an `incoming/` (quarantine) prefix served to NOBODY",
            "2. scan runs ASYNC (cold start + scan = seconds–minutes) — do NOT treat the upload 200 as ready (P-38)",
            aws
              ? "3. GuardDuty tags the object with a scan-result tag"
              : "3. the ClamAV worker writes a scan-status tag (clean|infected)",
            "4. serving layer checks scan-status=clean BEFORE serving; promote clean objects, quarantine/delete infected",
          ],
          definitionsUpdater: aws
            ? "managed by GuardDuty (no freshclam to run)"
            : "RUN a separate scheduled `freshclam` — the most-skipped piece; without it the scanner silently rots and misses new malware (O-18)",
          doNot: [
            "do NOT serve before scan-status=clean (P-38)",
            "do NOT base it on the archived bucket-antivirus-function (P-39)",
            aws ? "—" : "do NOT present off-AWS AV as 'solved by an off-the-shelf tool' — it's a pattern you own (engine + defs + quarantine lifecycle)",
          ].filter((x) => x !== "—"),
        };
        emit(
          plan,
          `scan setup for ${opts.bucket} (${plan.platform})\n  engine: ${plan.engine}\n  lifecycle:\n    ${plan.lifecycle.join("\n    ")}\n  defs: ${plan.definitionsUpdater}`,
        );
      }).catch(failFrom);
    });
}
