
## Preview and lifetime allowance

Guests see a bounded preview held only in memory. Keep the originating window open through registration, email verification and sign-in, then retry that exact result without regeneration. Guests cannot save, apply, export or queue useful output. Closing the preview or restarting loses unrevealed guest content.

Repair and full-result operations use Cairn's native Constance quote/reserve/commit flow before protected writes or reveal. Purchased credits remain app-specific. Pack names, prices, descriptions, and quantities come from the configured Constance catalog and live Paddle price records; checkout is enabled only for an exact configured active price.

A bounded repair/report operation covers up to five files and twenty proposed edits. Larger batches use the server-confirmed native cost. Full report or repair reveal consumes once; applying/exporting that same immutable result does not charge again. Source changes block stale repairs; rollback stays free.

Useful local writes follow durable reserve → write → verify → commit. Full reveal commits before showing complete content. Unknown writes retain their journal for status/output reconciliation; they are never blindly refunded or replayed. Billing sends account/install identity, native dimensions and source/result digests, never vault content, image bytes or encryption passwords.

## Current local account and billing behavior

Use **Connect** with your email and password. A new account is registered; an existing account is authenticated. New users must follow the emailed verification link and Connect again. Incorrect passwords offer password recovery; passwords are never saved. Paid purchases and free allowances belong to the authenticated account, not a locally entered email or an editable cached balance. Reinstalling does not replenish the same account's allowance.

Constance is the billing authority. Credit units remain app-specific: characters, OCR pages, searches, conversions, repair/protection batches, or captures. Checkout return URLs and cached balances never grant credits. Payment fulfillment comes from the server’s verified Paddle webhook, and balances refresh from authenticated entitlements. Unknown usage or checkout results reuse the persisted operation ID; they must not create a new debit or alternative checkout.



# Cairn user guide

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
