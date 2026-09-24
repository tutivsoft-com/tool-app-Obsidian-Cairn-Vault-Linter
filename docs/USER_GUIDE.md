# Cairn user guide

1. Open **Cairn Vault Linter** from the ribbon or command palette.
2. Choose **Scan full vault** for a fresh health report. Use **Current note** or **Current folder** for focused review.
3. Use **Cancel** if the scan is taking longer than expected. Read errors remain visible under their own group.
4. Filter findings by type, severity, folder, or ignored state. Each card includes the source path, line, section, target, context, and explanation.
5. Select **Apply exact repair** or **Apply safe repairs** to run a supported repair directly. Enable **Review repairs before applying** in Settings to inspect before/after text first.
6. Use **Cairn Vault Linter: Roll back last repair batch** if you need to restore the most recent batch. Files with newer edits are protected and skipped.
7. Export in the default report format selected in Settings. Enable review there if you want to inspect report contents before Cairn creates the note.

## Billing and repair credits

Scanning, optional previews, exporting, ignoring, rolling back, and inspecting the vault are always free. A non-empty repair batch uses one repair credit. Cairn checks the notes and prepares a verified rollback journal before authorization, so stale, empty, and unwritable batches do not claim the free allowance.

Each local calendar day includes 3 free repair batches, claimed from TutivSoft's account-linked billing API. After those are used, Cairn spends one purchased credit per batch. A $1 pack contains 100 credits and a $10 pack contains 1,000 credits. If the allowance or balance cannot be verified, Cairn does not write notes. A write failure after a successful free claim can still consume that free use because the billing API has no refund operation.

In Settings → Billing, enter your billing email and sign in or create an account, review today's free usage and the purchased balance, refresh the balance, or open checkout for the live Cairn packs. The installation ID is randomly generated and stored locally for this install; it is not a password or hardware fingerprint. Cairn renews the billing session when possible, persists checkout/spend idempotency state, and polls checkout settlement after opening. No note contents are sent for billing.

Settings let you disable individual rules, manage billing, ignore folders/patterns, include hidden or non-Markdown files, tune the empty-stub definition, and choose the report folder. Reset returns analysis settings to their conservative defaults while preserving the billing identity and balance settings.
