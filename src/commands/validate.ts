// validate.ts (command) — `shelf validate <file>`.
//
// Magic-byte type detection (NOT the client extension — O-02/P-07) + resource-consumption caps
// (size/pixels/ratio — O-13/P-11) + SVG-from-untrusted refusal (O-10/P-09). Exits NON-ZERO on reject —
// this is the load-bearing gate behind the acceptance test (fake.png, evil.svg both rejected).

import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { emit, failFrom, fail } from "../lib/output.js";
import { withRun } from "../lib/observability.js";
import { validateBytes, DEFAULT_ALLOW } from "../lib/validate.js";

export function registerValidate(program: Command): void {
  program
    .command("validate <file>")
    .description("validate an upload by magic bytes + resource-consumption caps (refuses SVG-from-untrusted)")
    .option("--allow <types>", `comma-separated allowed types (default: ${DEFAULT_ALLOW.join(",")})`, (v) => v.split(","))
    .option("--max-bytes <n>", "max raw byte size", (v) => parseInt(v, 10))
    .option("--max-pixels <n>", "max total pixels (pixel-flood cap)", (v) => parseInt(v, 10))
    .option("--max-ratio <n>", "max aspect ratio", (v) => parseFloat(v))
    .action(async (file: string, opts: { allow?: string[]; maxBytes?: number; maxPixels?: number; maxRatio?: number }) => {
      await withRun("validate", [file], async () => {
        let bytes: Buffer;
        try {
          bytes = await readFile(file);
        } catch (err) {
          fail(`cannot read file '${file}': ${err instanceof Error ? err.message : String(err)}`, "READ_FAILED");
        }
        const result = await validateBytes(bytes, {
          ...(opts.allow ? { allow: opts.allow } : {}),
          ...(opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}),
          ...(opts.maxPixels !== undefined ? { maxPixels: opts.maxPixels } : {}),
          ...(opts.maxRatio !== undefined ? { maxRatio: opts.maxRatio } : {}),
        });
        emit(
          { file, ...result },
          result.ok
            ? `✓ ${file} OK — ${result.detectedType} (${result.detectedMime ?? "?"}), ${result.sizeBytes} bytes` +
                (result.width ? `, ${result.width}×${result.height}` : "")
            : `✗ ${file} REJECTED:\n  - ${result.reasons.join("\n  - ")}`,
        );
        // ok:false → non-zero exit. THIS is the acceptance reject (fake.png / evil.svg / oversize).
        if (!result.ok) fail(`validation failed: ${result.reasons[0] ?? "rejected"}`, "VALIDATION_FAILED");
      }).catch(failFrom);
    });
}
