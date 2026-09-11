# Cairn user guide

1. Open **Cairn Vault Linter** from the ribbon or command palette.
2. Choose **Scan full vault** for a fresh health report. Use **Current note** or **Current folder** for focused review.
3. Use **Cancel** if the scan is taking longer than expected. Read errors remain visible under their own group.
4. Filter findings by type, severity, folder, or ignored state. Each card includes the source path, line, section, target, context, and explanation.
5. Select **Preview exact repair** only when a duplicate link is safe to remove. Review the before/after text, then explicitly apply.
6. Use **Cairn: Roll back last repair batch** if you need to restore the most recent batch. Files with newer edits are protected and skipped.
7. Export Markdown, CSV, or JSON after reviewing the result. Cairn shows an export preview before creating a new report note.

## Billing and repair credits

Scanning, previewing, exporting, ignoring, rolling back, and inspecting the vault are always free. Applying one approved batch of repairs that changes at least one note uses one repair credit. Cairn checks the notes again immediately before authorization, so stale, empty, and no-op batches are not charged.

Each local calendar day includes 3 free repair batches. After those are used, Cairn spends one purchased credit through TutivSoft's unsigned browser relay. A $1 pack contains 100 credits and a $10 pack contains 1,000 credits. If the balance cannot be verified, Cairn does not write notes.

In Settings → Billing, enter an optional billing email, review today's free usage and the purchased balance, refresh the balance, or open checkout for the live Cairn prices. The device ID is randomly generated and stored locally for this install; it is not a password or shared secret. No note contents are sent for billing.

Settings let you disable individual rules, manage billing, ignore folders/patterns, include hidden or non-Markdown files, tune the empty-stub definition, and choose the report folder. Reset returns analysis settings to their conservative defaults while preserving the billing identity and balance settings.
