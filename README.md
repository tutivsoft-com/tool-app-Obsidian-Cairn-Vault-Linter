# Cairn Vault Linter

Scan vault health locally, show findings and apply supported deterministic repairs with recovery safeguards.

Current version: **3.4.54**.

## First use

Enable the plugin and use its settings page. Simple is the default settings mode; Advanced exposes optional configuration. Run Scan full vault, Scan current note or Scan current folder, then inspect the findings in the Cairn view.

Scans and report exports are local and work without a connected billing account. Safe repair actions require account authorization. Optional review is off by default; stale-source checks, durable repair journals, write verification and rollback remain active. An incremental changed-note scan is also available.

## Account and processing

Processing is local. This plugin has no AI provider integration. Constance handles account and billing operations.

Repair units are max(1, ceil(files / 5), ceil(edits / 20)) per completed repair operation. Native repair writes use account reservation, verification and finalization; unknown results retain the original immutable operation.

Connect the existing Constance account in settings; registration can require email verification before signing in again. Billing account passwords are sent for authentication and are not persisted. Access/refresh session data and a stable installation identity are saved locally. Account free usage and purchased balance are determined by Constance; cached values and checkout return URLs do not create entitlement. Catalog displays current formatted names, prices, availability and exact price IDs. Unknown usage and checkout results retain their original identities for recovery.

## Diagnostics

Help is available in settings and through Open documentation. Open plugin settings and Copy full debug log are command-palette fallbacks. Debug logging defaults off for a new installation; failures and full Error objects/stacks still appear in the local developer console. Timed information is enabled by the debug preference. The copyable diagnostic buffer keeps at most 1,000 summarized events and excludes raw error text, stacks, note text, paths and credentials. Full console exceptions can contain whatever the failed operation placed in its error. Logs are not uploaded automatically.

## Documentation

- [User guide](docs/USER_GUIDE.md)

License terms are in LICENSE.
