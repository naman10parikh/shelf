// upload-flow.test.ts — D1 verify: the upload routing loop emits the five stages IN ORDER, and the loop
// stops at the failing stage on a reject. The stage ORDERING is the contract (HARNESS-OVERRIDES §8). This
// runs at $0 with no Docker by faking the network boundary (fetch + S3 client send), so the ordering is
// asserted on every CI run; a live-MinIO block additionally asserts the SAME ordering against a real
// bucket when S3_ENDPOINT is set (skipped, not failed, otherwise — the two-form split, like the acceptance
// test). The presigning itself is REAL (AWS-SDK-v3) — only the HTTP round-trips are faked.

import { describe, it, expect, vi, afterEach } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { runUploadFlow, UPLOAD_STAGES } from "./upload-flow.js";
import type { ResolvedTarget } from "../lib/presigner.js";

const FIXTURE = "eval/fixtures/hello.png"; // a real 1×1 PNG (passes magic-byte validation)

// A MinIO-shaped target: REAL presigner client (so presignPost/presignGet produce real signed URLs), but
// we fake fetch + the HEAD/DELETE sends so no network/Docker is needed.
function mockTarget(): ResolvedTarget {
  const client = new S3Client({
    region: "us-east-1",
    endpoint: "http://localhost:9000",
    forcePathStyle: true,
    credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
  });
  return { backend: "minio", region: "us-east-1", endpoint: "http://localhost:9000", client };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("D1 — upload routing loop stage ordering", () => {
  it("UPLOAD_STAGES is the canonical sequence presign→upload→head→validate→confirm", () => {
    expect([...UPLOAD_STAGES]).toEqual(["presign", "upload", "head", "validate", "confirm"]);
  });

  it("emits all five stages IN ORDER on a clean upload (faked network)", async () => {
    const target = mockTarget();
    const fixtureBytes = await import("node:fs/promises").then((m) => m.readFile(FIXTURE));

    // fetch: stage 2 (upload POST) → 204; stage 4 (signed GET re-download) → the stored bytes.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { method?: string }) => {
        if (init?.method === "POST") return new Response(null, { status: 204 });
        return new Response(new Uint8Array(fixtureBytes), { status: 200 }); // the GET re-download
      }),
    );
    // HEAD returns a size within the cap; DELETE never called on the happy path.
    vi.spyOn(target.client, "send").mockImplementation((async (cmd: { constructor: { name: string } }) => {
      if (cmd.constructor.name === "HeadObjectCommand") return { ContentLength: fixtureBytes.length };
      return {};
    }) as unknown as typeof target.client.send);

    const result = await runUploadFlow(FIXTURE, { bucket: "shelf-accept", maxBytes: 1048576, target });

    expect(result.ok).toBe(true);
    expect(result.stages.map((s) => s.stage)).toEqual(["presign", "upload", "head", "validate", "confirm"]);
    expect(result.stages.every((s) => s.ok)).toBe(true);
  });

  it("stops at the HEAD stage and deletes when the stored object is oversize", async () => {
    const target = mockTarget();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const sendSpy = vi
      .spyOn(target.client, "send")
      .mockImplementation((async (cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === "HeadObjectCommand") return { ContentLength: 999_999_999 }; // oversize
        return {}; // the DELETE
      }) as unknown as typeof target.client.send);

    const result = await runUploadFlow(FIXTURE, { bucket: "shelf-accept", maxBytes: 1024, target });

    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("head");
    // Stages reached, in order, up to and including the failing one — never past it.
    expect(result.stages.map((s) => s.stage)).toEqual(["presign", "upload", "head"]);
    expect(result.stages.at(-1)?.ok).toBe(false);
    // The oversize object was deleted (a DeleteObjectCommand was sent).
    const sentDelete = sendSpy.mock.calls.some(
      (c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteObjectCommand",
    );
    expect(sentDelete).toBe(true);
  });
});

// ── Live MinIO (additive, $0-but-Docker-gated): assert the SAME ordering against a real bucket. ─────────
const LIVE = Boolean(process.env.S3_ENDPOINT);
describe.skipIf(!LIVE)("D1 — live MinIO round-trip (S3_ENDPOINT set)", () => {
  it("emits the five stages in order against a real bucket", async () => {
    const result = await runUploadFlow(FIXTURE, {
      bucket: process.env.S3_BUCKET ?? "shelf-accept",
      maxBytes: 1048576,
    });
    expect(result.stages.map((s) => s.stage)).toEqual(["presign", "upload", "head", "validate", "confirm"]);
    expect(result.ok).toBe(true);
  });
});
