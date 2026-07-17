# Security Policy

## Supported versions

Security fixes are provided for the latest released version of Task Syncer. Upgrade to the newest release before reporting an issue when possible.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or include credentials, OAuth codes, access tokens, client secrets, or vault data in a report.

Use GitHub's private **Report a vulnerability** form for this repository: <https://github.com/ysonC/obsidian-tasks-syncer/security/advisories/new>. Include the affected version, impact, reproduction steps, and a minimal proof of concept with all secrets and personal data removed.

If private vulnerability reporting is unavailable, open a public issue containing only a request for a private contact channel—do not disclose vulnerability details there.

## Scope and expectations

Task Syncer is a desktop plugin that connects directly to Microsoft and TickTick. OAuth client secrets and token caches use Obsidian SecretStorage, but a secret configured in a desktop application cannot be guaranteed confidential against a compromised local machine or vault environment. Normal configuration remains in the plugin's `data.json`.

Maintainers will acknowledge a private report when they can, investigate it, and coordinate disclosure and a fix based on severity. No response-time or remediation-time guarantee is made.
