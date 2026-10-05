# Cairn user guide

## Account lifetime allowance

Five repair batches are available lifetime per account. Each operation uses max(1, ceil(files / 5), ceil(edits / 20)) units. Free units are consumed first and purchased units cover the remainder. Local writes retain durable reserve, write, verify and commit recovery.

## Current local account and billing behavior

Use **Connect** with your email and password. A new account is registered; an existing account is authenticated. New users must follow the emailed verification link and Connect again. Incorrect passwords offer password recovery; passwords are never saved. Paid purchases and free allowances belong to the authenticated account, not a locally entered email or an editable cached balance. Reinstalling does not replenish the same account's allowance.

Constance is the billing authority. Credit units remain app-specific: characters, OCR pages, searches, conversions, repair/protection batches, or captures. Checkout return URLs and cached balances never grant credits. Payment fulfillment comes from the server’s verified Paddle webhook, and balances refresh from authenticated entitlements. Unknown usage or checkout results reuse the persisted operation ID; they must not create a new debit or alternative checkout.



1. Open **Cairn Vault Linter** from the ribbon or command palette.
2. Choose **Scan full vault** for a fresh health report. Use **Current note** or **Current folder** for focused review.
3. Use **Cancel** if the scan is taking longer than expected. Read errors remain visible under their own group.
4. Filter findings by type, severity, folder, or ignored state. Each card includes the source path, line, section, target, context, and explanation.
5. Select **Apply exact repair** or **Apply safe repairs** to run a supported repair directly. Enable **Review repairs before applying** in Settings to inspect before/after text first.
6. Use **Cairn Vault Linter: Roll back last repair batch** if you need to restore the most recent batch. Files with newer edits are protected and skipped.
7. Export in the default report format selected in Settings. Enable review there if you want to inspect report contents before Cairn creates the note.

## Billing and repair credits


In Settings → Billing, enter your billing email and sign in or create an account, review remaining lifetime allowance and the purchased balance, refresh the balance, or open checkout for the live Cairn packs. The installation ID is randomly generated and stored locally for this install; it is not a password or hardware fingerprint. Cairn renews the billing session when possible, persists checkout/spend idempotency state, and polls checkout settlement after opening. No note contents are sent for billing.

Settings let you disable individual rules, manage billing, ignore folders/patterns, include hidden or non-Markdown files, tune the empty-stub definition, and choose the report folder. Reset returns analysis settings to their conservative defaults while preserving the billing identity and balance settings.

## Current workflow defaults

Cairn applies safe repairs directly and uses the report format selected in Settings. Repair and export previews are optional and off by default.
