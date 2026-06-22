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
        try {
          await target.client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: opts.bucket,
              LifecycleConfiguration: { Rules: [rule] },
            }),
          );
        } catch (err) {
          // Some S3-compatible backends (notably MinIO RELEASE.2025-09-07+, minio/minio#16120) reject a
          // lifecycle rule whose ONLY action is AbortIncompleteMultipartUpload — they require an
          // expiration/transition action and return a misleading "MalformedXML"/"InvalidArgument". The
          // abort-only rule IS valid on AWS S3 and Cloudflare R2 (shelf's defaults), which is the correct
          // O-17 shape (clean up dead multiparts WITHOUT expiring the user's objects). We refuse to
          // silently inject an object-expiration here (that would delete data the user never asked to
          // expire). Surface the real cause + the safe next step instead of the raw XML error.
          const name = (err as { name?: string }).name ?? "";
          const msg = ((err as { message?: string }).message ?? "").toLowerCase();
          // MalformedXML is unambiguous. InvalidArgument is broader, so additionally require the message
          // to indicate a schema/XML rejection (MinIO's wording) — a genuinely-different InvalidArgument
          // (or any other error code, e.g. NoSuchBucket/AccessDenied on real S3/R2) still surfaces loudly.
          const isLifecycleSchemaReject =
            name === "MalformedXML" ||
            (name === "InvalidArgument" && (msg.includes("xml") || msg.includes("well-formed") || msg.includes("schema")));
          if (isLifecycleSchemaReject) {
            note(
              `this backend (${target.backend}) rejected an abort-incomplete-multipart-ONLY lifecycle rule ` +
                `(${name}). Some S3-compatible servers — notably MinIO (minio/minio#16120) — require a ` +
                `lifecycle rule to carry an expiration/transition action and don't support abort-only rules. ` +
                `The rule shelf set IS valid + correct on AWS S3 and Cloudflare R2 (shelf's defaults), where ` +
                `it cleans up dead multiparts WITHOUT expiring your objects (O-17). shelf will NOT silently ` +
                `add an object-expiration to satisfy this backend (that would delete data you didn't ask to ` +
                `expire). To enforce the day-one rule, apply it on R2/S3; on this backend, add an explicit ` +
                `expiration yourself if that's truly what you want.`,
            );
            emit({
              ok: false,
              bucket: opts.bucket,
              backend: target.backend,
              abortAfterDays: opts.abortAfterDays,
              reason: "backend rejects abort-incomplete-multipart-only lifecycle rule",
              errorCode: name,
              validOn: "AWS S3 / Cloudflare R2 (abort-only rules are accepted there — the correct O-17 shape)",
            });
            return;
          }
          throw err;
        }
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
