// lifecycle.ts — `shelf lifecycle set` / `shelf lifecycle orphans` (O-17 / P-24 / S11).
//
// `set` applies the DAY-ONE hygiene rule on every upload bucket: abort incomplete multipart uploads after
// N days (default 7). Orphaned multiparts persist, bill as storage forever, and are INVISIBLE to a normal
// ListObjects — the #1 mystery storage bill (O-17). `orphans` hunts them via rclone (P-24).

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { PutBucketLifecycleConfigurationCommand } from "@aws-sdk/client-s3";
import { emit, note, failFrom } from "../lib/output.js";
import { withRun } from "../lib/observability.js";
import { resolveTarget } from "../lib/presigner.js";

export function registerLifecycle(program: Command): void {
  const lifecycle = program.command("lifecycle").description("bucket lifecycle hygiene (the day-one rule)");

  lifecycle
    .command("set")
    .description("set the abort-incomplete-multipart-uploads rule (the day-one hygiene rule — O-17)")
    .requiredOption("--bucket <bucket>", "target bucket")
    .option("--abort-after-days <n>", "abort incomplete multiparts after N days", (v) => parseInt(v, 10), 7)
    .action(async (opts: { bucket: string; abortAfterDays: number }) => {
      await withRun("lifecycle set", ["--bucket", opts.bucket], async ({ recordToolCall, setAudit }) => {
        const target = resolveTarget();
        const rule = {
          ID: "shelf-abort-incomplete-multipart",
          Status: "Enabled" as const,
          Filter: { Prefix: "" },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: opts.abortAfterDays },
        };
        recordToolCall();
        await target.client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: opts.bucket,
            LifecycleConfiguration: { Rules: [rule] },
          }),
        );
        setAudit({ backend: target.backend, key: opts.bucket });
        emit(
          { ok: true, bucket: opts.bucket, abortAfterDays: opts.abortAfterDays, backend: target.backend, rule },
          `✓ set abort-incomplete-multipart after ${opts.abortAfterDays}d on ${opts.bucket} (${target.backend}). This is the #1 invisible-bill defense (O-17).`,
        );
      }).catch(failFrom);
    });

  lifecycle
    .command("orphans")
    .description("find orphaned multipart uploads (the invisible cost) via rclone (P-24)")
    .requiredOption("--bucket <bucket>", "target bucket")
    .option("--remote <name>", "rclone remote name (defaults to env RCLONE_REMOTE)")
    .action(async (opts: { bucket: string; remote?: string }) => {
      await withRun("lifecycle orphans", ["--bucket", opts.bucket], async ({ recordToolCall }) => {
        const remote = opts.remote ?? process.env.RCLONE_REMOTE;
        if (!remote) {
          note("no rclone remote configured (set --remote or RCLONE_REMOTE). Run `rclone config` to add one.");
          emit({
            ok: false,
            bucket: opts.bucket,
            reason: "no rclone remote configured",
            howto: `rclone backend list-multipart-uploads <remote>:${opts.bucket}`,
          });
          return;
        }
        recordToolCall();
        const proc = spawnSync("rclone", ["backend", "list-multipart-uploads", `${remote}:${opts.bucket}`], { encoding: "utf8" });
        if (proc.error || proc.status !== 0) {
          note(`rclone not available or failed: ${proc.error?.message ?? proc.stderr?.trim() ?? `exit ${proc.status}`}`);
          emit({
            ok: false,
            bucket: opts.bucket,
            remote,
            reason: "rclone unavailable",
            howto: `rclone backend list-multipart-uploads ${remote}:${opts.bucket}`,
          });
          return;
        }
        emit({ ok: true, bucket: opts.bucket, remote, raw: proc.stdout.trim() }, proc.stdout.trim() || "(no orphaned multiparts found)");
      }).catch(failFrom);
    });
}
