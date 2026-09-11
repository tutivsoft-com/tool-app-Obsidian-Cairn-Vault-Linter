# Cairn Vault Linter — Product Requirements

Status: planning

## Product promise

Cairn gives a clear, reviewable health report for an Obsidian vault and helps users repair safe issues without silently changing or deleting notes.

## Product principles

- Deterministic results are more valuable than speculative suggestions.
- Scanning is read-only until the user explicitly approves a fix.
- Every finding includes enough context to verify it.
- The linter must handle large vaults, cancellation, and partial failures gracefully.
- Core scanning must work offline and must not require AI or paid credits.

## MVP audit scope

The scanner must inspect Markdown notes and identify:

1. Broken wikilinks to missing notes.
2. Broken Markdown links to missing vault files.
3. Broken embeds for notes, images, PDFs, audio, and other local attachments.
4. Links that target a heading that does not exist.
5. Links that target a block ID that does not exist.
6. Links written to an alias that no note currently exposes.
7. Duplicate links to the same target within one note, with line and section context.
8. Empty or nearly empty Markdown stubs that have no meaningful incoming or outgoing purpose.
9. Duplicate block IDs and duplicate heading IDs where they can produce ambiguous references.
10. Unsupported or malformed link targets that Obsidian cannot resolve.

The user must be able to enable or disable each check and configure the definition of “empty” or “nearly empty”.

## MVP requirements

### Scan and results

11. Provide a single command to scan the full vault.
12. Provide folder-scoped and current-note scans.
13. Show progress, files scanned, findings found, and an accessible Cancel action.
14. Continue past unreadable or malformed files and report them separately.
15. Group results by severity, finding type, source note, and target.
16. Show source path, line number when available, surrounding text, target, and a plain-language explanation.
17. Provide filters for finding type, severity, folder, and resolved/unresolved state.
18. Allow a finding to be marked ignored with a reason and an optional rule scope.
19. Persist the last scan summary without storing note contents unnecessarily.
20. Re-run only changed notes when the user requests an incremental scan.

### Safe repair workflow

21. Provide a preview before every write operation.
22. Offer exact, deterministic repairs such as correcting a confirmed path, updating a confirmed heading target, or removing an exact duplicate link.
23. Never invent a target based only on fuzzy similarity without showing the proposed replacement and requiring approval.
24. Never delete an empty note automatically in the MVP.
25. Create backups or an undo journal before applying an approved repair batch.
26. Apply fixes independently per file so one failure does not corrupt the complete batch.
27. Provide rollback for the most recent repair batch.
28. Report changed, skipped, failed, and rolled-back files separately.

### Reporting and configuration

29. Export the report as Markdown and CSV; JSON export is useful for automation if it remains simple.
30. Allow ignored folders and file patterns such as templates, attachments, and application data.
31. Allow the user to choose whether hidden files and non-Markdown files are scanned.
32. Provide a compact dashboard showing total findings, high-severity findings, and trend since the previous scan.
33. Keep rule configuration local to the vault or plugin settings and make it easy to reset.

## AI decision

AI is not needed. Broken links, duplicate links, aliases, block IDs, and empty stubs can be determined from vault data. Introducing AI would make results less predictable and would send private note content away from the vault. Future optional explanations may be considered only if they can be generated locally without weakening the deterministic audit.

## Useful post-MVP features

- Safe redirect-map generation for renamed notes.
- Orphan-note and low-connectivity reports.
- Duplicate-note detection using local text fingerprints, with human review.
- Scheduled background scans with quiet notifications only when findings change.
- Obsidian Bases or Dataview-aware checks where their syntax is stable.
- Suggested fixes ranked by confidence, while retaining mandatory review.

## Out of scope for the MVP

- Automatic deletion of notes, links, or attachments.
- Cloud scanning or uploading vault content.
- AI-generated repairs without deterministic verification.
- Reformatting an entire vault as a side effect of linting.

## Acceptance criteria

- A user can scan a large vault from one command and understand the result without opening a terminal.
- Every finding can be traced to a source note and concrete target.
- A scan never modifies vault content.
- Approved repairs show a before-and-after preview, create recovery data, and support rollback.
- Malformed or unreadable files are reported rather than stopping the scan.
- The complete MVP works offline with no AI account and no paid credits.

