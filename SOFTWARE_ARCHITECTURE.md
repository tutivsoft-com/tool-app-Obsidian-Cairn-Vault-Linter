# Cairn Vault Linter Software Architecture

Release: 3.4.14

## Runtime shape

Cairn is a TypeScript Obsidian community plugin. The plugin entry point registers commands, settings, the dashboard, scan progress, repair review, report export, and rollback. Obsidian APIs provide vault access and local plugin-data storage.

## Source modules

| Module | Responsibility |
|---|---|
| src/main.ts | Plugin lifecycle, commands, settings UI, dashboard, scan orchestration, report export, and user-approved repair flow. |
| src/core.ts | Deterministic vault checks and finding generation. |
| src/types.ts | Finding, scan, repair, and settings data contracts. |
| src/repair.ts | Exact repair-plan validation and per-file write coordination. |
| src/journal.ts | Recovery journal creation and rollback support. |
| src/plugin-support.ts | Shared plugin setup, diagnostics, and support helpers. |
| src/billing.ts and src/constance-account.ts | Free-use tracking, account/session integration, entitlement checks, checkout, and repair-credit events. |

The source checkout also contains publish/src as the reviewable source mirror used by the release build. The root src and publish/src trees are expected to stay aligned.

## Data flow and privacy boundary

1. The scanner reads Markdown and configured local files through Obsidian vault APIs.
2. It creates structured findings and stores scan preferences, ignored reasons, signatures, and the last summary in local plugin data.
3. A repair candidate is shown as a before/after preview. The journal is prepared before authorization and writes; each file is handled independently so one failure does not corrupt the whole batch.
4. Billing requests contain billing and installation metadata needed to authorize a user-approved repair. Vault note contents are not sent to Constance.
5. Report exports are created locally from the findings the user selected.

## Build and release

The build runs TypeScript checking and bundles publish/src/main.ts into publish/main.js. The publish directory also carries the matching manifest, stylesheet, complete mirrored source, and user-facing documentation. The public repository mirrors that release surface and attaches main.js, manifest.json, and styles.css to the exact manifest-version GitHub release.