// cors.ts — `shelf cors check --bucket` (O-22 / S9).
//
// R2 has NO default CORS, and R2 presigned-PUT 401s + CORS failures are the single most common storage
// integration bug of 2026 (O-22). This tests the OPTIONS preflight EXPLICITLY for the upload method/headers
// — "works on Chrome" does NOT mean "works everywhere" (Safari/iOS routinely breaks what Chrome handles).

import type { Command } from "commander";
import { GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { emit, note, failFrom } from "../lib/output.js";
import { withRun } from "../lib/observability.js";
import { resolveTarget } from "../lib/presigner.js";

export function registerCors(program: Command): void {
  const cors = program.command("cors").description("CORS preflight checks for direct-to-bucket uploads");

  cors
    .command("check")
    .description("read the bucket CORS policy + remind you to test the OPTIONS preflight (R2 has no default — O-22)")
    .requiredOption("--bucket <bucket>", "target bucket")
    .option("--origin <origin>", "the web origin that will upload (for the preflight reminder)")
    .action(async (opts: { bucket: string; origin?: string }) => {
      await withRun("cors check", ["--bucket", opts.bucket], async ({ recordToolCall }) => {
        const target = resolveTarget();
        recordToolCall();
        let rules: unknown = null;
        let configured = false;
        try {
          const res = await target.client.send(new GetBucketCorsCommand({ Bucket: opts.bucket }));
          rules = res.CORSRules ?? [];
          configured = Array.isArray(res.CORSRules) && res.CORSRules.length > 0;
        } catch (err) {
          // NoSuchCORSConfiguration is the common R2/S3 "you never set CORS" signal — surface it, not fail.
          const message = err instanceof Error ? err.message : String(err);
          note(`no CORS configuration found (or unreadable): ${message}. R2 has NO default CORS — you MUST set it (O-22).`);
        }
        if (!configured) {
          note(`set a CORS policy allowing your upload origin + methods (PUT/POST/GET) + headers, then test the OPTIONS preflight on Safari/iOS too (S9).`);
        }
        emit(
          {
            bucket: opts.bucket,
            backend: target.backend,
            corsConfigured: configured,
            rules,
            preflightReminder: `curl -i -X OPTIONS '${target.endpoint ?? "<endpoint>"}/${opts.bucket}/<key>' -H 'Origin: ${opts.origin ?? "<your-origin>"}' -H 'Access-Control-Request-Method: PUT'`,
            note: "R2 has no default CORS; signature drift (amz-sdk-request) also masquerades as CORS (S7). Test the OPTIONS preflight per method/header, on Safari/iOS too — Chrome passing proves nothing (O-22/P-20).",
          },
          `CORS for ${opts.bucket} (${target.backend}): ${configured ? "configured" : "NOT configured"}\n  test the preflight (Safari/iOS too): see preflightReminder`,
        );
      }).catch(failFrom);
    });
}
