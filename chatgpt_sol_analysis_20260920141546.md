# Cairn implementation analysis

## Reviewed code map

Reviewed `src/main.ts`, linter/scanner and repair workflows, `src/billing.ts`, types, account/support modules, and publish inputs.

## Changes and safeguards

- Repair usage is account-scoped, with authenticated entitlement and spend operations and stable pending charge IDs.
- Free repair allowance no longer resets through reinstall; billing errors fail closed before repairs.
- Scan/report defaults work without optional configuration. Repairs remain previewed/explicit because they mutate vault files.
- Scan and report actions lead menus; repair confirmation, export, patterns, and advanced checks are progressively disclosed.

## Threat model and migration

The server verifies installation ownership and account authorization. Passwords and vault contents are not persisted in the plugin or diagnostics. Invalid sessions are cleared and pending charges are retained until authoritative resolution.

## Documentation and logging

Help documents scan scopes, findings, safe repair review, rollback expectations, account/billing, privacy, and troubleshooting. Logging covers scan/repair lifecycle, cancellation, billing, and failures without note contents.

## Validation

Run `npm run check`, `npm run build`, and `git diff --check`; compare public mirror with `publish`. No vault data or deployment is touched.

## Remaining limitation

Repair behavior should still be tested against representative vault fixtures by the maintainer.
