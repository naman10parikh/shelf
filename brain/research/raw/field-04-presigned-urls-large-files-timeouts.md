---
title: "Field Intel 04 — Presigned-URL Footguns, Large-File & Timeout Traps"
type: source
created: 2026-06-16
tags: [field-intelligence, presigned-url, multipart, lambda, timeout, signature, aws-sdk]
summary: "The operational (not security) ways presigned uploads break in prod: signed-header drift, clock skew, IAM-session expiry, the 6MB Lambda wall, and non-ASCII filename key mismatches."
sources_meta: "WebFetch of a first-person Go-SDK postmortem + AWS re:Post + theburningmonk + uploadthing GitHub issues, June 2026."
---

# Field Intel 04 — Presigned-URL Footguns & Large-File Traps

> Presigned URLs are *the* correct pattern for direct-to-storage uploads (bypasses your server's payload limits). But they are a **strict cryptographic protocol**, not "a convenient upload shortcut" — and treating them casually is how uploads silently 403 in production.

## 1. The `amz-sdk-request` signed-header bug (first-person prod postmortem — the best one)

**Saket Agrawal, "The S3 Pre-Signed URL Bug That Took Down Our Uploads" (Medium, <https://medium.com/@saketneel15/the-s3-pre-signed-url-bug-that-took-down-our-uploads-a-deep-dive-into-signedheaders-cors-and-aws-789492e191a3>):**

- **What broke:** Next.js frontend → S3 direct uploads failed with `403 SignatureDoesNotMatch`. Total upload outage in prod.
- **Root cause (verbatim):** *"The AWS SDK for Go v2 automatically injects an internal header named `amz-sdk-request` and includes it in the signed headers."* The browser never sends that header → the actual request's header set ≠ the signed header set → S3 rejects.
- **The misdiagnosis trap (verbatim):** *"The signature mismatch caused S3 to reject the preflight OPTIONS request before adding CORS headers, making engineers misdiagnose it as a CORS problem rather than signature validation failure."* They burned time on CORS that was never broken.
- **The fix (the durable pattern):** backend returns **the URL AND the exact list of headers that were signed**; the frontend sends *only those headers — no more, no less.* Perfect alignment between `SignedHeaders` and the actual request.
- **The money quote (taste):** *"Treat them as a strict protocol — not just a convenient upload shortcut."*
- **shelf lesson:** when generating a presigned URL server-side, ALWAYS return the signed-header set to the client. Don't let the SDK silently sign headers the client can't reproduce (`amz-sdk-request`, `amz-sdk-invocation-id`, `Host`, content checksums). For browser uploads, prefer **presigned POST policies** (which sign *form fields + conditions*, not arbitrary headers) over presigned PUT when header drift is a risk.

## 2. The IAM-session expiry trap (URL dies before its stated expiry)

**AWS re:Post, "S3 Presigned URL Expiring Earlier Than Expected" (<https://repost.aws/questions/QUIJVRUb5wTxCzbEHYxHxH8g/...>) + "Why do S3 pre signed URLs expire after 12 hours" (ElasticScale <https://elasticscale.com/blog/why-do-s3-pre-signed-urls-expire-after-12-hours-despite-setting-a-longer-duration/>):**

- *"IAM role credentials cause the presigned URL to expire when the role session expires, even if you specify a longer expiration time… the URL expires when the credential expires."*
- **Hard ceiling:** *"You can never have a presigned URL that is valid for longer than 7 days"* (SigV4 max). And if you sign with **temporary credentials** (assumed role / Lambda execution role), the *effective* expiry is `min(your-expiry, remaining-session-duration)` — often **1 hour**, the default STS session.
- **shelf lesson:** if you sign in a Lambda (which uses temporary role creds), your "24-hour" URL silently dies at the role-session boundary (~1h). To get long-lived URLs, sign with **long-term IAM user credentials** (with its own risks) or **re-issue short URLs on demand**. The default "it expires when I said" mental model is *wrong* with temp creds.

## 3. Clock skew & SignatureDoesNotMatch — the environmental gotchas

**AWS re:Post "Troubleshoot Signature Mismatch" + ElasticScale "Why S3 SignatureDoesNotMatch Errors Waste Your Time" (<https://elasticscale.com/blog/why-s3-signaturedoesnotmatch-errors-waste-your-time/>):**

- **Clock skew:** *"If the system clock where the URL is generated has skew… it can cause the URLs to expire prematurely or even be invalid at the time of creation. Even small time drifts can invalidate signatures."* (SigV4 embeds a timestamp; >15min skew = instant fail.) Fix: NTP-sync every signer.
- **Corporate proxies:** *"Some corporate proxies might modify headers or query strings, potentially causing signature mismatches."* A proxy that strips/reorders query params or rewrites headers breaks the signature.
- **Exact-match rule (verbatim):** *"All request parameters — including the HTTP method, headers, and query string — must match exactly between URL generation and usage."*
- **shelf lesson:** SignatureDoesNotMatch is almost never "wrong key" — it's **drift** (clock, header set, proxy, encoding). Debug by diffing the canonical request, not by rotating credentials.

## 4. The 6MB Lambda / 29s API Gateway wall (why you MUST go direct-to-S3)

**Yan Cui (theburningmonk), "Hit the 6MB Lambda payload limit? Here's what you can do" (<https://theburningmonk.com/2020/04/hit-the-6mb-lambda-payload-limit-heres-what-you-can-do/>) + AWS re:Post "Uploading >6MB file to S3 through API Gateway results in Request too long" (<https://repost.aws/questions/QUNSOj-PHyRq-fNqATDFox3w/...>):**

- **The constraints:** API Gateway = **29s request timeout** + **10MB payload**; Lambda = **6MB invocation payload** (both request AND response). Base64 encoding of binary in transit *inflates payload ~33%*, so you hit 6MB with a ~4.5MB original file.
- **The trap:** routing uploads *through* API Gateway → Lambda → S3 hits these limits hard, and large uploads also blow the 29s timeout.
- **The correct pattern (verbatim):** *"Since the client will upload the files to S3 directly [via presigned URL], you will not be bound by payload size limits imposed by API Gateway or Lambda."* Alternatives: API Gateway→S3 service proxy (no Lambda), or S3 multipart in Lambda (chunked).
- **shelf lesson:** **never proxy file bytes through your serverless function.** Function generates a presigned URL/POST; client uploads straight to S3/R2. This is non-negotiable for files >~4MB and good practice for all sizes.

## 5. Multipart upload traps (large files >5GB and resumability)

- S3 single-PUT max object = **5GB**; beyond that you **must** use multipart upload. Multipart also gives resumability and parallelism for big files.
- **The silent cost leak:** *abandoned multipart uploads* — if a client starts a multipart upload and never completes/aborts it, the uploaded parts **persist and bill as storage forever**, invisible in the normal object listing. Fix: an S3 **lifecycle rule to abort incomplete multipart uploads after N days** (AWS's own recommended hygiene rule, widely cited). This is a top "mystery storage bill" cause.
- **shelf lesson:** every bucket that accepts multipart uploads needs the "abort incomplete multipart uploads" lifecycle rule, or orphaned parts silently accrue cost.

## 6. Non-ASCII filename / key-mismatch class (UploadThing #153)

**GitHub: pingdotgg/uploadthing #153, "No file found for presigned URL when filename contains letter «й»" (opened 2023-06-10, closed; <https://github.com/pingdotgg/uploadthing/issues/153>):**

- The presigned response embedded the **raw Cyrillic key**: `"key": "c1c22697-..._Информационное_письмо_–_Май_2022.pdf"`. Upload showed "Uploading" then failed with *"No file found for presigned URL"* on retry.
- **Pattern (the root cause class):** when the object key contains non-ASCII or special characters (`й`, em-dash `–`, spaces, `+`, `#`), the **URL-encoding of the key at sign-time must byte-for-byte match the encoding at upload-time.** A mismatch (one side encodes `–`, the other doesn't) → key-not-found / signature-mismatch. (Related uploadthing prod issues: #785 Vercel `FUNCTION_INVOCATION_FAILED` on first attempt then succeeds — cold-start race; #1244 *"Transaction pool connection limit exceeded in production"* — the metadata DB, not storage, is the bottleneck.)
- **shelf lesson:** **never put user-supplied filenames directly into object keys.** Generate a random key (UUID), store the original filename as *metadata* or in your DB, and set `Content-Disposition: attachment; filename="..."` (RFC 5987 `filename*=UTF-8''...` for non-ASCII) on download. This kills the encoding-mismatch class AND the path-traversal class (field-02 §8) in one move.

## 7. Distilled presigned-upload checklist (for shelf's brain)

1. Return **signed headers** to the client; client sends exactly those (defeats `amz-sdk-request` drift).
2. Prefer **presigned POST policy** for browser uploads (sign fields/conditions, not arbitrary headers); constrain `content-length-range` + `Content-Type` so clients can't upload 5TB or arbitrary types.
3. **NTP-sync** every signer (clock skew = instant signature fail).
4. Know your **effective expiry** = `min(set-expiry, STS-session-remaining)`; 7-day hard cap; Lambda temp creds ≈ 1h.
5. **Never proxy bytes** through API Gateway/Lambda (6MB/29s); always direct-to-storage.
6. Use **multipart** >5GB; add the **abort-incomplete-multipart lifecycle rule** to every upload bucket.
7. **Random object keys**, original filename in metadata/DB, RFC 5987 `Content-Disposition` on download.

## Open / unconfirmed (→ GAPS-AND-DISPUTES)
- The `amz-sdk-request` behavior is specific to AWS SDK for Go v2 at the time of that postmortem; other SDKs (JS v3, Python boto3) inject different internal headers (`amz-sdk-invocation-id`) — I did not verify the *current* (June 2026) set of auto-signed headers per SDK. The *principle* (SDK signs headers the browser can't send) is robust; the exact header names are version/SDK-specific.
- theburningmonk's 6MB/29s figures are from a 2020 post; AWS limits can change. The 6MB Lambda payload and 29s API Gateway integration timeout were still current as of recent AWS docs, but a human should confirm against current quotas (AWS raised the API Gateway integration timeout to be configurable >29s in 2024 for REST APIs — verify).
