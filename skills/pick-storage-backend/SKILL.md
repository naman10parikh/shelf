---
name: pick-storage-backend
description: Pick the storage backend PER WORKLOAD, not per tribe — R2 is the default for hot/public download-many (zero egress), but it's the WRONG default for write-heavy ingestion, cold/archival, and event-driven; keep those on S3. Name the condition that flips the default. Use when choosing or migrating a storage backend.
trigger: When choosing a storage provider, being asked "should we use R2 / S3?", planning a migration, or when someone proposes moving "everything" to one backend.
---

# pick-storage-backend — traffic-aware default, name the flip-condition

> **The stance (brain O-05 / O-06 / O-27, Dispute A):** **default to Cloudflare R2** (zero egress, the
> fleet default) — but the default is **traffic-aware, not dogma.** The 2025 gospel "S3 is the safe
> default" is dead; the 2026 reflex "R2 is the cheap default" is *also* wrong. The expert move is
> per-workload, and the value is naming the **condition that flips** the default, not defending a brand.
> Source of truth: `brain/OPINIONS.md` **O-05 / O-06 / O-27**, `brain/GAPS-AND-DISPUTES.md` **Dispute A**,
> `brain/BATTLE-TESTED-SCENARIOS.md` **S3**, `brain/KNOWN-PITFALLS.md` **P-25 / P-26**.
> Run `shelf explain O-05` for the full stance.

## Trigger

A workload needs a storage backend, OR someone proposes "move everything to R2 for zero egress" (S3 —
after which event triggers stop firing, a data-lake bill goes *up* ~69%, and a compliance customer can't
be served), OR a backend choice is being made from tribe ("S3 is safe" / "R2 is cheap") not workload.

## Steps

1. **Classify the workload first.** `shelf backend pick --workload <hot-public|write-heavy|cold|
   event-driven|compliance> --json`. The recommendation follows the access pattern + dependency graph,
   not a default brand (O-05/S3).
2. **Default to R2 for hot/public download-many** — zero egress wins decisively (~$15/mo vs ~$891/mo at
   10 TB egress) and it's the fleet default (O-05).
3. **Keep these on S3 (the four drag-back reasons, S3/O-05):**
   - **write-heavy ingestion** — R2 Class A writes are `$4.50/M` → $450/mo at 100M writes (P-25);
   - **cold/archival** — R2 storage `$0.015/GB` ≈ 2.5× B2/Wasabi, no Glacier/IA tiering → ~69% pricier
     than S3+lifecycle (P-26);
   - **event-driven** — R2 has no S3 event notifications;
   - **compliance / multi-region** — thinner certifications, no consistent cross-region replication.
4. **Architect behind a thin `Storage` interface over the S3 API** so the choice is *config-reversible*
   (O-06). Lock-in lives in the **control plane** (events, lifecycle tiering, `s3:` IAM condition keys,
   replication), not the data plane (GET/PUT/multipart/presign are portable). In the headline migration,
   9/14 workloads saved 40–70% and **5 were reverted within 90 days** — "move back" is a first-class
   outcome, not a failure (O-06/S3).
5. **State the flip-condition out loud.** Every recommendation names the exact condition under which it
   reverses (egress shape, write volume × $4.50/M, cold-with-tiering, event dependency) — that condition
   *is* the expertise (O-27).

## Output

A per-workload backend recommendation **with the explicit flip-condition** (R2 for hot/public; S3 for
write-heavy/cold/event-driven/compliance), plus the thin-`Storage`-interface portability note. Verify:
`shelf backend pick --workload write-heavy --json` recommends S3 and states the Class-A-write flip
(P-25); `shelf backend pick --workload hot-public --json` recommends R2.

## Anti-patterns (refuse these)

- "Move everything to R2" (S3) — per-workload, or you break events / overpay on cold / lose compliance.
- "S3 is always the safe default" (the dead 2025 gospel) — for hot/public download-many it's the
  four-figure egress trap (O-05/S1).
- A neutral pros/cons table with no recommendation — a storage employee that hedges everything is useless
  (O-27); lead with the default + the condition that flips it.
