---
title: "Virus / malware scanning of uploads (June 2026)"
type: source
created: 2026-06-16
tags: [shelf, ecosystem, security, virus-scanning, clamav]
researcher: ecosystem (CP123 Wave-R)
---

# Virus / Malware Scanning of Uploads (June 2026)

## Honest state of the art: this is still mostly DIY ClamAV + Lambda, and the "canonical" repo is STALE

There is **no clean managed "scan my S3 bucket for viruses" primitive** that dominates. The space is a
long tail of DIY serverless ClamAV repos. Key signal:

- The historically-canonical **`bucket-antivirus-function`** (Upside Travel → now `bluesentry/`) is
  **ARCHIVED**, 533★, **last push 2024-04-12.** The reference implementation everyone copied is no
  longer maintained. Source: `gh api repos/bluesentry/bucket-antivirus-function` (2026-06-16).
- The active repos are dozens of small/zero-star personal projects from 2026 (e.g.
  `tts-git/java-cdk-serverless-clamscan`, `rishikkesh-s/s3-antivirus-pipeline`,
  `EmanFahoom/serverless-malware-scanner`). No new community standard has consolidated. Source:
  `gh search repos clamav lambda s3 --sort=updated` (2026-06-16).
- **`clara`** (abhinavbom/clara) — 34★, push 2026-01-14 — ClamAV **+ YARA** scanning of S3, built on
  the old bucket-antivirus-function + Airbnb BinaryAlert. The most interesting OSS option (adds YARA
  signatures) but small. Source: <https://github.com/abhinavbom/clara/>.

**Taste/finding:** for shelf, do NOT present virus scanning as "solved by an off-the-shelf tool." It's
a pattern you implement, and the agent must own the lifecycle (engine + definitions updates +
quarantine). This is a genuine GAP in the ecosystem, not just our harness.

## The dominant pattern: Incoming → Scan → Clean/Quarantine

Source: <https://www.sls.guru/blog/secure-file-upload-to-amazon-s3-with-aws-lambda-virus-scanning-serverless-architecture-guide>,
<https://medium.com/globant/creating-a-serverless-malware-scan-solution-with-clamav-on-aws-52891da6fbfe>,
<https://github.com/ministryofjustice/opg-s3-antivirus>.

1. Upload lands in an **incoming/quarantine** bucket (or a prefix), object served to NOBODY yet.
2. S3 event (ObjectCreated) → Lambda (ClamAV packaged as a **container image**, not a Lambda layer —
   ClamAV + fresh defs exceeds the 250 MB layer limit; container images are the 2026 norm).
3. Lambda scans; **tags the object** `scan-status=clean|infected`.
4. Clean → move to the public/served bucket (or flip a tag the serving layer checks). Infected →
   delete or move to a locked quarantine bucket; alert.
5. **Definitions updater:** a *separate* scheduled Lambda (EventBridge cron) runs `freshclam`, writes
   the virus DB to an S3 bucket; the scanner Lambda loads defs from there at cold start. Without this,
   your scanner silently rots (defs go stale → misses new malware). This is the most-skipped piece.

## Engine options (June 2026)

- **ClamAV** — the open-source default. Free, signature-based. Weaknesses: misses novel/zero-day
  malware (signature-only), defs must be kept fresh, large memory footprint, slow on big files. Still
  the pragmatic default for "is this a known-bad file."
- **ClamAV + YARA** (clara pattern) — adds heuristic/rule-based detection on top of signatures. Better
  coverage, more setup.
- **AWS GuardDuty Malware Protection for S3 — THE managed default on AWS now (CONFIRMED, supersedes
  DIY ClamAV for most AWS shops).** GA at re:Inforce 2024; **price cut 85% on 2025-02-01 to $0.09/GB
  scanned** (US East; was $0.60) + a per-object-evaluated charge. Fully managed (no Lambda/ClamAV to
  run), **ML + heuristic detection beyond ClamAV's signatures**, **signatures updated every 15 minutes**
  (vs ClamAV's daily). Real migration results: **Lambda running cost −99.8%, upload→scan time −~75%,
  architecture simplified.** Cost note: GuardDuty cheaper for small/medium volume; **bucketAV** (the
  commercial successor to bucket-antivirus-function) becomes more economical at very large data volumes.
  Sources: <https://cloudonaut.io/review-amazon-guardduty-malware-protection-for-s3/>,
  <https://aws.amazon.com/about-aws/whats-new/2025/02/amazon-guardduty-malware-protection-s3-price-reduction>,
  <https://www.steamhaus.co.uk/insights/enhancing-s3-security-my-journey-from-clamav-to-guardduty-malware-scanning>,
  <https://bucketav.com/blog/amazon-guardduty-malware-protection-for-s3-versus-bucketav/>.
  **shelf recommendation: on AWS, default to GuardDuty Malware Protection for S3, not DIY ClamAV.** DIY
  ClamAV remains the answer off-AWS (R2/B2/Tigris) where no equivalent managed primitive exists.
- **Other commercial APIs** — VirusTotal (rate-limited, file goes to a third party — *privacy/compliance
  concern, don't send user PII files*), Cloudmersive (managed scan API), **bucketAV** (managed AWS
  marketplace AV, the maintained commercial heir to the archived OSS repo), and cloud-native
  **Microsoft Defender for Storage** on Azure Blob (the Azure managed primitive).

## Latency & UX gotcha (the thing that breaks products)

Scanning is **asynchronous** and can take seconds–minutes (cold start + DB load + scan). The upload UX
**must not** show the file as "ready" until `scan-status=clean`. Common bug: presigned-direct-to-bucket
upload returns 200, app immediately serves the file, scan finishes later and finds malware that's
already been downloaded by other users. **Rule:** object is `pending` and unservable until the scan
flips it clean. This is the storage-layer expression of the fleet's "server-confirmed, not
client-trusted" value.

## What an AGENT needs to operate this
- No MCP server for virus scanning exists (searched; none). The agent wires the Lambda/container
  pipeline via IaC (CDK/Terraform) and drives ClamAV via `clamdscan`/`clamscan` CLI inside the
  container, or calls a managed scan API.
- For local/dev scanning, `clamscan <file>` is the CLI; `freshclam` updates defs.

## GAPS / unconfirmed
- Whether any R2-native malware scanning exists (Cloudflare) — did not find one; likely still DIY via
  Workers + an external scan API (e.g. call Cloudmersive/bucketAV from a Worker on R2 ObjectCreated).
- Exact bucketAV vs GuardDuty break-even data volume (directional only: "bucketAV more economical at
  larger volumes" per bucketAV's own comparison — vendor source, treat with skepticism).
