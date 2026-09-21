# Cairn Vault Linter privacy

Cairn performs scans, previews, exports, ignores, rollback checks, and repair planning locally through Obsidian. It does not upload note contents, finding text, file paths, reports, or repair journal text.

Billing is optional and is used only when the user signs in, refreshes a balance, opens checkout, or applies a repair after the 3 free daily batches are used. Account-linked requests contain the fixed app ID `cairn-vault-linter`, the random per-install installation ID, the access bearer token, and the relevant plan, amount, or stable event ID. Checkout uses the server-owned `one_time` or `standard` plan code and a stable idempotency key; the current authenticated path does not send a client-owned price ID. No shared secret, password, or hardware fingerprint is stored in the plugin.

The installation ID, billing email, and rotating billing session tokens are stored in Obsidian's local plugin settings. The installation ID identifies this installation for the linked account; it is not a hardware fingerprint. Users can clear the email by signing out or changing it in settings. Resetting Cairn analysis settings preserves the billing identity so purchased credits do not become inaccessible by accident.

If a paid spend cannot be confirmed, Cairn refuses the repair and keeps notes unchanged. The plugin never fails open into paid note writes. For billing questions, use the receipt or TutivSoft support channel associated with the checkout.
