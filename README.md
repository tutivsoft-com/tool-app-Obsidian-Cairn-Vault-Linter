# Cairn Vault Linter

Version: `3.4.35`

Cairn checks an Obsidian vault for broken links, missing headings and block IDs, invalid aliases, duplicate references, malformed targets, and empty Markdown stubs. Scans and repairs run locally; vault contents are not sent to the billing service.

## Install

Install **Cairn Vault Linter** from Obsidian's Community plugins browser. For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the [GitHub release](https://github.com/tutivsoft-com/tool-app-Obsidian-Cairn-Vault-Linter/releases), place them in `<vault>/.obsidian/plugins/cairn-vault-linter/`, and enable Cairn.

## Use

Open Cairn from the ribbon or command palette. Run a full-vault, current-note, current-folder, or changed-notes scan. Review findings, filter by type or severity, and apply supported repairs. You can enable before-and-after repair review in Settings. Cairn keeps a local recovery journal and protects files changed after a scan.

## Billing

Read-only scans and reports are free. A repair batch uses your linked account's free allowance or purchased balance. The current one-time offers provide 50, 150, 450, or 1,200 repair batches for USD $2, $4, $8, or $14. Offer descriptions, amounts, and availability come from the configured Paddle catalog and are fetched when billing settings open. Checkout uses the selected provider price; existing balances remain attached to your verified account.

Billing requests contain account and operation metadata, not note contents. Repair writes use a durable reserve, write, verification, and commit flow. Cairn retains the same operation identity while reconciling an uncertain result.

## Privacy

Cairn reads notes through Obsidian's local vault APIs. Findings, settings, and rollback data remain in your local plugin storage unless you choose to export a report or share diagnostics.

## License

MIT. See [LICENSE](LICENSE).