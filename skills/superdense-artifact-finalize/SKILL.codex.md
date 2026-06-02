---
name: superdense-artifact-finalize
version: 0.1.0
description: Freeze a finalized Superdense work thread into one immutable Layer 3B artifact, extracting its type and durable payload.
---

# Superdense Artifact Finalize

Use this skill when the user invokes `/superdense-artifact-finalize <thread-id>`.

This is Layer 3B: freeze one curated work thread into a single immutable artifact. It does not
bind external systems (no connectors, published identity, or rewards — that is Layer 4).

1. Run `superdense thread show <thread-id>` to see the thread and its sessions.
2. Run `superdense curation context <root-session-id>` to understand what was produced. The
   deliverable may live only in the session (e.g. a tweet drafted in chat), not in a file.
3. If indexed context is insufficient, escalate narrowly for only the relevant sessions:
   `superdense session show <session-id>`, `superdense session enrichments <session-id>`,
   `superdense compactor run salience <session-id>`, then
   `superdense compactor run trace <session-id>`. Use `superdense session path <session-id>` for
   raw-source access only as a last resort, and read the minimum raw source needed. Prefer
   metadata first; use `salience` for the gist and `trace` when ordering matters. For session-only
   artifacts, inspect enough detail to preserve the exact payload.
4. If the thread is still `open`, finalize it first:
   `superdense curation apply --input '{"actions":[{"type":"thread.finalize","threadId":"<thread-id>"}]}'`.
5. Extract the artifact with `superdense artifact finalize --input '<json>'`, choosing an
   open-vocabulary `type`, a `title`, and a `payload`:
   - file-backed: `{"threadId":"<id>","type":"feature","title":"…","payload":{"files":["src/x.ts"]}}`
   - session-only: `{"threadId":"<id>","type":"tweet","title":"…","payload":{"text":"…"}}`
6. Confirm with `superdense artifact show <thread-id>` and report.

Rules: one artifact per thread; the thread locks on finalize and its lineage is frozen; the head
session is the latest contributor; `payload` is open JSON. Lineage and per-session evidence already
live in the database — do not duplicate them. Never claim deterministic artifact discovery.
