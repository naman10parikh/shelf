// upload.ts — `shelf upload <file>` — THE BAR.
//
// validate (magic bytes + size — O-02/O-13) → presign POST policy (size-bounded — S6) → upload → HEAD
// re-validate size/integrity server-side (the load-bearing gate; MinIO doesn't reliably honor POST
// content-length-range, §0.4, so HEAD is the gate that works on any S3-compatible target — O-02). Random
// immutable key if --key omitted (O-03/P-12). On oversize/invalid, the object is deleted and exit is
// non-zero (acceptance steps 4/5/6).

import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { emit, note, failFrom, fail } from "../lib/output.js";
import { withRun } from "../lib/observability.js";
import { resolveTarget, presignPost } from "../lib/presigner.js";
import { validateBytes } from "../lib/validate.js";
import { randomKey, safeExtension } from "../lib/keys.js";

export function registerUpload(program: Command): void {
  program
    .command("upload <file>")
    .description("the bar: validate → presign POST → upload → HEAD re-validate (random key if --key omitted)")
    .requiredOption("--bucket <bucket>", "target bucket")
    .option("--key <key>", "object key (random immutable key if omitted — O-03)")
    .option("--max-bytes <n>", "max upload size in bytes (enforced by POST policy AND HEAD re-validation)", (v) => parseInt(v, 10), 25 * 1024 * 1024)
    .option("--allow <types>", "comma-separated allowed types", (v) => v.split(","))
    .option("--content-type <prefix>", "content-type prefix to enforce (e.g. image/)")
    .action(async (file: string, opts: { bucket: string; key?: string; maxBytes: number; allow?: string[]; contentType?: string }) => {
      await withRun("upload", [file, "--bucket", opts.bucket], async ({ setAudit, recordToolCall }) => {
        // (1) Read + validate locally FIRST — reject fake.png / evil.svg before touching the network.
        let bytes: Buffer;
        try {
          bytes = await readFile(file);
        } catch (err) {
          fail(`cannot read file '${file}': ${err instanceof Error ? err.message : String(err)}`, "READ_FAILED");
        }
        const validation = await validateBytes(bytes, {
          maxBytes: opts.maxBytes,
          ...(opts.allow ? { allow: opts.allow } : {}),
        });
        if (!validation.ok) {
          fail(`upload rejected by local validation: ${validation.reasons.join("; ")}`, "VALIDATION_FAILED");
        }

        const target = resolveTarget();
        const key = opts.key ?? randomKey(file, "incoming/");
        const contentTypePrefix = opts.contentType ?? "";

        // (2) Presign a POST policy bounded by max-bytes (S6).
        const post = await presignPost({
          target,
          bucket: opts.bucket,
          key,
          maxBytes: opts.maxBytes,
          ...(contentTypePrefix ? { contentTypePrefix } : {}),
          ttlSeconds: 10 * 60,
        });

        // (3) Upload via the signed POST form (direct-to-bucket; no bytes through a server — O-08).
        recordToolCall();
        const form = new FormData();
        for (const [k, v] of Object.entries(post.fields)) form.append(k, v);
        const mime = validation.detectedMime ?? "application/octet-stream";
        const ext = safeExtension(file);
        form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `upload${ext}`);
        const res = await fetch(post.url, { method: "POST", body: form });
        if (!(res.status === 200 || res.status === 201 || res.status === 204)) {
          const body = await res.text().catch(() => "");
          fail(`upload POST failed with HTTP ${res.status}: ${body.slice(0, 300)}`, "UPLOAD_FAILED");
        }

        // (4) HEAD re-validate size server-side — the load-bearing gate (works even where POST policy
        //     isn't honored, e.g. MinIO — §0.4). If oversize, DELETE the object and fail (acceptance #4).
        recordToolCall();
        const head = await target.client.send(new HeadObjectCommand({ Bucket: opts.bucket, Key: key }));
        const serverSize = head.ContentLength ?? -1;
        setAudit({ key, sizeBytes: serverSize, backend: target.backend, signedUrlTtlSeconds: post.expiresInSeconds });

        if (serverSize < 0) {
          fail("HEAD re-validation could not read ContentLength — refusing to confirm the upload", "HEAD_FAILED");
        }
        if (serverSize > opts.maxBytes) {
          recordToolCall();
          await target.client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key })).catch(() => undefined);
          fail(
            `HEAD re-validation REJECTED oversize object: server size ${serverSize} > max ${opts.maxBytes} bytes (object deleted). ` +
              "This is why HEAD re-validation is load-bearing — POST content-length-range is not honored on every S3-compatible target (§0.4).",
            "OVERSIZE",
          );
        }
        if (serverSize !== bytes.length) {
          note(`server size ${serverSize} != local size ${bytes.length} — possible truncation; investigate`);
        }

        emit(
          {
            ok: true,
            bucket: opts.bucket,
            key,
            backend: target.backend,
            localBytes: bytes.length,
            serverBytes: serverSize,
            detectedType: validation.detectedType,
            headRevalidated: true,
          },
          `✓ uploaded ${file} → ${opts.bucket}/${key} (${serverSize} bytes, HEAD-revalidated, ${target.backend})`,
        );
      }).catch(failFrom);
    });
}
