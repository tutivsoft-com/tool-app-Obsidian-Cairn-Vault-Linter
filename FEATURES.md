# Cairn Vault Linter Features

Release: 3.4.14

Cairn checks an Obsidian vault for concrete, reviewable maintenance issues. Scanning is read-only; note changes happen only after the user reviews and approves a supported repair.

## Vault checks

- Find broken wikilinks, Markdown links, and embeds that point to missing files.
- Find links to missing headings, block IDs, and aliases.
- Report duplicate links, duplicate block IDs, duplicate heading IDs, malformed targets, and empty or nearly empty Markdown stubs.
- Scan the full vault, the current note, the current folder, or notes changed since the prior scan.
- Show scan progress and allow an active scan to be cancelled. Unreadable files are reported without stopping the rest of the scan.

## Review and repair

- Group findings with source path, line, section, target, surrounding context, severity, and explanation where available.
- Filter by finding type, severity, folder, and ignored state. Ignore findings with a reason or scope.
- Preview exact duplicate-link repairs before applying them.
- Create a recovery journal before a repair batch and roll back the most recent batch when its source files have not changed since the repair.
- Never delete notes automatically. Scanning, exporting, and previewing are read-only; approved repairs and rollback are the only note-writing actions.

## Reports and settings

- Export reviewed findings as Markdown, CSV, or JSON, with a preview before a report note is created.
- Configure individual checks, ignored folders and patterns, hidden-file and non-Markdown scanning, empty-stub thresholds, and report location.
- Keep scan results, settings, and recovery data in the local Obsidian profile.

## Billing and privacy

Scanning, reviewing, exporting, ignoring, and rollback are free. A credit is used only for an approved repair batch that changes at least one note; the current plan includes a daily free allowance. Billing may contact TutivSoft Constance for account, entitlement, checkout, and spend metadata. Cairn does not send note contents for scanning or billing.

## Current limits

- Cairn reports issues; it does not automatically delete notes or rewrite an entire vault.
- Automated repairs are limited to exact, reviewable duplicate-link cleanup. Other findings remain available for manual correction.
- Run a full scan after large renames or structural changes to refresh the vault-wide index.
- AI-generated analysis is not used.