# Task Syncer for Obsidian

Task Syncer connects an Obsidian **desktop** vault to either Microsoft To Do or TickTick. Commands and the sidebar operate on one selected provider and remote list at a time.

Task Syncer requires either a Microsoft account or a TickTick account, plus a user-created OAuth application for the selected provider.

## Installation

Task Syncer requires Obsidian 1.11.4 or newer and is desktop-only.

- **Community Plugins:** once the plugin is published, open **Settings → Community plugins → Browse**, search for **Task Syncer**, install it, and enable it.
- **Release files:** download `main.js`, `manifest.json`, and `styles.css` from a release and place them in `<vault>/.obsidian/plugins/task-syncer/`. Restart Obsidian, then enable **Task Syncer** under Community plugins.

Do not install source files or development dependencies into a vault.

## Provider setup

You must create your own OAuth application. A client secret embedded in a desktop application cannot be made fully confidential; use credentials intended for this local installation.

### Microsoft To Do

1. Register an application in the Microsoft identity platform for personal Microsoft accounts.
2. Add delegated Microsoft Graph permission `Tasks.ReadWrite` and register an exact redirect URL (the default shown by the plugin is `http://localhost:5000`).
3. In **Settings → Task Syncer**, choose **Microsoft To Do** and enter the client ID, client secret, and the exact redirect URL.
4. Select **Connect**, complete Microsoft login and consent, then **Load lists** and select a list.

The plugin also requests `offline_access` so MSAL can maintain the account session in its token cache.

### TickTick

1. Create a TickTick OAuth application.
2. Register the exact redirect URL used in Task Syncer.
3. Configure the client ID and client secret, with scopes `tasks:read tasks:write`.
4. Choose **TickTick**, select **Connect**, then **Load lists** and select a list.

TickTick may not issue a refresh token for this flow. If its access token expires or TickTick returns 401, reconnect the account.

## Settings

- **Provider:** Microsoft To Do or TickTick. Switching providers clears the in-memory task cache; each provider retains its selected list.
- **OAuth credentials / Redirect URL:** credentials for the selected provider application.
- **Task lists / Selected task list:** fetch remote lists and choose the list used by commands and the sidebar.
- **Automatic refresh interval:** disabled or every 1, 5, 10, 15, 30, or 60 minutes (default: 10). This only fetches remote data.
- **Refresh on startup:** fetch after the Obsidian workspace is ready.
- **Show completed tasks / Show due dates:** control sidebar data and display.
- **IANA time zone:** used when writing TickTick due dates.
- **Confetti:** enable and choose completion animation size.

## Commands

Open the Command Palette to run:

- **Open task sidebar**
- **Connect current task provider** / **Disconnect current task provider**
- **Load task lists** / **Select task list**
- **Refresh tasks**
- **Push all tasks from note**
- **Create and push task**
- **Show open tasks list**
- **Organize tasks from all notes**
- **Delete completed tasks**

The sidebar can create, edit, complete, and reopen where supported. TickTick's documented Open API has no reopen operation, so completed TickTick tasks cannot be reopened.

## Sync semantics and deletion

Task Syncer is not a bidirectional file synchronizer:

- Refresh and automatic refresh fetch the selected remote list into an in-memory, ID-based cache and sidebar. They do not edit Markdown.
- **Push all tasks from note** reads top-level Markdown checkbox lines (`- [ ]` and `- [x]`) from the active note and creates or completes matching remote tasks. For this operation only, trimmed, whitespace-collapsed, case-insensitive titles prevent duplicate pushes. Remote tasks with duplicate titles are otherwise preserved by ID.
- **Create and push task** creates one task unless a normalized title already exists.
- **Organize tasks from all notes** scans local Markdown files and creates or updates a Task Syncer-managed section in local `Tasks List.md`; user-authored content outside the managed markers is preserved, and the command does not contact a provider.
- Changes made in the sidebar are sent to the selected remote provider but are not written back to source notes.

**Delete completed tasks** first fetches completed tasks and shows the provider, selected list, and count in a destructive confirmation dialog. Closing or cancelling the dialog performs no deletion. Confirming permanently deletes those completed remote tasks one at a time.

## Network and account disclosure

Task Syncer makes network requests only for the selected provider:

- **Microsoft login:** `login.microsoftonline.com` is opened for OAuth authorization. The client ID, redirect URL, requested scopes, random state, authorization code, and client secret/token-exchange data are used to authenticate the configured app.
- **Microsoft Graph:** `graph.microsoft.com/v1.0` receives the access token and list/task identifiers plus task titles, completion status, and due-date fields as needed to list, create, update, complete/reopen, or delete Microsoft To Do data.
- **TickTick OAuth:** `ticktick.com/oauth/authorize` and `ticktick.com/oauth/token` receive the client ID, redirect URL, scopes, random state, authorization code, client credentials, and token-exchange data needed to authenticate.
- **TickTick Open API:** `api.ticktick.com/open/v1` receives the access token and project/task identifiers plus titles, completion state, due dates, and configured time zone as needed to list, create, update, complete, or delete TickTick data.

OAuth authorization runs in an isolated Electron window and validates state and the configured redirect. Task Syncer has **no telemetry, analytics, advertising, or self-updater**. Updates are delivered through Obsidian Community Plugins or manually installed releases.

## Local data and secrets

- OAuth client secrets and provider token caches are stored through Obsidian SecretStorage.
- SecretStorage protection depends on an available and unlocked operating-system secret store. Obsidian displays a warning when secure storage is unavailable, which can occur on Linux systems without a configured keyring.
- Normal configuration—including client IDs, SecretStorage reference IDs, redirect URLs, selected provider/list, display choices, refresh choices, and time zone—is stored in the plugin's `data.json`.
- During upgrade, legacy plaintext credentials/token files are copied to SecretStorage and deleted only after exact read-back verification. When a current SecretStorage value differs, Task Syncer keeps it unchanged, copies the legacy value to a deterministic `-legacy-conflict` SecretStorage entry, verifies both values, and then removes the plaintext source.
- The plugin reads Markdown only for explicit note-push/organize commands and writes only `Tasks List.md` for the organize command.

## Troubleshooting

- **Missing OAuth credentials:** enter all three provider fields. The redirect URL must exactly match the provider registration, including scheme, host, port, and path.
- **Connect window closes or login fails:** retry Connect; check provider app account type, permissions/scopes, redirect URL, and system clock. Closing the window cancels login.
- **Session expired / 401:** disconnect if possible, then connect again. TickTick requires reconnection when its token expires.
- **403:** verify Microsoft `Tasks.ReadWrite` consent or TickTick `tasks:read tasks:write` scopes.
- **No lists or tasks:** connect, load lists, select a list, then refresh. Automatic refresh is skipped until a list is selected.
- **Legacy migration conflict:** the current credential/token remains active. The differing legacy value is retained only in a SecretStorage entry whose ID ends in `-legacy-conflict` (older generic Microsoft caches use `-legacy-conflict-generic`); no secret value is included in the ID or logs.
- **Mobile:** this plugin cannot run on mobile because OAuth uses Electron desktop APIs.

## Development

Requirements: Node.js 22 and npm.

```bash
npm ci
npm run lint
npm test
npm run build
npm run check       # lint + tests + coverage + production build + release validation
npm run test:watch
```

Automated tests mock Obsidian and provider/network boundaries; they do not use a real vault, keychain, account, or API. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the opt-in [TickTick smoke test](docs/testing/ticktick-smoke-test.md).

## License

Task Syncer is released under the [MIT License](LICENSE). Copyright © 2026 Wyson Cheng.
