// presigner.ts — AWS-SDK-v3 presigning + S3 client/endpoint resolution (O-14 / O-22; P-01 / P-03; S6/S7).
//
// shelf presigns with AWS-SDK-v3 directly so the bar NEVER depends on the Cloudflare R2 MCP minting URLs
// (V-12 unconfirmed). Defaults are TRAFFIC-AWARE: presigned POST policy (size+type bounded — S6) is the
// default browser-upload path; PUT is opt-in with the loud "PUT can't bound size" warning (P-01). We
// return the EXACT signed-header set so SDK header-drift (amz-sdk-request) can't masquerade as CORS (S7).
//
// Endpoint resolution (priority): explicit S3_ENDPOINT (MinIO/$0 gate, path-style) → R2 (R2_ENDPOINT or
// derived from R2_ACCOUNT_ID, region "auto") → native AWS S3 (AWS_REGION). Reused by C1 (the MCP server).

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { ShelfError } from "./output.js";

// Mirrors @aws-sdk/s3-presigned-post's internal `Conditions` type (not re-exported from the package index
// as of 3.726). Keep in lockstep with the SDK: EqualCondition | StartsWithCondition | ContentLengthRange.
type PostCondition =
  | ["eq", string, string]
  | ["starts-with", string, string]
  | ["content-length-range", number, number]
  | Record<string, string>;

export type Backend = "r2" | "s3" | "minio";

export interface ResolvedTarget {
  backend: Backend;
  client: S3Client;
  endpoint?: string;
  region: string;
}

/** Result of presigning a POST policy (the default; S3 enforces the conditions). */
export interface PresignPostResult {
  method: "POST";
  url: string;
  /** Form fields the client MUST send verbatim (incl. the signed policy). This IS the signed set. */
  fields: Record<string, string>;
  key: string;
  bucket: string;
  expiresInSeconds: number;
  /** The conditions S3 will enforce (content-length-range, content-type prefix). */
  conditions: unknown[];
  warnings: string[];
}

/** Result of presigning a PUT URL (opt-in; can NOT enforce size — P-01). */
export interface PresignPutResult {
  method: "PUT";
  url: string;
  /** The EXACT signed-header set the client must send — only these, no more (S7 / P-03). */
  signedHeaders: Record<string, string>;
  key: string;
  bucket: string;
  expiresInSeconds: number;
  warnings: string[];
}

/** Result of presigning a GET URL (a bearer capability — O-15). */
export interface PresignGetResult {
  method: "GET";
  url: string;
  key: string;
  bucket: string;
  expiresInSeconds: number;
  warnings: string[];
}

/**
 * Resolve the S3-compatible target (client + endpoint + region) from the environment. Throws a
 * ShelfError listing what's missing if no backend can be resolved — the honest "creds absent" path
 * (D15: live creds are non-blocking for the MinIO merge gate, which sets S3_ENDPOINT + minioadmin).
 */
export function resolveTarget(): ResolvedTarget {
  const env = process.env;

  // 1) Explicit S3-compatible endpoint (MinIO local gate, LocalStack, any S3-compat) — path-style.
  if (env.S3_ENDPOINT) {
    const accessKeyId = env.S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? "minioadmin";
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? "minioadmin";
    const region = env.S3_REGION ?? env.AWS_REGION ?? "us-east-1";
    return {
      backend: "minio",
      region,
      endpoint: env.S3_ENDPOINT,
      client: new S3Client({
        region,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: true, // MinIO/LocalStack need path-style addressing
        credentials: { accessKeyId, secretAccessKey },
      }),
    };
  }

  // 2) Cloudflare R2 — region MUST be "auto" + the account endpoint (O-22). Never depends on the R2 MCP.
  const accountId = env.R2_ACCOUNT_ID;
  const r2Endpoint = env.R2_ENDPOINT ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
  if (r2Endpoint && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return {
      backend: "r2",
      region: "auto",
      endpoint: r2Endpoint,
      client: new S3Client({
        region: "auto",
        endpoint: r2Endpoint,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
      }),
    };
  }

  // 3) Native AWS S3.
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    const region = env.AWS_REGION ?? "us-east-1";
    return {
      backend: "s3",
      region,
      client: new S3Client({ region }),
    };
  }

  throw new ShelfError(
    "no storage backend resolved. Set one of: S3_ENDPOINT (+ S3_ACCESS_KEY_ID/_SECRET — e.g. local MinIO), " +
      "R2_ENDPOINT|R2_ACCOUNT_ID + R2_ACCESS_KEY_ID/_SECRET, or AWS_ACCESS_KEY_ID/_SECRET. " +
      "(The $0 acceptance gate uses MinIO via S3_ENDPOINT — no provider creds needed.)",
    "NO_BACKEND",
  );
}

