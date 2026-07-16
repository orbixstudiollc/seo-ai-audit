# Later phases (parked)

- **Phase 4 — report features**: markdown/HTML export download (lib/export
  survives for this), stateless share links, JSON-LD schema output
  (lib/audit/jsonld), localStorage-only history, OG images for results.
  Spec to be written by the coordinator once WS1–WS3 merge.
- **Phase 5 — auth + persistence (DEFERRED by product decision D-001)**:
  restore point `backup/pre-rewrite` (better-auth + drizzle + Supabase,
  BYOK keys). Saved reports, drift baselines, higher limits for signed-in
  users. Do not start without explicit user go-ahead.
