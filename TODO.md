# Todo

- [ ] Add Todoist service
- [ ] Evaluate secure public-client OAuth/PKCE options where providers support them
- [ ] Add opt-in foreground polling (background sync is intentionally out of scope)

# Complete

- [x] Microsoft To Do provider adapter and OAuth cache
- [x] TickTick official OAuth authorization-code integration (`tasks:read tasks:write`)
- [x] TickTick list/task create, read, update, complete, delete, and rename APIs
- [x] Versioned provider settings and migration from flat Microsoft settings
- [x] Canonical ID-based task cache and temporary normalized-title note deduplication
- [x] Provider-aware sidebar and generic connect/disconnect/load/select commands
- [x] Vitest service/auth/settings tests and manual TickTick smoke-test guide
- [x] Due-date display/editing, completion filters, confetti, and task organization
