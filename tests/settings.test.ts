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
		expect(migrated.version).toBe(2);
		expect(migrated.provider).toBe("microsoft");
		expect(migrated.providers.microsoft).toMatchObject({ clientId: "old-id", clientSecret: "old-secret", redirectUrl: "http://localhost:5000", selectedListId: "list-1", selectedListTitle: "Inbox" });
		expect(migrated.providers.microsoft.taskLists).toEqual([{ id: "list-1", title: "Inbox" }]);
		expect(migrated.showCompleted).toBe(false);
	});

	it("returns isolated provider defaults without sharing arrays", () => {
		const a = migrateSettings(undefined); const b = migrateSettings(undefined);
		a.providers.ticktick.taskLists.push({ id: "x", title: "X" });
		expect(b).toEqual(DEFAULT_SETTINGS);
		expect(b.providers.ticktick.taskLists).toEqual([]);
	});
});
