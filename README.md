# Cairn Vault Linter

Version: `3.4.22`

Cairn is an offline Obsidian maintenance plugin that audits a vault for broken links, missing headings and block IDs, invalid aliases, duplicate references, duplicate IDs, malformed targets, and empty dangling Markdown stubs.

Scans and repairs run locally. Repairs apply directly by default, with a **Review repairs before applying** setting for users who want a before/after approval window. Billing only authorizes a repair batch; Cairn never uploads note contents.

## Install and build

For development, install dependencies and run:

```bash
npm run build
```

Copy `publish/main.js`, `publish/manifest.json`, and `publish/styles.css` into `.obsidian/plugins/cairn-vault-linter/` in a test vault, then enable the plugin in Obsidian. The complete public source and documentation are mirrored in `publish/` for review and release.

## Use

Open **Cairn Vault Linter** from the ribbon or command palette. Right-click a note in its editor or File Explorer to scan that note, or right-click a folder/multi-selection to scan its Markdown notes. Current-note and current-folder scans are also available from the command palette. The dashboard provides:

- Full-vault, current-note, current-folder, and changed-notes scans.
- Live progress with files scanned, findings, and an accessible Cancel button.
- Finding cards grouped by source note, with severity, line, section, target, context, and explanation.
- Filters for finding type, severity, folder, and ignored/unresolved state.
- Local Markdown, CSV, and JSON exports in the configured default format; optional preview before creating a report note.
- Exact duplicate-link repairs with a recovery journal, independent file writes, optional before/after review, and rollback.

The default **Apply safe repairs** action applies exact supported repairs in one run. Enable **Review repairs before applying** in settings to see before/after changes first. Set the default report format in settings so exporting does not ask for a format each time.

The command **Cairn Vault Linter: Scan changed notes (incremental)** uses file signatures from the last scan and retains previous results for notes that did not change. Run a full scan after large renames or structural changes for a fresh vault-wide index.

## Billing

Scans, previews, exports, ignores, rollback, and other read-only/local inspection are free. A repair credit authorizes one user-approved repair batch; empty, stale, or no-op batches are rejected before a claim. Each billing account receives 3 free repair batches per local calendar day. After that, one-time packs are $1 for 100 credits or $10 for 1,000 credits. A write failure after a successful free claim can still consume that free use because Constance has no refund operation.

Cairn uses TutivSoft's account-linked billing endpoints for installation linking, authoritative balance sync, server-authoritative free usage, authenticated checkout, and event-id-based spend. The plugin stores a random per-install installation ID, billing session tokens, and billing email locally; it never stores a shared secret or password. Checkout sends the current catalog plan code (`one_time` for $1/100 or `standard` for $10/1,000) with a stable `Idempotency-Key`; Paddle price IDs remain only in the guarded legacy fallback. If billing is unavailable or a balance cannot be confirmed, Cairn refuses the paid repair and leaves notes unchanged.

## Checks

Each check can be independently enabled in settings: broken wikilinks, broken Markdown links, broken embeds, missing headings, missing block IDs, missing aliases, duplicate links, empty stubs, duplicate block IDs, duplicate heading IDs, and malformed links.

Ignored folders and simple `*` file patterns are vault-relative. Hidden files and non-Markdown files are opt-in. Empty stubs are configurable by maximum meaningful characters and lines; Cairn only reports a stub when it has no detected incoming or outgoing links. Cairn never deletes notes automatically.

## Privacy and threat model

Scanning reads vault files through the Obsidian API and stores only local plugin settings, file signatures, ignored-finding reasons, and the last summary. Exported reports contain the findings the user chose to export. Repair rollback data is stored locally in the plugin folder because it must retain the exact pre-repair text. Billing is the only network activity, and it sends billing metadata only as described above.

See [`docs/CONSTANCE_BILLING.md`](docs/CONSTANCE_BILLING.md), [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), and [`docs/PRIVACY.md`](docs/PRIVACY.md) for the current billing contract mapping, threat model, billing data flow, and safe-repair boundaries.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Tests cover deterministic path/heading parsing, link resolution, duplicate detection, empty-stub rules, ignored findings, CSV escaping, journal-safe repair behavior, daily free allowances, device IDs, spend payloads, and the no-op billing guard. The release artifact is built from the mirrored TypeScript under `publish/src/`.

## Product documentation

- [Features](FEATURES.md)
- [Product requirements](REQUIREMENTS.md)
- [Software architecture](SOFTWARE_ARCHITECTURE.md)
- [Marketing brief](MARKETING.md)
- [User guide](docs/USER_GUIDE.md)
- [Privacy](docs/PRIVACY.md) and [threat model](docs/THREAT_MODEL.md)

## License

MIT. See [`LICENSE`](LICENSE).

<!-- one-click-workflow:start -->
## Workflow defaults (v3.4.19)

Cairn applies safe repairs directly and uses the report format selected in Settings. Repair and export previews are optional and off by default.
<!-- one-click-workflow:end -->
