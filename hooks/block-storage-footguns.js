#!/usr/bin/env node
/**
 * block-storage-footguns.js — shelf's DOGFOOD PreToolUse gate (brain P-13/P-12/P-40/P-01).
 *
 * shelf is the object-storage employee; this hook makes it OBEY its own storage rules on
 * its own repo. It blocks a Write/Edit/Bash that introduces one of the four footguns shelf
 * preaches against — the proof that the storage employee eats its own cooking:
 *   (P-13) `ACL: 'public-read'` (or any object ACL) on a putObject — S3 throws
 *          `AccessControlListNotSupported` now (ACLs disabled by default; O-16). Use a bucket
 *          policy / CDN, never an object ACL.
 *   (P-12) a user-supplied filename interpolated into an object Key — path-traversal +
 *          non-ASCII encoding mismatch + overwrite-staleness. Use a random server-side key
 *          and keep the filename in metadata (O-02).
 *   (P-40) a `new Map()` used as upload/session STATE — empty on every serverless cold start.
 *          Use a serverless-safe external store (Upstash/Supabase) (O-25).
 *   (P-01) a presigned **PUT** used to "bound" size (signing Content-Length on a PUT) — S3
 *          does not enforce it; the upload is unbounded. Use a presigned POST policy with
 *          `content-length-range` + HEAD re-validation (O-14).
 *
 * ES module (the repo is `"type": "module"`) so `node hooks/block-storage-footguns.js` runs
 * with NO build step from the repo root.
 *
 * Two input modes on stdin (auto-detected), mirroring the hush sibling precedent:
 *   1. Claude Code PreToolUse envelope: `{ "tool_name", "tool_input": {...} }`
 *      → inspect the Write/Edit content or the Bash command; emit the PreToolUse deny JSON.
 *   2. Raw text (anything that isn't that envelope) → treat the whole stdin as the candidate
 *      (the verify line pipes `printf "...ACL: 'public-read'..." | node hooks/...`).
 * Exit code is the load-bearing contract: NONZERO (2) on a finding, 0 on clean — so
 * `... ; test $? -ne 0` passes on a planted footgun and `test $? -eq 0` on clean code.
 *
 * Every block is appended to the hook log (`.claude/hook-block.log`) so the side effect is
 * visible (a hook that exists but never fired = 🟡).
 *
 * DOGFOOD discipline: the patterns match footgun CODE SHAPE, not prose that merely *mentions*
 * the footgun — shelf's own skills/brain DISCUSS `ACL:'public-read'` and `new Map()` as
 * anti-patterns and must NOT be blocked. See PATTERN comments for how each avoids that.
 *
 * Setup (wired in .claude/settings.json):
 *   "PreToolUse": [{ "matcher": "Write|Edit|Bash",
 *     "hooks": [{ "type": "command",
 *       "command": "node \"$CLAUDE_PROJECT_DIR/hooks/block-storage-footguns.js\"" }] }]
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, env } from "node:process";
import { pathToFileURL } from "node:url";

// ── the four footgun patterns (CODE-SHAPE matchers, not prose) ──────────────────
// Each names its brain rule so a block message can cite it. The shapes are chosen to
// fire on the footgun being WRITTEN, while a sentence that merely talks about it (no
// code punctuation) does not match — so shelf's own anti-pattern docs stay un-blocked.
export const FOOTGUN_PATTERNS = [
  {
    // P-13: an object ACL set to a public value — `ACL: 'public-read'` / `ACL:"public-read"`
    // / `"ACL":"public-read"`. Requires the `ACL` *key* immediately bound (`:`) to a quoted
    // public-* value — a prose mention like "never set ACL: 'public-read'" in a code fence
    // would still be code-shaped, but the dogfood reality is shelf's docs phrase it as a
    // refusal ("`ACL:'public-read'` / object ACLs — throws") which DOES carry the shape; we
    // accept that the hook is conservative (better to gate a doc edit than miss real code) —
    // the verify removes the string and the action passes, proving both directions.
    rule: "P-13-object-acl",
    regex: /["']?ACL["']?\s*:\s*["'](?:public-read(?:-write)?|authenticated-read)["']/,
    why: "an object ACL set to a public value (P-13/O-16). S3 disables ACLs by default → `putObject({ACL:'public-read'})` throws AccessControlListNotSupported. Use a bucket policy or a CDN in front; never an object ACL.",
  },
  {
    // P-40: `new Map()` used for upload/session STATE on serverless. Match `new Map()` only
    // when it's bound to a state-ish identifier (uploads/sessions/state/parts/multipart/
    // pending) — a generic `new Map()` for a lookup table is fine, so we DON'T blanket-ban it
    // (that would over-fire). The binding context is what makes it the footgun.
    rule: "P-40-map-upload-state",
    regex: /(?:upload|session|multipart|parts|pending|inflight|in_flight)[A-Za-z0-9_]*\s*=\s*new\s+Map\s*\(/i,
    why: "a `new Map()` used for upload/session state (P-40/O-25). It is empty on every serverless cold start. Use a serverless-safe external store (Upstash/Supabase) for upload state.",
  },
  {
    // P-01: a presigned PUT signed with Content-Length to "bound" size. Match a putObject/
    // PutObjectCommand presign that also carries a ContentLength — the shape of "I tried to
    // cap size on a PUT". (Presigned POST with content-length-range is the correct path and
    // is NOT matched — it uses snake/kebab `content-length-range`, not `ContentLength` on a
    // PutObjectCommand.)
    rule: "P-01-presigned-put-size",
    regex: /PutObjectCommand[\s\S]{0,160}?ContentLength\s*:|ContentLength\s*:[\s\S]{0,160}?PutObjectCommand/,
    why: "a presigned PUT signing ContentLength to 'bound' size (P-01/O-14). S3 does NOT enforce Content-Length on a presigned PUT — the upload is unbounded. Use a presigned POST policy with `content-length-range` + a server-side HEAD re-validation.",
  },
  {
    // P-12: a user-supplied filename interpolated into an object Key. Match `Key:` bound to a
    // template/concat that contains a filename-ish variable (originalname/filename/file.name/
    // req.file…). A random-UUID key (`Key: randomKey()` / `Key: crypto.randomUUID()`) does NOT
    // match — only an interpolation that drags a user filename into the key does.
    rule: "P-12-filename-in-key",
    regex: /["']?Key["']?\s*:\s*(?:`[^`]*\$\{[^}]*(?:originalname|filename|file\.name|req\.file|userfile|uploadname)[^}]*\}[^`]*`|[^,\n]*\+[^,\n]*(?:originalname|filename|file\.name|req\.file))/i,
    why: "a user-supplied filename interpolated into the object Key (P-12/O-02). That is path-traversal + non-ASCII encoding-mismatch + overwrite-staleness in one. Generate a random server-side key; keep the original filename in metadata/DB.",
  },
];

/** First footgun-shaped hit in `text` → { rule, why } | null. */
export function findFootgun(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  for (const { rule, regex, why } of FOOTGUN_PATTERNS) {
    if (regex.test(text)) return { rule, why };
  }
  return null;
}

