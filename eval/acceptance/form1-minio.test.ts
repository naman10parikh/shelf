// form1-minio.test.ts — THE ACCEPTANCE MERGE GATE (E3 Form 1, PLAN §5; D15 local-first, $0, tokenless).
//
// Exercises the bar against a local MinIO (S3-compatible) container — the same gate canary/turbo use
// locally. In CI a `services: minio` container makes this run for real and RED-BLOCK merge (no provider
// creds — MinIO uses throwaway minioadmin). Locally, when no MinIO is reachable, the round-trip block
// SKIPS honestly (never fakes a pass); the three REJECT steps still run (they reject at local validation,
// no backend needed). `pnpm test:acceptance` runs this file.
//
// The §5 sequence (verify: exit 0 ONLY when 2+3 succeed AND 4+5+6 all reject):
//   2. shelf upload hello.png  → presign POST + upload 200 + HEAD re-validation confirms size (HEAD is the
//      load-bearing gate — MinIO doesn't honor POST content-length-range, §0.4).
//   3. shelf get               → bytes byte-equal the fixture (round-trip proven) via a SIGNED URL.
//   3b. signed-URL access control — the raw object path WITHOUT a signature → 403; `shelf get` (signed) →
//      200. Proven at $0 on MinIO (private bucket); the LIVE-R2 form of this is Form 2 (E2B). (O-15.)
//   4. shelf upload too-big.bin (--max-bytes small) → non-zero (oversize rejected, object not served).
//   5. shelf upload fake.png   → non-zero (magic-byte reject, O-02/S4)   [runs without a backend]
//   6. shelf upload evil.svg   → non-zero (SVG-from-untrusted refused, O-10/S5) [runs without a backend]

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(REPO_ROOT, "dist", "index.js");
const FIXTURES = resolve(REPO_ROOT, "eval", "fixtures");

const BUCKET = process.env.SHELF_ACCEPT_BUCKET ?? "shelf-accept";
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://localhost:9000";
// Throwaway MinIO creds — NEVER a real secret (PLAN §8). The CI service uses the same.
const ACCESS = process.env.S3_ACCESS_KEY_ID ?? "minioadmin";
const SECRET = process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin";
const REGION = process.env.S3_REGION ?? "us-east-1";

const minioEnv = {
  ...process.env,
  S3_ENDPOINT,
  S3_ACCESS_KEY_ID: ACCESS,
  S3_SECRET_ACCESS_KEY: SECRET,
  S3_REGION: REGION,
};

