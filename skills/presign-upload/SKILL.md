---
name: presign-upload
description: Mint a presigned upload URL the RIGHT way — POST policy (size+type bounded) over PUT (can't enforce size), return the EXACT signed-header set so SDK header-drift can't masquerade as a CORS bug, and know that effective expiry = min(set-TTL, remaining-STS-session). Use this before any browser/agent direct-to-bucket upload.
trigger: When generating a presigned upload URL, designing a direct-to-bucket upload, debugging a presigned upload that 403s as "CORS", or when someone reaches for a presigned PUT to "enforce" a size limit.
---

# presign-upload — POST policy > PUT, signed-header-set exact, expiry is a ceiling

> **The stance (brain O-14 / O-08):** a presigned URL is a **strict cryptographic protocol, not a
> convenient shortcut.** Default to **presigned POST policy** (signs *fields + conditions*, so it can
> enforce `content-length-range` and `starts-with $Content-Type` AND the SDK can't inject un-sendable
> headers) — reserve **PUT** for the rare single-object case and WARN it cannot bound size.
> Source of truth: `brain/OPINIONS.md` **O-14 / O-08**, `brain/BATTLE-TESTED-SCENARIOS.md` **S6 / S7**,
> `brain/KNOWN-PITFALLS.md` **P-01 / P-03 / P-04 / P-05**. Run `shelf explain O-14` for the full stance.

## Trigger

A flow needs a presigned upload URL, OR a presigned upload silently 403s with `SignatureDoesNotMatch`
(the failing request is the `OPTIONS` preflight, so engineers chase CORS — S7), OR someone signed
`Content-Length` on a **PUT** expecting it to cap size and a 5 GB file went through a "1 MB" URL (S6/P-01).

## Steps

1. **Default to POST policy, not PUT.** `shelf presign upload --bucket B --key K --max-bytes N
   --content-type image/png --json`. The minted policy carries `["content-length-range", min, max]` and
   `["starts-with", "$Content-Type", ...]` — S3/R2 enforce these at the edge; PUT cannot (P-01).
2. **If you genuinely need PUT** (`--put`), READ the warning shelf emits: a presigned PUT does **not**
   enforce `Content-Length` server-side — you MUST re-validate size via HEAD after upload (O-14 / P-01).
3. **Send only the exact signed-header set** shelf returns to the client — no more, no less. SDKs auto-
   inject `amz-sdk-request` / checksum headers into the *signed* set; the browser never sends them →
   `403 SignatureDoesNotMatch` misdiagnosed as CORS (P-03 / S7). POST policy sidesteps this entirely.
4. **Treat the TTL as a ceiling, not a guarantee.** Effective expiry = `min(set-TTL, remaining-STS-
   session)`; a Lambda-signed "24h" URL dies at ~1h on temp creds, with a SigV4 7-day hard cap (P-04).
   Keep upload-URL TTLs in **minutes**; re-issue on demand rather than handing out long-lived URLs.
5. **NTP-sync the signer.** >15 min clock skew = instant `SignatureDoesNotMatch`; debug by diffing the
   canonical request, never by rotating credentials (P-05). On R2, sign with `region:"auto"` + the
   account endpoint, and set CORS explicitly (R2 has no default — O-22; `shelf cors check`).

## Output

A presigned **POST policy** (default) JSON: `{ url, fields: { ..., "content-length-range" condition },
signedHeaders }` — size+type bounded, header-drift-proof. For `--put`: a PUT URL **plus** the explicit
"can't enforce size — HEAD re-validate" warning. Verify: `shelf presign upload --bucket X --key Y --json`
emits parseable JSON with a `url` field and the `content-length-range` condition; the `--put` path prints
the size-cannot-be-enforced warning.

## Anti-patterns (refuse these)

- A presigned **PUT** sold as a way to "limit upload size/type" — it can't (P-01). Use POST policy + HEAD.
- Diagnosing a `403 SignatureDoesNotMatch` as a CORS problem and editing the CORS config (S7/P-03) — it's
  signature drift; return the exact signed-header set or switch to POST policy.
- A long-lived presigned URL handed out as a "feature" — it's a bearer capability that leaks via logs /
  Referer / screenshots (P-06). Short TTL + re-issue at the edge.
