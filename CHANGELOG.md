# Changelog

All notable user-facing changes to Task Syncer are documented here.

## [2.1.4] - 2026-07-24

### Fixed

- Improved task create/edit modal keyboard controls so Enter submits text and date fields while preserving IME composition behavior.
- Handled empty provider task-update responses without treating successful updates as JSON parse failures.
- Regenerated the npm lockfile for npm 10 `npm ci` compatibility.

### Changed

- Release publishing now runs only for explicit version-bump release PRs instead of every normal main-branch merge.
- Added the repository AI assistance disclosure to the README.

## [2.1.2] - 2026-07-18

### Fixed

- Prevented stale refreshes from replacing tasks after switching providers or lists.
- Added complete Microsoft Graph pagination with same-origin next-link validation.
- Refused ambiguous title-based mutations when duplicate remote task titles exist.
- Preserved timed due dates during title-only edits and rejected blank task titles.
- Updated only a managed section in `Tasks List.md`, preserving user-authored content.
- Made calendar-day labels respect the configured time zone.
- Validated persisted settings and rejected invalid automatic-refresh intervals.

### Changed

- Added Obsidian's official plugin lint rules, comprehensive coverage checks, and a private npm package declaration.
- Modernized the test toolchain and removed known dependency advisories.
- Improved sidebar accessibility, theme compatibility, and settings UI wording.
- Clarified required provider accounts and SecretStorage operating-system limitations.

### Security

- Cancelled OAuth sessions on plugin unload, denied popup windows, isolated browser sessions, and enforced exact callback/query matching at the provider boundary.
- Quarantined conflicting legacy plaintext credentials in verified SecretStorage entries before removing plaintext sources.
- Prevented delayed or overlapping operations from mutating tasks after provider or list changes.
- Made release recovery fail closed on tag, source-SHA, or asset-digest mismatches and non-destructive when repairing missing assets.

## [2.1.1] - 2026-07-17

### Changed

- Changed the manifest ID from `task-syncer-plugin` to `task-syncer` to comply with Obsidian's manifest rule that plugin IDs cannot end with `plugin`.
- Tightened release validation to reject IDs containing digits or ending with `plugin`.

## [2.1.0] - 2026-07-17

### Added

- TickTick OAuth and Open API support alongside Microsoft To Do.
- Provider-neutral settings, commands, sidebar operations, and per-provider list selection.
- Configurable automatic refresh and optional refresh on startup.
- Confirmation dialog showing provider, list, and count before bulk deletion of completed tasks.
- SecretStorage-backed OAuth client secrets and provider token caches, with verified migration from legacy plaintext settings/files.
- Community documentation, security policy, contribution guide, and isolated provider tests.

### Changed

- Raised the minimum Obsidian version to 1.11.4 and declared the plugin desktop-only.
- Migrated settings to the provider-aware version 3 schema while retaining supported legacy settings.
- Updated package metadata and licensing to MIT.
- Preserved remote tasks by provider IDs; normalized title matching is limited to duplicate prevention during note pushes.

### Security

- OAuth windows use isolated Electron sessions, exact redirect matching, and random state validation.
- Tokens are not logged, and legacy plaintext is deleted only after successful SecretStorage read-back verification.

[2.1.0]: https://github.com/ysonC/obsidian-tasks-syncer/releases/tag/2.1.0
[2.1.1]: https://github.com/ysonC/obsidian-tasks-syncer/releases/tag/2.1.1
[2.1.2]: https://github.com/ysonC/obsidian-tasks-syncer/releases/tag/2.1.2
[2.1.3]: https://github.com/ysonC/obsidian-tasks-syncer/releases/tag/2.1.3
[2.1.4]: https://github.com/ysonC/obsidian-tasks-syncer/releases/tag/2.1.4
