# TickTick manual smoke test

This is an opt-in desktop test. Automated tests never call TickTick or read a real vault.

## Prerequisites

- A disposable Obsidian vault and TickTick test list.
- A TickTick OAuth app with `tasks:read tasks:write`.
- An exact registered redirect URL.
- No production credentials committed to the repository.

## Steps

1. Run `npm ci`, `npm test`, and `npm run build`.
2. Copy/link the plugin into the disposable vault and enable it.
3. In Task Syncer settings select **TickTick**, enter client ID, client secret, exact redirect URL, and an IANA timezone such as `America/Toronto`.
4. Click **Connect**. Confirm the isolated login window closes only on the configured redirect.
5. Click **Load lists**, select the test list, and open the Task Syncer sidebar.
6. Create a task with a due date. Verify its title/date in TickTick.
7. Edit its title/date and verify the update.
8. Complete it. Enable completed tasks and verify it is shown completed and its checkbox is disabled (TickTick has no documented reopen endpoint).
9. Push a note containing the same title with case/whitespace differences; verify no duplicate is created. Add a distinct checked task; verify it is created and completed.
10. Delete completed tasks and verify deletion.
11. Disconnect. Confirm refresh gives an actionable connect message and the provider token-cache file is removed.
12. Switch to Microsoft and back; verify each provider retains its own selected list while the visible task cache is cleared.

## Security checks

- Search console output for access/refresh tokens: none should appear.
- A changed OAuth state or non-matching callback must fail before token exchange.
- A 401 requires reconnect; no refresh token is assumed.
