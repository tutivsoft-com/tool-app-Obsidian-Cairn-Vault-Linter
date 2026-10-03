# Cairn Vault Linter

Version: 3.4.37 — release source validated.

## Current purchase behavior

Purchase settings load the current public product catalog from Constance. Each available offer supplies its exact Paddle price ID, native-unit grant, unit name, and formatted amount. The client displays backend-provided amounts, enables only offers marked available, and submits the selected price ID through authenticated checkout with quantity one. The current approved one-time packs grant 50, 150, 450, or 1,200 repair batches for USD $2, $4, $8, or $14; client code does not contain price amounts. Existing account balances and granted credits remain associated with the account.


## Preview and lifetime allowance

Guests see a bounded preview held only in memory. Keep the originating window open through registration, email verification and sign-in, then retry that exact result without regeneration. Guests cannot save, apply, export or queue useful output. Closing the preview or restarting loses unrevealed guest content.

Constance authorizes metered operations using this app’s native billing unit. The plugin checks current account entitlements and live purchase availability through Constance; each operation follows its documented reserve/commit or quote/confirmation flow.

A bounded repair/report operation covers up to five files and twenty proposed edits. Larger batches use the server-confirmed native cost. Full report or repair reveal consumes once; applying/exporting that same immutable result does not charge again. Source changes block stale repairs; rollback stays free.

Repair writes follow durable reserve → write → verify → commit. Full-result reveal commits before showing complete content. Unknown writes retain their journal for status/output reconciliation and retry the same operation identity. Billing sends account/install identity, native dimensions and source/result digests, never vault content or repair text.

## Current settings

Settings default to **Simple** and remember the selected mode. Simple contains everyday controls and account/billing. **Advanced** contains specialist parameters, diagnostics, and less frequent preferences. Inline help explains choices.

Cairn has no AI feature and does not request AI provider keys. Constance handles account access and Paddle billing only.

## Current local account and billing behavior

Use **Connect** with your email and password. A new account is registered; an existing account is authenticated. New users must follow the emailed verification link and Connect again. Incorrect passwords offer password recovery; passwords are never saved. Paid purchases and free allowances belong to the authenticated account, not a locally entered email or an editable cached balance. Reinstalling does not replenish the same account's allowance.

Constance is the billing authority. Credit units remain app-specific: characters, OCR pages, searches, conversions, repair/protection batches, or captures. Checkout return URLs and cached balances never grant credits. Payment fulfillment comes from the server’s verified Paddle webhook, and balances refresh from authenticated entitlements. Unknown usage or checkout results reuse the persisted operation ID; they must not create a new debit or alternative checkout.




Cairn is an offline Obsidian maintenance plugin that audits a vault for broken links, missing headings and block IDs, invalid aliases, duplicate references, duplicate IDs, malformed targets, and empty dangling Markdown stubs.

Scans and repairs run locally. Repairs apply directly by default, with a **Review repairs before applying** setting for users who want a before/after approval window. Billing only authorizes a repair batch; Cairn never uploads note contents.

## Use

Open **Cairn Vault Linter** from the ribbon or command palette. Right-click a note in its editor or File Explorer to scan that note, or right-click a folder/multi-selection to scan its Markdown notes. Current-note and current-folder scans are also available from the command palette. The dashboard provides:

- Full-vault, current-note, current-folder, and changed-notes scans.
- Live progress with files scanned, findings, and an accessible Cancel button.
- Finding cards grouped by source note, with severity, line, section, target, context, and explanation.
- Filters for finding type, severity, folder, and ignored/unresolved state.
- Local Markdown, CSV, and JSON exports in the configured default format; optional preview before creating a report note.
- Exact duplicate-link repairs with a recovery journal, independent file writes, optional before/after review, and rollback.

The default **Apply safe repairs** action applies exact supported repairs in one run. Enable **Review repairs before applying** in settings to see before/after changes first. Set the default report format in settings so exporting does not ask for a format each time.

The command **Cairn Vault Linter: Scan changed notes (incremental)** uses file signatures from the last scan and retains previous results for notes that did not change. Run a full scan after large renames or structural changes for a fresh vault-wide index.

## Billing


## Checks

Each check can be independently enabled in settings: broken wikilinks, broken Markdown links, broken embeds, missing headings, missing block IDs, missing aliases, duplicate links, empty stubs, duplicate block IDs, duplicate heading IDs, and malformed links.

Ignored folders and simple `*` file patterns are vault-relative. Hidden files and non-Markdown files are opt-in. Empty stubs are configurable by maximum meaningful characters and lines; Cairn only reports a stub when it has no detected incoming or outgoing links. Cairn never deletes notes automatically.

## Privacy and threat model

Scanning reads vault files through the Obsidian API and stores only local plugin settings, file signatures, ignored-finding reasons, and the last summary. Exported reports contain the findings the user chose to export. Repair rollback data is stored locally in the plugin folder because it must retain the exact pre-repair text. Billing is the only network activity, and it sends billing metadata only as described above.


## License

MIT. See [`LICENSE`](LICENSE).

## Workflow defaults

Cairn applies safe repairs directly and uses the report format selected in Settings. Repair and export previews are optional and off by default.

## Account, billing, and credit feedback

Account and billing controls appear at the top of settings. Select Connect with your email and password; verify the emailed link if requested, then Connect again. The settings page shows the current balance and provides balance refresh, sign-out, and purchase controls. Metered actions show the available balance and report the amount used with the remaining balance when the action completes.


Billing account recovery: use **Forgot password?** in the plugin settings to open the Constance reset page. Signing out clears the local tokens and requests server session revocation.


## Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the matching published release and place them in `.obsidian/plugins/cairn-vault-linter/`, then enable the plugin in Obsidian.
