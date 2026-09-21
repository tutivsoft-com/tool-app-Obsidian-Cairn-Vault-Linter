# Changelog

## 3.4.11 - 2026-09-22

- Migrated checkout to authenticated Constance plan-code transactions with
  persisted idempotency keys, rotating session refresh, and settlement polling.
- Retained the Contract v9 `/buy` path only as a guarded compatibility fallback
  and synchronized the billing/privacy documentation.

## 3.4.10 - 2026-09-21

- Incremented release metadata without rebuilding the plugin.

## 3.4.6 - 2026-09-20

- Prepared the next patch version across source, publish, and public metadata.
- No runtime behavior changed in this documentation and version bump.

## 3.4.5 - 2026-09-20

- Synchronized the Cairn source and publish version surfaces and prepared the
  next source-inclusive TutivSoft release.

## 3.4.4 - 2026-09-12

- Incremented and synchronized the canonical, package, manifest, and publish version surfaces after the billing rollout. No runtime behavior changed in this metadata release.
- Synchronized the publish billing mirror with durable spend event IDs so
  retries reconcile the original attempt instead of creating a new charge.
- Added regression coverage for the stable event-ID payload.

## 3.4.2 — 2026-09-11

- Finalized the live Cairn billing release with the real $1/100 and $10/1,000 Paddle price IDs configured in source and publish, then rebuilt the release artifact.

## 3.4.1 — 2026-09-11

- Finalized Cairn live billing catalog IDs for the $1/100 and $10/1,000 repair-credit packs; rebuilt the publish artifact with no configured placeholders.

## 3.4.0

- Added unsigned browser-relay billing with app ID `cairn-vault-linter`, random per-install device IDs, billing email settings, balance sync, unique spend event IDs, and guarded one-time credit packs.
- Added 3 free repair batches per local calendar day; paid credits authorize one approved batch only at the safe write boundary.
- Prevented charges for empty, stale, or no-op repair batches and blocked paid writes when spend verification fails.
- Added focused billing tests and privacy/user documentation.

## 3.3.0

- First complete Cairn Vault Linter MVP.
- Added offline full, note, folder, and incremental scans.
- Added grouped findings, filters, ignore scopes, settings, progress, cancellation, and local exports.
- Added previewed exact duplicate-link repairs with journal rollback and safe skip behavior.
- Added deterministic unit tests, privacy/threat-model documentation, and release attestations.
