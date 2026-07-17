import { describe, expect, it, vi } from "vitest";
import { changeProviderCredential, changeTimeZone } from "../src/settings-actions";
import { migrateSettings } from "../src/settings-model";

function actions() {
	return { logout: vi.fn(async () => {}), rebuild: vi.fn(async () => {}), save: vi.fn(async () => {}), refresh: vi.fn(async () => {}) };
}

describe("settings actions", () => {
	it.each(["clientId", "clientSecret", "redirectUrl"] as const)("invalidates auth before changing %s and rebuilding", async key => {
		const settings = migrateSettings(undefined);
		const effects = actions();
		const order: string[] = [];
		effects.logout.mockImplementation(async () => { order.push("logout"); });
		effects.rebuild.mockImplementation(async () => { order.push("rebuild"); });
		await changeProviderCredential(settings, key, "new-value", effects);
		expect(settings.providers.microsoft[key]).toBe("new-value");
		expect(order).toEqual(["logout", "rebuild"]);
		expect(effects.save).toHaveBeenCalledOnce();
		expect(effects.refresh).toHaveBeenCalledOnce();
	});

	it("rebuilds for a timezone change without logging out", async () => {
		const settings = migrateSettings(undefined);
		const effects = actions();
		await changeTimeZone(settings, "America/Toronto", effects);
		expect(settings.timeZone).toBe("America/Toronto");
		expect(effects.logout).not.toHaveBeenCalled();
		expect(effects.rebuild).toHaveBeenCalledOnce();
	});
});
