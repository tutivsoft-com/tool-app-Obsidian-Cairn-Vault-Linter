# Cairn Vault Linter Marketing Brief

Release: 3.4.14

## Positioning

Cairn is a careful maintenance assistant for Obsidian vaults. It finds broken references and other concrete housekeeping issues, then lets the vault owner decide what to fix.

## Short description

Find broken links, missing anchors, duplicates, and dangling notes in an Obsidian vault. Apply safe repairs directly or enable before/after review in Settings.

## Product description

Cairn scans an Obsidian vault for broken wikilinks, Markdown links, embeds, missing headings and block IDs, invalid aliases, duplicate references, malformed targets, and empty stubs. Users can scan all notes or focus on the current note, folder, or changed notes, then review findings with useful file and line context.

Cairn keeps inspection read-only. Its supported duplicate-link repairs create recovery data before writes; before/after review is optional. Users can cancel scans, export reports in their configured format, ignore known findings, and roll back the latest repair batch when its files have not changed.

Note contents stay in the vault. Optional repair billing uses account and usage metadata; it does not upload the notes being scanned.

## Best suited for

- Obsidian users maintaining long-lived or frequently reorganized vaults.
- Researchers and teams who need to find broken references after renames.
- Users who want a report and a review step before a tool changes note files.

## Verified product claims

- Scans locally through Obsidian APIs.
- Offers full-vault, current-note, current-folder, and changed-note scan scopes.
- Shows grouped findings and supports Markdown, CSV, and JSON reports.
- Does not automatically delete notes.
- Requires explicit approval for supported repairs and provides rollback data.

## Claim boundaries

Do not describe Cairn as an automatic vault-cleaner, AI repair tool, or cloud scanner. Do not promise a fixed scan time or a specific performance level; results depend on vault size and device. Explain that billing network requests may be used for account and repair-credit operations, while note contents remain local.
