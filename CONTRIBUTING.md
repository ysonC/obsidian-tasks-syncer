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

Use Node.js 22, matching CI and release automation. `npm run check` runs ESLint, isolated Vitest and release-validator tests, TypeScript checking, the production bundle, and release metadata/asset validation.

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

## Releases

Releases are created only from the current `main` commit after all checks pass. Keep the exact `x.y.z` version synchronized in `manifest.json` and `package.json`, and map that version to `manifest.minAppVersion` in `versions.json`. Do not prefix the version or Git tag with `v`.

Before merging a release version, run:

```bash
npm ci
npm run check
npm audit --omit=dev
```

The build must produce the three Community Plugin install assets: `main.js`, `manifest.json`, and `styles.css`. The release workflow validates the metadata and assets, creates the exact version tag (for example, `2.1.0`), and uploads only those three files with generated release notes. A rerun safely skips an existing matching tag and release, or completes a release when the matching tag exists without one; it refuses to reuse a tag that points at another commit.

## Pull requests

Describe the problem, approach, tests run, user-facing effects, and any network/data-handling changes. Keep formatting-only or unrelated refactors out of functional changes. Screenshots are useful for settings/sidebar UI changes, but remove personal information first.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
