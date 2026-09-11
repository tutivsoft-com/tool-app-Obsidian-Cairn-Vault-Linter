# Cairn Vault Linter

Cairn is an offline Obsidian maintenance plugin that audits a vault for broken links, missing headings and block IDs, invalid aliases, duplicate references, duplicate IDs, malformed targets, and empty dangling Markdown stubs.

The product promise is simple: every result is concrete and reviewable, and no note is changed unless the user explicitly approves a previewed repair. Cairn does not use AI, cloud services, paid credits, or vault uploads.

## Install and build

For development, install dependencies and run:

```bash
npm run build
```

Copy `publish/main.js`, `publish/manifest.json`, and `publish/styles.css` into `.obsidian/plugins/cairn-vault-linter/` in a test vault, then enable the plugin in Obsidian. The complete public source and documentation are mirrored in `publish/` for review and release.

## Use

Open **Cairn Vault Linter** from the ribbon or command palette. The dashboard provides:

- Full-vault, current-note, current-folder, and changed-notes scans.
- Live progress with files scanned, findings, and an accessible Cancel button.
- Finding cards grouped by source note, with severity, line, section, target, context, and explanation.
- Filters for finding type, severity, folder, and ignored/unresolved state.
- Local Markdown, CSV, and JSON exports with a preview before creating a report note.
- Exact duplicate-link repairs with before/after preview, a recovery journal, independent file writes, and rollback.

The command **Cairn: Scan changed notes (incremental)** uses file signatures from the last scan and retains previous results for notes that did not change. Run a full scan after large renames or structural changes for a fresh vault-wide index.

## Checks

Each check can be independently enabled in settings: broken wikilinks, broken Markdown links, broken embeds, missing headings, missing block IDs, missing aliases, duplicate links, empty stubs, duplicate block IDs, duplicate heading IDs, and malformed links.

Ignored folders and simple `*` file patterns are vault-relative. Hidden files and non-Markdown files are opt-in. Empty stubs are configurable by maximum meaningful characters and lines; Cairn only reports a stub when it has no detected incoming or outgoing links. Cairn never deletes notes automatically.

## Privacy and threat model

Scanning reads vault files through the Obsidian API and stores only local plugin settings, file signatures, ignored-finding reasons, and the last summary. Exported reports contain the findings the user chose to export. Repair rollback data is stored locally in the plugin folder because it must retain the exact pre-repair text. No network request is made by the plugin.

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the threat model and safe-repair boundaries.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Tests cover deterministic path/heading parsing, link resolution, duplicate detection, empty-stub rules, ignored findings, CSV escaping, and journal-safe repair behavior. The release artifact is built from the mirrored TypeScript under `publish/src/`.

## License

MIT. See [`LICENSE`](LICENSE).
