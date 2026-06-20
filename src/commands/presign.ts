// presign.ts — `shelf presign upload` / `shelf presign get`.
//
// `presign upload` mints a presigned POST policy by default (size+type bounded — S6) or a PUT with --put
// (loud "can't bound size" warning — P-01). `presign get` mints a short-TTL GET (bearer capability —
// O-15). All emit Zod-validated JSON on --json and return the exact signed set (S7).

import type { Command } from "commander";
import { z } from "zod";
import { emit, note, failFrom } from "../lib/output.js";
import { withRun } from "../lib/observability.js";
import { resolveTarget, presignPost, presignPut, presignGet } from "../lib/presigner.js";

const MINUTE = 60;

const PresignUploadJson = z.object({
  method: z.enum(["POST", "PUT"]),
  url: z.string().url(),
  key: z.string(),
  bucket: z.string(),
  expiresInSeconds: z.number().int().positive(),
  warnings: z.array(z.string()),
  fields: z.record(z.string()).optional(),
  signedHeaders: z.record(z.string()).optional(),
  conditions: z.array(z.unknown()).optional(),
  backend: z.string(),
});

export function registerPresign(program: Command): void {
  const presign = program.command("presign").description("mint presigned upload/download URLs");

  presign
    .command("upload")
    .description("mint a presigned POST policy (default; size+type bounded) or PUT (--put)")
    .requiredOption("--bucket <bucket>", "target bucket")
    .requiredOption("--key <key>", "object key")
    .option("--max-bytes <n>", "max upload size in bytes (POST policy enforces this)", (v) => parseInt(v, 10), 25 * 1024 * 1024)
    .option("--content-type <prefix>", "content-type (POST: enforced as starts-with prefix, e.g. image/)")
    .option("--ttl <seconds>", "URL TTL in seconds", (v) => parseInt(v, 10), 15 * MINUTE)
    .option("--put", "use presigned PUT instead of POST policy (CANNOT bound size — P-01)", false)
    .action(async (opts: { bucket: string; key: string; maxBytes: number; contentType?: string; ttl: number; put: boolean }) => {
      await withRun("presign upload", ["--bucket", opts.bucket, "--key", opts.key], async ({ setAudit }) => {
        const target = resolveTarget();
        if (opts.put) {
          const r = await presignPut({
            target,
            bucket: opts.bucket,
            key: opts.key,
            ...(opts.contentType ? { contentType: opts.contentType } : {}),
            ttlSeconds: opts.ttl,
          });
          setAudit({ key: r.key, backend: target.backend, signedUrlTtlSeconds: r.expiresInSeconds });
          const payload = PresignUploadJson.parse({ ...r, backend: target.backend });
          emit(payload, renderUpload(payload));
          for (const w of r.warnings) note(w);
          return;
        }
        const r = await presignPost({
          target,
          bucket: opts.bucket,
          key: opts.key,
          maxBytes: opts.maxBytes,
          ...(opts.contentType ? { contentTypePrefix: opts.contentType } : {}),
          ttlSeconds: opts.ttl,
        });
        setAudit({ key: r.key, backend: target.backend, signedUrlTtlSeconds: r.expiresInSeconds, sizeBytes: opts.maxBytes });
        const payload = PresignUploadJson.parse({ ...r, backend: target.backend });
        emit(payload, renderUpload(payload));
        for (const w of r.warnings) note(w);
      }).catch(failFrom);
    });

  presign
    .command("get")
    .description("mint a short-TTL presigned GET URL (a bearer capability — O-15)")
    .requiredOption("--bucket <bucket>", "source bucket")
    .requiredOption("--key <key>", "object key")
    .option("--ttl <seconds>", "URL TTL in seconds", (v) => parseInt(v, 10), 5 * MINUTE)
    .action(async (opts: { bucket: string; key: string; ttl: number }) => {
      await withRun("presign get", ["--bucket", opts.bucket, "--key", opts.key], async ({ setAudit }) => {
        const target = resolveTarget();
        const r = await presignGet({ target, bucket: opts.bucket, key: opts.key, ttlSeconds: opts.ttl });
        setAudit({ key: r.key, backend: target.backend, signedUrlTtlSeconds: r.expiresInSeconds });
        const payload = { ...r, backend: target.backend };
        emit(payload, `GET ${r.url}\nexpires in ${r.expiresInSeconds}s`);
        for (const w of r.warnings) note(w);
      }).catch(failFrom);
    });
}

function renderUpload(p: z.infer<typeof PresignUploadJson>): string {
  const lines = [`${p.method} ${p.url}`, `key: ${p.key}`, `bucket: ${p.bucket}`, `expires in ${p.expiresInSeconds}s`];
  if (p.fields) lines.push(`fields: ${Object.keys(p.fields).join(", ")}`);
  if (p.signedHeaders) lines.push(`signed headers (send ONLY these): ${Object.keys(p.signedHeaders).join(", ") || "(none)"}`);
  return lines.join("\n");
}
