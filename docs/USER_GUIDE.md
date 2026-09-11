# Cairn user guide

1. Open **Cairn Vault Linter** from the ribbon or command palette.
2. Choose **Scan full vault** for a fresh health report. Use **Current note** or **Current folder** for focused review.
3. Use **Cancel** if the scan is taking longer than expected. Read errors remain visible under their own group.
4. Filter findings by type, severity, folder, or ignored state. Each card includes the source path, line, section, target, context, and explanation.
5. Select **Preview exact repair** only when a duplicate link is safe to remove. Review the before/after text, then explicitly apply.
6. Use **Cairn: Roll back last repair batch** if you need to restore the most recent batch. Files with newer edits are protected and skipped.
7. Export Markdown, CSV, or JSON after reviewing the result. Cairn shows an export preview before creating a new report note.

Settings let you disable individual rules, ignore folders/patterns, include hidden or non-Markdown files, tune the empty-stub definition, and choose the report folder. Reset returns all settings to their conservative defaults.
