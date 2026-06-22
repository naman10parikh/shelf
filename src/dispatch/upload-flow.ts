// upload-flow.ts — D1: the internal routing loop for the multi-step upload run.
//
// The five stages run IN ORDER and each is recorded on an ordered stage log so the sequence is testable
// (HARNESS-OVERRIDES §8: "tested — run the flow, verify ordering; no bare tmux select-pane"):
//
//   presign → upload → HEAD-revalidate → validate → confirm
//
// This is the agent-native async-validation shape (O-18): a presigned-upload 200 is NOT "ready". We
// presign a size-bounded POST policy (S6), upload direct-to-bucket (O-08), HEAD-revalidate the stored size
// server-side (the load-bearing gate — POST content-length-range isn't honored on every S3-compatible
// target, §0.4), re-VALIDATE the STORED bytes by magic-byte (O-02 — never trust the upload, re-read what
// actually landed), and only THEN confirm (promote out of the incoming/ quarantine prefix — O-18). On any
// rejection the object is deleted and the flow returns ok:false with the failing stage.
//
// It REUSES the exact CLI lib code (one source of truth): presigner / validate / keys / observability —
// it does not re-implement presigning or validation. A pure function returning the stage log; the caller
// (a test, the cockpit, or an agent) decides what to do with it.

import { readFile } from "node:fs/promises";
import {
  HeadObjectCommand,
  DeleteObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  resolveTarget,
  presignPost,
  presignGet,
  type ResolvedTarget,
} from "../lib/presigner.js";
import { validateBytes, type ValidateOptions } from "../lib/validate.js";
import { randomKey } from "../lib/keys.js";

/** The five ordered stages of the upload routing loop. The literal order is the contract D1 is tested on. */
export const UPLOAD_STAGES = ["presign", "upload", "head", "validate", "confirm"] as const;
export type UploadStage = (typeof UPLOAD_STAGES)[number];

/** One entry in the ordered stage log. `ok:false` marks the stage that failed and stops the loop. */
export interface StageRecord {
  stage: UploadStage;
  ok: boolean;
  detail: string;
}

export interface UploadFlowOptions {
  bucket: string;
  /** Object key; a random immutable incoming/ key is generated if omitted (O-03/P-12). */
  key?: string;
  /** Size cap enforced by the POST policy AND re-checked by HEAD (S6). Default 25 MiB. */
  maxBytes?: number;
  /** Allowed types for the post-upload re-validate stage (magic-byte allowlist). */
  allow?: string[];
  /** Signed-URL TTL (seconds) for the presign + the validate re-download. Default 600s. */
  ttlSeconds?: number;
  /** Inject a target (tests); otherwise resolved from env (MinIO via S3_ENDPOINT, R2, or AWS). */
  target?: ResolvedTarget;
}

export interface UploadFlowResult {
  ok: boolean;
  /** The ordered stage log — assert this sequence in a test. */
  stages: StageRecord[];
  bucket: string;
  key: string;
  backend: string;
  serverBytes?: number;
  detectedType?: string | null;
  /** The stage that failed, if ok:false. */
  failedStage?: UploadStage;
  error?: string;
}

/**
 * Run the upload routing loop over a local file against an S3-compatible target. Emits each stage onto an
 * ordered log in the canonical sequence. Pure-ish: it talks to the bucket but returns its result rather
 * than calling process.exit — the caller renders/asserts.
 */
