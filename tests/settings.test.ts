import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrateSettings } from "../src/settings-model";

describe("settings migration", () => {
	it("preserves existing flat Microsoft credentials, list, and UI preferences", () => {
		const migrated = migrateSettings({
			selectedService: "microsoft",
			clientId: "old-id", clientSecret: "old-secret", redirectUrl: "http://localhost:5000",
			selectedTaskListId: "list-1", selectedTaskListTitle: "Inbox",
			taskLists: [{ id: "list-1", title: "Inbox" }], showComplete: false,
		});
		expect(migrated.version).toBe(3);
		expect(migrated.provider).toBe("microsoft");
		expect(migrated.providers.microsoft).toMatchObject({ clientId: "old-id", clientSecretId: "task-syncer-plugin-microsoft-client-secret", redirectUrl: "http://localhost:5000", selectedListId: "list-1", selectedListTitle: "Inbox" });
		expect(migrated.providers.microsoft).not.toHaveProperty("clientSecret");
		expect(migrated.providers.microsoft.taskLists).toEqual([{ id: "list-1", title: "Inbox" }]);
		expect(migrated.showCompleted).toBe(false);
	});

	it("returns isolated provider defaults without sharing arrays", () => {
		const a = migrateSettings(undefined); const b = migrateSettings(undefined);
		a.providers.ticktick.taskLists.push({ id: "x", title: "X" });
		expect(b).toEqual(DEFAULT_SETTINGS);
		expect(b.providers.ticktick.taskLists).toEqual([]);
	});

	it("defaults automatic refresh to ten minutes with startup refresh disabled", () => {
		const settings = migrateSettings(undefined);
		expect(settings.autoSyncIntervalMinutes).toBe(10);
		expect(settings.autoSyncOnStartup).toBe(false);
	});

	it("adds automatic refresh defaults to existing v2 settings", () => {
		const existing = migrateSettings(undefined) as any;
		delete existing.autoSyncIntervalMinutes;
		delete existing.autoSyncOnStartup;
		const migrated = migrateSettings(existing);
		expect(migrated.autoSyncIntervalMinutes).toBe(10);
		expect(migrated.autoSyncOnStartup).toBe(false);
	});

	it("whitelists fields, validates lists, and cannot retain plaintext secrets", () => {
		const migrated = migrateSettings({
			version: 3, provider: "ticktick", unknown: "discard me", clientSecret: "top-secret",
			showCompleted: "yes", autoSyncIntervalMinutes: 0.001, timeZone: "Not/AZone",
			providers: {
				microsoft: { clientSecret: "nested-secret", taskLists: { id: "bad" } },
				ticktick: { clientId: "id", taskLists: [{ id: "ok", title: "Inbox", token: "bad" }, null, { id: 2, title: "bad" }] },
			},
		});
		expect(migrated).not.toHaveProperty("unknown");
		expect(JSON.stringify(migrated)).not.toContain("top-secret");
		expect(JSON.stringify(migrated)).not.toContain("nested-secret");
		expect(migrated.showCompleted).toBe(true);
		expect(migrated.autoSyncIntervalMinutes).toBe(10);
		expect(migrated.providers.ticktick.taskLists).toEqual([{ id: "ok", title: "Inbox" }]);
		expect(migrated.timeZone).not.toBe("Not/AZone");
	});

	it.each(["1", Number.NaN, Infinity, -1, 2, 600])("defaults invalid refresh interval %s", value => {
		expect(migrateSettings({ version: 3, autoSyncIntervalMinutes: value, providers: {} }).autoSyncIntervalMinutes).toBe(10);
	});
});
