# Cairn Vault Linter privacy

Cairn performs scans, previews, exports, ignores, rollback checks, and repair planning locally through Obsidian. It does not upload note contents, finding text, file paths, reports, or repair journal text.

Billing is optional and is used only when the user refreshes a balance, opens checkout, or applies a repair after the 3 free daily batches are used. The unsigned browser-relay payload contains the fixed app ID `cairn-vault-linter`, a random per-install device ID, a one-credit amount for a paid repair, and a fresh event ID. Checkout additionally includes the billing email and the provisioned price ID. No shared secret, password, API key, or hardware fingerprint is stored in the plugin.

The device ID and billing email are stored in Obsidian's local plugin settings. The device ID identifies this installation's credit balance; it is not an authentication secret. Users can clear the email from settings. Resetting Cairn analysis settings preserves the billing identity so purchased credits do not become inaccessible by accident.

If a paid spend cannot be confirmed, Cairn refuses the repair and keeps notes unchanged. The plugin never fails open into paid note writes. For billing questions, use the receipt or TutivSoft support channel associated with the checkout.