export async function runUploadFlow(file: string, opts: UploadFlowOptions): Promise<UploadFlowResult> {
  const stages: StageRecord[] = [];
  const target = opts.target ?? resolveTarget();
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  const ttlSeconds = opts.ttlSeconds ?? 600;
  const key = opts.key ?? randomKey(file, "incoming/");
  const validateOpts: ValidateOptions = {
    maxBytes,
    ...(opts.allow ? { allow: opts.allow } : {}),
  };

  const bytes = await readFile(file);

  // ── Stage 1: presign ─────────────────────────────────────────────────────────────────────────────
  // A size-bounded POST policy (the default; S6). PUT is deliberately NOT used here (it can't bound size).
  let postUrl: string;
  let postFields: Record<string, string>;
  try {
    const post = await presignPost({ target, bucket: opts.bucket, key, maxBytes, ttlSeconds });
    postUrl = post.url;
    postFields = post.fields;
    stages.push({ stage: "presign", ok: true, detail: `POST policy for ${opts.bucket}/${key} (≤${maxBytes}B, ${ttlSeconds}s)` });
  } catch (e) {
    return stop(stages, "presign", opts.bucket, key, target.backend, e);
  }

  // ── Stage 2: upload ──────────────────────────────────────────────────────────────────────────────
  // Direct-to-bucket via the signed POST form (no bytes through a server — O-08).
  try {
    const form = new FormData();
    for (const [k, v] of Object.entries(postFields)) form.append(k, v);
    form.append("file", new Blob([new Uint8Array(bytes)]), "object.bin");
    const res = await fetch(postUrl, { method: "POST", body: form });
    if (!(res.status === 200 || res.status === 201 || res.status === 204)) {
      const body = await res.text().catch(() => "");
      throw new Error(`upload POST HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    stages.push({ stage: "upload", ok: true, detail: `direct-to-bucket POST → HTTP ${res.status}` });
  } catch (e) {
    return stop(stages, "upload", opts.bucket, key, target.backend, e);
  }

  // ── Stage 3: HEAD-revalidate ─────────────────────────────────────────────────────────────────────
  // Server-side size re-check — the load-bearing gate (works even where POST content-length-range isn't
  // honored, e.g. MinIO — §0.4). Oversize ⇒ delete + fail.
  let serverBytes: number;
  try {
    const head = await target.client.send(new HeadObjectCommand({ Bucket: opts.bucket, Key: key }));
    serverBytes = head.ContentLength ?? -1;
    if (serverBytes < 0) throw new Error("HEAD returned no ContentLength");
    if (serverBytes > maxBytes) {
      await deleteQuietly(target.client, opts.bucket, key);
      throw new Error(`oversize: server ${serverBytes}B > max ${maxBytes}B (object deleted)`);
    }
    stages.push({ stage: "head", ok: true, detail: `HEAD re-validated size ${serverBytes}B ≤ ${maxBytes}B` });
  } catch (e) {
    return stop(stages, "head", opts.bucket, key, target.backend, e);
  }

  // ── Stage 4: validate ────────────────────────────────────────────────────────────────────────────
  // Re-download the STORED bytes via a short-TTL signed GET and re-validate by magic byte (O-02/O-18 —
  // validate what actually landed, not what the client claimed). Reject ⇒ delete + fail.
  let detectedType: string | null = null;
  try {
    const getUrl = (await presignGet({ target, bucket: opts.bucket, key, ttlSeconds })).url;
    const got = await fetch(getUrl);
    if (!got.ok) throw new Error(`signed GET re-download HTTP ${got.status}`);
    const stored = Buffer.from(await got.arrayBuffer());
    const verdict = await validateBytes(stored, validateOpts);
    detectedType = verdict.detectedType;
    if (!verdict.ok) {
      await deleteQuietly(target.client, opts.bucket, key);
      throw new Error(`stored-bytes validation rejected: ${verdict.reasons.join("; ")} (object deleted)`);
    }
    stages.push({ stage: "validate", ok: true, detail: `stored bytes validate as ${detectedType ?? "?"} (magic-byte)` });
  } catch (e) {
    return stop(stages, "validate", opts.bucket, key, target.backend, e);
  }

  // ── Stage 5: confirm ─────────────────────────────────────────────────────────────────────────────
  // Only now is the object "ready": HEAD passed AND the stored bytes validated. In production this flips
  // the serving-layer tag / promotes out of the incoming/ quarantine prefix (O-18). Here we record it.
  stages.push({ stage: "confirm", ok: true, detail: `confirmed ready: ${opts.bucket}/${key} (${serverBytes}B, ${detectedType ?? "?"})` });

  return {
    ok: true,
    stages,
    bucket: opts.bucket,
    key,
    backend: target.backend,
    serverBytes,
    detectedType,
  };
}

function stop(
  stages: StageRecord[],
  stage: UploadStage,
  bucket: string,
  key: string,
  backend: string,
  e: unknown,
): UploadFlowResult {
  const error = e instanceof Error ? e.message : String(e);
  stages.push({ stage, ok: false, detail: error });
  return { ok: false, stages, bucket, key, backend, failedStage: stage, error };
}

async function deleteQuietly(client: S3Client, bucket: string, key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
}
