# Contributing

Thanks for helping improve Task Syncer.

## Before opening a change

- Search existing issues and pull requests.
- Keep changes focused and explain user-visible behavior and provider differences.
- Never commit credentials, OAuth codes/tokens, vault contents, or generated token-cache/data files.
- For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

```bash
git clone https://github.com/ysonC/obsidian-tasks-syncer.git
cd obsidian-tasks-syncer
npm ci
npm run check
```

Use a supported Node.js release. `npm run check` runs ESLint, isolated Vitest tests, TypeScript checking, and the production bundle.

## Making changes

1. Create a focused branch.
2. Add or update a test before changing behavior; verify that it fails for the intended reason.
3. Implement the smallest change and run the targeted test.
4. Run the complete verification suite:

   ```bash
   npm run check
   git diff --check
   npm audit --omit=dev
   ```

5. Update README or CHANGELOG when behavior, setup, privacy, or compatibility changes.

Tests must mock Obsidian, SecretStorage, filesystem locations, and provider/network boundaries. Do not use a real vault, OS keychain, Microsoft account, TickTick account, or live API in automated tests. Manual provider testing must use disposable data and must never commit resulting files.

## Pull requests

Describe the problem, approach, tests run, user-facing effects, and any network/data-handling changes. Keep formatting-only or unrelated refactors out of functional changes. Screenshots are useful for settings/sidebar UI changes, but remove personal information first.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
