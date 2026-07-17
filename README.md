# Task Syncer for Obsidian

Task Syncer connects an Obsidian desktop vault to **Microsoft To Do** or **TickTick**. The sidebar and commands use one selected provider and list at a time.

## Features

- Load provider lists and select a target list.
- View open and optionally completed tasks in a sidebar.
- Create, edit, complete, and delete tasks.
- Push Markdown checkboxes from the active note.
- Automatically refresh remote tasks on a configurable interval (10 minutes by default), with an optional startup refresh.
- Keep a canonical in-memory `TaskItem[]` cache keyed by provider/list; title matching is used only temporarily to deduplicate note pushes.

## Commands

Commands are provider-neutral: **Connect Current Task Provider**, **Disconnect Current Task Provider**, **Load Task Lists**, **Select Task List**, **Refresh Tasks**, **Push All Tasks from Note**, **Create and Push Task**, **Show Open Tasks List**, and **Delete Completed Tasks**. Switching provider clears the task cache.

## Provider setup

### Microsoft To Do

Register a Microsoft application with delegated `Tasks.ReadWrite` permission and configure its client ID, client secret, and exact redirect URL in Task Syncer settings. Existing pre-v2 flat Microsoft settings migrate automatically, including credentials and selected list.

### TickTick

1. Create a TickTick OAuth application.
2. Register the exact redirect URL you will enter in plugin settings.
3. Configure the client ID and client secret.
4. Request scopes `tasks:read tasks:write`.
5. Select TickTick, click **Connect**, then **Load lists** and choose a list.

TickTick uses the official authorization-code endpoints (`https://ticktick.com/oauth/authorize` and `/oauth/token`) and Open API base `https://api.ticktick.com/open/v1`. OAuth runs in an isolated Electron `BrowserWindow`, uses a cryptographically random state, and requires an exact redirect match. Token exchanges are form encoded with HTTP Basic client authentication. Tokens are held in a dedicated provider cache and are never logged.

## Important limitations

- Desktop only: OAuth depends on Electron `BrowserWindow`.
- A desktop plugin cannot fully protect a configured OAuth client secret. Use credentials intended for a local desktop installation and understand this limitation.
- TickTick does not guarantee a refresh token for this flow. The plugin does not assume one; when a token expires or the API returns 401, reconnect from the command/settings UI.
- TickTick's documented Open API has no reopen operation. Completed TickTick checkboxes are disabled. Microsoft tasks can be reopened.
- No tags, repeats, reminders, subtasks, habits, focus mode, or automatic Markdown-to-provider pushes.
- Automatic refresh only fetches remote provider tasks into the plugin cache/sidebar; it never pushes Markdown tasks automatically.

## Automatic refresh

In **Task Syncer Settings**, choose an automatic refresh interval: disabled, 1, 5, 10, 15, 30, or 60 minutes. The default is **10 minutes**. Enable **Refresh on startup** to fetch once after the Obsidian workspace is ready. Refreshes are skipped until a task list is selected, and overlapping refreshes are prevented.

## Development

```bash
npm install
npm test          # isolated Vitest unit tests; no real API or vault data
npm run test:watch
npm run build     # TypeScript check + production bundle
npm run check     # tests + build
```

Tests mock network/provider boundaries and never use real credentials or user data. See [TickTick smoke test](docs/testing/ticktick-smoke-test.md) for an opt-in manual check.

## Markdown behavior

`Push All Tasks from Note` reads `- [ ]` and `- [x]` lines. For that operation only, titles are trimmed, whitespace-collapsed, and case-normalized to avoid duplicate remote tasks. Remote storage and the cache remain ID-based, so tasks with duplicate titles returned by a provider are preserved.

## License

[MIT](LICENSE)
