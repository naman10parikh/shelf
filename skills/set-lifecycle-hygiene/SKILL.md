---
name: set-lifecycle-hygiene
description: On EVERY upload bucket, day one, set the abort-incomplete-multipart-uploads lifecycle rule — orphaned multiparts bill as storage forever and are invisible to ListObjects (the #1 mystery storage bill). Find existing orphans with rclone. Use whenever a bucket accepts uploads.
trigger: When creating an upload bucket, investigating a mystery storage bill higher than the visible object total, or auditing lifecycle/retention hygiene on S3 or R2.
---

# set-lifecycle-hygiene — abort-incomplete-multipart, day one, every bucket

> **The stance (brain O-17):** orphaned multipart uploads (started, never completed/aborted) **persist,
> bill as storage forever, and are invisible to a normal `ListObjects`** — the #1 mystery storage bill.
> The fix is cheap insurance set **on day one**, not after the bill arrives. Supported on both S3 and R2.
> Source of truth: `brain/OPINIONS.md` **O-17**, `brain/BATTLE-TESTED-SCENARIOS.md` **S11**,
> `brain/KNOWN-PITFALLS.md` **P-24**. Run `shelf explain O-17` for the full stance.

## Trigger

A new bucket will accept uploads (especially multipart / large files), OR the storage bill is higher than
the sum of visible objects and `ListObjects` doesn't account for the difference (S11 — the invisible
orphaned-multipart cost).

## Steps

1. **Set the abort rule on day one.** `shelf lifecycle set --bucket B --abort-after-days 7` issues a
   `PutBucketLifecycleConfiguration` with `AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 }`.
   Do this when the bucket is created — not after a surprise bill (O-17/P-24).
2. **Hunt existing orphans.** `shelf lifecycle orphans --bucket B` shells `rclone backend
   list-multipart-uploads <remote>:` to surface started-but-never-finished uploads that `ListObjects`
   hides; abort them (`AbortMultipartUpload`) to stop the bleed (S11/P-24).
3. **On versioned buckets, add the noncurrent-version rules too** — expire noncurrent versions + clean
   delete-markers, or old versions silently accumulate cost alongside the orphans (O-17).
4. **Re-check on a schedule.** The dogfood lifecycle-audit cron (shelf's own dispatch routine) scans the
   demo bucket for orphaned multiparts / a missing abort-incomplete rule — wire the same audit on your
   real buckets so the rule is verified present, not assumed.

## Output

A lifecycle configuration applied to the bucket (the abort-incomplete-multipart rule, + noncurrent
expiry on versioned buckets) and an orphan report listing any incomplete multipart uploads found. Verify:
`shelf lifecycle set --bucket X --abort-after-days 7 --json` emits the applied rule as parseable JSON;
`shelf lifecycle orphans --bucket X` lists orphans (or reports an honest no-rclone/no-remote fallback —
never a fake clean result).

## Anti-patterns (refuse these)

- Skipping the abort rule "until we see a problem" — the problem is an invisible bill you can't see until
  it's large (O-17/P-24/S11).
- Diagnosing a high bill by re-counting visible objects — orphaned multiparts don't appear in
  `ListObjects`; you must `list-multipart-uploads` (S11).
- Assuming R2 doesn't need it because egress is free — R2 still bills orphaned multipart *storage* (P-24).