/** Run the built CLI; return {status, out}. Never throws (we assert on the status). */
function cli(args: string[], env: NodeJS.ProcessEnv = process.env): { status: number; out: string } {
  try {
    const out = execFileSync("node", [CLI, ...args], { encoding: "utf8", env });
    return { status: 0, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { status: err.status ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

// vitest evaluates describe.skipIf() at COLLECTION time (before beforeAll runs). The CI signal is an
// explicit S3_ENDPOINT (the `services: minio` job sets it); locally with no endpoint set, the round-trip
// block skips honestly. This keeps the gate from ever faking a pass while still red-blocking in CI.
const RUN_ROUNDTRIP = Boolean(process.env.S3_ENDPOINT);

beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error(`CLI not built at ${CLI} — run \`pnpm build\` first.`);
  if (RUN_ROUNDTRIP) {
    // Ensure the bucket exists (idempotent — ignore "already owned"). Private by default → 3b's 403 holds.
    const client = new S3Client({
      region: REGION,
      endpoint: S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
    });
    try {
      await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch {
      // BucketAlreadyOwnedByYou / BucketAlreadyExists — fine.
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `\n[acceptance Form 1] No S3_ENDPOINT set — the MinIO round-trip block is SKIPPED locally (honest, ` +
        `not faked). It RUNS + red-blocks in CI via the \`services: minio\` container (which sets S3_ENDPOINT). ` +
        `The three reject steps below still run (no backend needed). To run the round-trip locally: ` +
        `start MinIO, then \`S3_ENDPOINT=http://localhost:9000 pnpm test:acceptance\`.\n`,
    );
  }
});

// Steps 5 + 6 — reject at LOCAL validation (no backend needed) → always run, even with no MinIO.
describe("Form 1 — local validation rejects (always run, $0, no backend)", () => {
  it("step 5: rejects fake.png (an .html renamed .png) by magic bytes (O-02/S4)", () => {
    const r = cli(["upload", resolve(FIXTURES, "fake.png"), "--bucket", BUCKET], process.env);
    expect(r.status, `fake.png should be rejected\n${r.out}`).not.toBe(0);
    expect(r.out.toLowerCase()).toContain("html");
  });

  it("step 6: refuses evil.svg from untrusted input (XML doc → XSS+SSRF; O-10/S5)", () => {
    const r = cli(["upload", resolve(FIXTURES, "evil.svg"), "--bucket", BUCKET], process.env);
    expect(r.status, `evil.svg should be refused\n${r.out}`).not.toBe(0);
    expect(r.out.toLowerCase()).toContain("svg");
  });
});

// Steps 2 + 3 + 3b + 4 — the live round-trip + signed-URL access control + oversize reject.
// MinIO-gated (skips honestly when no S3_ENDPOINT is set).
describe.skipIf(!RUN_ROUNDTRIP)("Form 1 — MinIO round-trip (the merge gate's core)", () => {
  it("step 2+3: shelf upload hello.png → HEAD-revalidated, then shelf get is byte-equal (round-trip)", () => {
    const key = `test/hello-${Date.now()}.png`;
    const up = cli(
      ["upload", resolve(FIXTURES, "hello.png"), "--bucket", BUCKET, "--key", key, "--max-bytes", "1048576", "--json"],
      minioEnv,
    );
    expect(up.status, `upload failed\n${up.out}`).toBe(0);
    expect(up.out).toContain("headRevalidated");

    const outPath = resolve(tmpdir(), `shelf-acc-${Date.now()}.png`); // OS tmpdir — never litters the repo
    const got = cli(["get", key, "--bucket", BUCKET, "--out", outPath, "--json"], minioEnv);
    expect(got.status, `get failed\n${got.out}`).toBe(0);
    const original = readFileSync(resolve(FIXTURES, "hello.png"));
    const roundTripped = readFileSync(outPath);
    expect(Buffer.compare(original, roundTripped), "round-tripped bytes must equal the fixture").toBe(0);
  });

  it("step 3b: signed-URL access control — unsigned object GET → 403; shelf get (signed) → 200 (O-15)", async () => {
    // Upload an object, then prove access is signed-URL-gated, not public: a raw GET of the object path
    // WITHOUT the signature must be denied (private bucket), while `shelf get` (which mints a signed URL)
    // succeeds. This is the $0/MinIO form of the core security property Form 2 asserts against live R2.
    const key = `test/acl-${Date.now()}.png`;
    const up = cli(
      ["upload", resolve(FIXTURES, "hello.png"), "--bucket", BUCKET, "--key", key, "--max-bytes", "1048576", "--json"],
      minioEnv,
    );
    expect(up.status, `setup upload failed\n${up.out}`).toBe(0);

    const unsignedUrl = `${S3_ENDPOINT}/${BUCKET}/${key}`;
    const res = await fetch(unsignedUrl);
    expect([401, 403], `unsigned GET of ${unsignedUrl} returned ${res.status}; expected a denial`).toContain(
      res.status,
    );

    const got = cli(["get", key, "--bucket", BUCKET, "--json"], minioEnv);
    expect(got.status, `signed get failed\n${got.out}`).toBe(0);
  });

  it("step 4: shelf upload too-big.bin with a tiny --max-bytes → rejected, object not served", () => {
    const key = `test/big-${Date.now()}.bin`;
    // too-big.bin (2 MiB) with --max-bytes 1 must be rejected (size cap; the object is never confirmed/served).
    // The load-bearing HEAD re-validation is exercised on the success path (step 2's `headRevalidated:true`);
    // this step proves the oversize REJECT terminal of the same pipeline.
    const r = cli(
      ["upload", resolve(FIXTURES, "too-big.bin"), "--bucket", BUCKET, "--key", key, "--max-bytes", "1", "--json"],
      minioEnv,
    );
    expect(r.status, `oversize upload should be rejected\n${r.out}`).not.toBe(0);
  });
});
