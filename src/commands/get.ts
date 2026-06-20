// get.ts — `shelf get <key>` — the round-trip's read side.
//
// Mints a short-TTL signed GET URL (O-15) and fetches the bytes THROUGH that signed URL (proving
// signed-URL access control end-to-end), writing to --out. This is acceptance step 3 (byte-equal
// round-trip).

import type { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { emit, failFrom, fail } from "../lib/output.js";
import { withRun } from "../lib/observability.js";
import { resolveTarget, presignGet } from "../lib/presigner.js";

export function registerGet(program: Command): void {
  program
    .command("get <key>")
    .description("fetch an object via a signed URL (the round-trip read side)")
    .requiredOption("--bucket <bucket>", "source bucket")
    .option("--out <path>", "write bytes to this path (otherwise reports size only)")
    .option("--ttl <seconds>", "signed-URL TTL", (v) => parseInt(v, 10), 300)
    .action(async (key: string, opts: { bucket: string; out?: string; ttl: number }) => {
      await withRun("get", [key, "--bucket", opts.bucket], async ({ setAudit, recordToolCall }) => {
        const target = resolveTarget();
        const signed = await presignGet({ target, bucket: opts.bucket, key, ttlSeconds: opts.ttl });
        recordToolCall();
        const res = await fetch(signed.url);
        if (res.status !== 200) {
          const body = await res.text().catch(() => "");
          fail(`signed GET failed with HTTP ${res.status}: ${body.slice(0, 200)}`, "GET_FAILED");
        }
        const buf = Buffer.from(await res.arrayBuffer());
        setAudit({ key, sizeBytes: buf.length, backend: target.backend, signedUrlTtlSeconds: signed.expiresInSeconds });
        if (opts.out) {
          await writeFile(opts.out, buf);
        }
        emit(
          { ok: true, bucket: opts.bucket, key, backend: target.backend, bytes: buf.length, out: opts.out ?? null },
          `✓ fetched ${opts.bucket}/${key} via signed URL — ${buf.length} bytes${opts.out ? ` → ${opts.out}` : ""}`,
        );
      }).catch(failFrom);
    });
}
