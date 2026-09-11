# Cairn threat model and recovery boundary

## Data flow

Cairn reads files through Obsidian's local vault API, builds in-memory indexes, and renders findings inside Obsidian. Billing makes only metadata requests to TutivSoft's unsigned browser-relay endpoints: app ID, random install device ID, credit amount, event ID, and optional checkout email. Note contents, findings, paths, reports, and repair text are never sent for billing. Settings are stored in Obsidian's local plugin data.

The last scan stores a summary and file signatures only. Ignored findings store a fingerprint, scope, reason, and timestamp. A repair journal stores the exact before/after text for the most recent approved repair batch in the plugin folder; that is the recovery mechanism and is intentionally local.

## Threats considered

- **Accidental note edits:** scanning is read-only; all repair and export writes require an explicit preview confirmation.
- **Unauthorized paid write:** repair authorization happens only after a fresh file check and immediately before the first note write. A missing, stale, or no-op batch is not billable; a failed billing check blocks paid repairs.
- **Duplicate spend:** every paid spend includes a fresh random event ID so the relay can apply its idempotency rules.
- **Identity leakage:** the device ID is random and scoped to this install. Cairn does not fingerprint hardware or store a shared secret.
- **Partial repair failure:** each file is read back and written independently. A file changed since preview is skipped rather than overwritten.
- **Unsafe rollback:** rollback restores a file only when its current content exactly matches Cairn's recorded after-text. Newer user edits are skipped and reported.
- **Path traversal or remote links:** external schemes and unsupported targets are not treated as local files. Vault-relative matching is conservative.
- **Unreadable or malformed files:** read errors are collected and displayed separately so one file cannot stop the scan.
- **Ambiguous suggestions:** the MVP only offers deterministic duplicate-link removal. It does not guess a replacement note, heading, or alias.

## User responsibilities

Obsidian plugins run with access to the active vault. Install Cairn only from a source you trust, keep normal vault backups, review repair previews, and treat exported reports and the repair journal as potentially sensitive because they can include paths and note excerpts.

## Known limitations

Cairn's Markdown parser intentionally favors safe, explainable matches over full CommonMark coverage. Complex nested Markdown destinations, dynamically generated links, plugin-specific syntaxes, and links assembled by scripts may be reported as unresolved or malformed. A full scan should be used after bulk renames because incremental scans prioritize avoiding reads of unchanged notes. Checkout uses the exact Cairn catalog prices and retains a runtime guard so a wrong or missing price ID cannot be opened.
