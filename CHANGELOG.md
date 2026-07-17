# Changelog

All notable user-facing changes to Task Syncer are documented here.

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
