// serve-config.ts — `shelf serve-config --bucket` (O-11 / O-20 / S12).
//
// Emits the TWO-SIDED safe-serve config: (a) the read-side security headers that defuse stored XSS even
// if a bad file slipped past the write-side (forced Content-Type + Content-Disposition: attachment +
// X-Content-Type-Options: nosniff + a separate cookieless domain + CSP — O-11), and (b) the TWO-TIER CDN
// cache policy so you change the URL instead of invalidating (immutable hashed assets + no-cache pointer
// — O-20). One-sided defense is no defense (O-11).

import type { Command } from "commander";
import { emit, failFrom } from "../lib/output.js";
import { withRun } from "../lib/observability.js";

export function registerServeConfig(program: Command): void {
  program
    .command("serve-config")
    .description("emit the safe-serve headers (two-sided) + the two-tier CDN cache policy (O-11/O-20)")
    .requiredOption("--bucket <bucket>", "the bucket these objects are served from")
    .action(async (opts: { bucket: string }) => {
      await withRun("serve-config", ["--bucket", opts.bucket], async () => {
        const config = {
          bucket: opts.bucket,
          readSideSecurityHeaders: {
            "Content-Type": "<forced safe type, e.g. image/png — NEVER re-derived from the file extension (P-08)>",
            "Content-Disposition": "attachment",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
          serveFrom: "a SEPARATE cookieless domain (so a stored-XSS payload can't read your app's session cookies — O-11)",
          cdnCachePolicy: {
            hashedImmutableAssets: "Cache-Control: max-age=31536000, immutable  (content-hashed URLs — new content = new URL)",
            htmlOrPointer: "Cache-Control: no-cache  (or short TTL — the document that POINTS at hashed assets must NOT be over-cached, P-33)",
          },
          invalidation: "DON'T purge for deploys — change the URL (O-20). Reserve purge (Cache Tags / surrogate keys, never `/*`) for pulling leaked/illegal content (P-32).",
          note: "Sanitize at BOTH ends: write-side magic-byte validate + random keys, read-side forced type + attachment + nosniff. One-sided defense is no defense (O-11).",
        };
        emit(
          config,
          `serve-config for ${opts.bucket}\n  read-side headers:\n    Content-Type: <forced safe>\n    Content-Disposition: attachment\n    X-Content-Type-Options: nosniff\n    CSP: default-src 'none'; sandbox\n  serve from: separate cookieless domain\n  CDN: immutable hashed assets + no-cache pointer → change the URL, don't invalidate (O-20)`,
        );
      }).catch(failFrom);
    });
}