/**
 * Inspect a PreToolUse envelope. Returns a block {rule, why, surface} or null (allow).
 * Looks at Write/Edit content (new_string|content) and Bash commands.
 */
export function inspectEnvelope(tool, input) {
  if (!input) return null;
  const filePath = input.file_path;
  const content =
    typeof input.content === "string"
      ? input.content
      : typeof input.new_string === "string"
        ? input.new_string
        : "";
  const candidate = tool === "Bash" ? input.command : content;
  const hit = findFootgun(typeof candidate === "string" ? candidate : "");
  if (hit) {
    return {
      rule: hit.rule,
      why: hit.why,
      surface: tool === "Bash" ? "a command" : filePath || "a file",
    };
  }
  return null;
}

/** Append a block record to the hook log (the visible side effect). */
function logBlock(rule, surface) {
  try {
    const projectDir = env.CLAUDE_PROJECT_DIR || process.cwd();
    const logPath = join(projectDir, ".claude", "hook-block.log");
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(
      logPath,
      `${new Date().toISOString()} BLOCK [${rule}] ${surface}\n`,
    );
  } catch {
    // Never let a logging failure wedge the gate — the block still stands via exit code.
  }
}

/** Emit the PreToolUse deny payload + a nonzero exit (the dual contract). */
function blockHook(rule, why, surface) {
  logBlock(rule, surface);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `🛑 [shelf:block-storage-footguns:${rule}] Blocked: ${why}`,
      },
    }),
  );
  process.exit(2);
}

/** Emit a nonzero exit for a raw-text (non-envelope) finding. */
function blockRaw(rule, surface) {
  logBlock(rule, surface);
  process.stderr.write(
    `🛑 [shelf:block-storage-footguns:${rule}] storage footgun detected — blocked.\n`,
  );
  process.exit(2);
}

export async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  // Mode 1: Claude Code PreToolUse envelope.
  let envelope = null;
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object" && typeof parsed.tool_name === "string") {
      envelope = parsed;
    }
  } catch {
    // Not JSON → raw-text mode (mode 2) below.
  }

  if (envelope) {
    // Only gate the mutating tools; everything else passes through.
    if (!["Write", "Edit", "Bash"].includes(envelope.tool_name)) {
      process.stdout.write("{}");
      return;
    }
    const block = inspectEnvelope(envelope.tool_name, envelope.tool_input);
    if (block) blockHook(block.rule, block.why, block.surface);
    process.stdout.write("{}"); // allow
    return;
  }

  // Mode 2: raw piped text (verify lines) — the whole stdin is the candidate.
  const hit = findFootgun(input);
  if (hit) blockRaw(hit.rule, "raw-stdin");
  // Clean → exit 0 (default), no output needed.
}

// Run when invoked directly (not when imported by a test).
const isMain = import.meta.url === pathToFileURL(argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    // Fail OPEN on an internal hook error (never wedge the agent on a hook bug),
    // but surface it on stderr so the failure is visible.
    process.stderr.write(`[block-storage-footguns] internal error: ${e && e.message}\n`);
    process.stdout.write("{}");
  });
}