/**
 * Presign a POST policy — the DEFAULT browser-upload path. S3 enforces content-length-range and the
 * content-type prefix, so a client can NOT exceed maxBytes or change the type (S6). This is the gate PUT
 * cannot provide.
 */
export async function presignPost(args: {
  target: ResolvedTarget;
  bucket: string;
  key: string;
  maxBytes: number;
  contentTypePrefix?: string;
  ttlSeconds: number;
}): Promise<PresignPostResult> {
  const { target, bucket, key, maxBytes, ttlSeconds } = args;
  const conditions: PostCondition[] = [["content-length-range", 0, maxBytes]];
  if (args.contentTypePrefix) {
    conditions.push(["starts-with", "$Content-Type", args.contentTypePrefix]);
  }
  const presigned = await createPresignedPost(target.client, {
    Bucket: bucket,
    Key: key,
    Conditions: conditions,
    Expires: ttlSeconds,
    Fields: args.contentTypePrefix ? { "Content-Type": args.contentTypePrefix } : {},
  });
  return {
    method: "POST",
    url: presigned.url,
    fields: presigned.fields,
    key,
    bucket,
    expiresInSeconds: ttlSeconds,
    conditions: conditions as unknown[],
    warnings: [
      "POST policy enforces content-length-range server-side, but ALWAYS re-validate size via HEAD after upload (S6).",
    ],
  };
}

/**
 * Presign a PUT URL — opt-in. Returns the EXACT signed-header set (send only these — S7 / P-03) and a
 * LOUD warning that PUT can NOT bound size or type (P-01). Use POST policy unless you have a reason.
 */
export async function presignPut(args: {
  target: ResolvedTarget;
  bucket: string;
  key: string;
  contentType?: string;
  ttlSeconds: number;
}): Promise<PresignPutResult> {
  const { target, bucket, key, ttlSeconds } = args;
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(args.contentType ? { ContentType: args.contentType } : {}),
  });
  const url = await getSignedUrl(target.client, cmd, { expiresIn: ttlSeconds });
  // The only header the client must reproduce for a basic PUT is Content-Type (if signed). We surface it
  // explicitly so the client sends EXACTLY this and nothing more (defeats amz-sdk-request drift — S7).
  const signedHeaders: Record<string, string> = {};
  if (args.contentType) signedHeaders["Content-Type"] = args.contentType;
  return {
    method: "PUT",
    url,
    signedHeaders,
    key,
    bucket,
    expiresInSeconds: ttlSeconds,
    warnings: [
      "PRESIGNED PUT CANNOT ENFORCE SIZE OR TYPE (P-01/S6): S3 ignores a signed Content-Length on PUT. A client can upload any size. Prefer `presign upload` (POST policy) for browser uploads; if you keep PUT, you MUST re-validate size via HEAD server-side.",
      "Send ONLY the returned signedHeaders — extra SDK headers (amz-sdk-request) cause 403 SignatureDoesNotMatch that looks like a CORS bug (S7/P-03).",
    ],
  };
}

/** Presign a short-TTL GET URL — a bearer capability (O-15 / P-06). */
export async function presignGet(args: {
  target: ResolvedTarget;
  bucket: string;
  key: string;
  ttlSeconds: number;
}): Promise<PresignGetResult> {
  const { target, bucket, key, ttlSeconds } = args;
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(target.client, cmd, { expiresIn: ttlSeconds });
  return {
    method: "GET",
    url,
    key,
    bucket,
    expiresInSeconds: ttlSeconds,
    warnings: [
      "A signed GET URL is a BEARER CAPABILITY (O-15): anyone holding it has access until it expires (leaks via logs/screenshots/Referer). Keep TTL short (minutes); for revocable per-user access, gate at the edge and 302 to a fresh short URL.",
    ],
  };
}
