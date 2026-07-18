import { describe, expect, it } from "vitest";
import {
	MemorySecretStore,
	ObsidianSecretStore,
	SecretTokenStore,
	migrateLegacyClientSecrets,
	migrateLegacyTokenFile,
} from "../src/secret-store";
import { migrateSettings } from "../src/settings-model";

function memoryAdapter(entries: Record<string, string>) {
	const files = new Map(Object.entries(entries));
	return {
		files,
		exists: async (file: string) => files.has(file),
		read: async (file: string) => files.get(file) ?? "",
		remove: async (file: string) => { files.delete(file); },
	};
}

describe("SecretStore-backed persistence", () => {
	it("clears secrets through the Obsidian 1.13.1 API surface", () => {
		const values = new Map([["token", "cached-token"]]);
		const storage = {
			getSecret: (id: string) => values.get(id) ?? null,
			setSecret: (id: string, value: string) => { values.set(id, value); },
		};
		const secrets = new ObsidianSecretStore(storage);
		secrets.remove("token");
		expect(secrets.read("token")).toBe("");
	});

	it("stores token caches without plaintext files", async () => {
		const secrets = new MemorySecretStore();
		const tokens = new SecretTokenStore(secrets, "task-syncer-plugin-microsoft-token-cache");
		await tokens.write('{"accessToken":"test"}');
		expect(await tokens.read()).toBe('{"accessToken":"test"}');
		await tokens.remove();
		expect(await tokens.read()).toBe("");
	});

	it("writes and verifies a legacy client secret before requesting plaintext removal", async () => {
		const secrets = new MemorySecretStore();
		const settings = migrateSettings({ clientId: "id", clientSecret: "legacy", redirectUrl: "http://localhost:5000" });
		let cleared = false;
		await migrateLegacyClientSecrets(
			{ clientSecret: "legacy" },
			settings,
			secrets,
			async () => { cleared = true; },
		);
		expect(await secrets.read(settings.providers.microsoft.clientSecretId)).toBe("legacy");
		expect(cleared).toBe(true);
	});

	it("keeps legacy plaintext when SecretStorage verification fails", async () => {
		const settings = migrateSettings({ clientSecret: "legacy" });
		let wrote = false;
		const secrets = {
			read: () => wrote ? "wrong" : null,
			write: () => { wrote = true; },
			remove: () => {},
		};
		let cleared = false;
		await expect(migrateLegacyClientSecrets({ clientSecret: "legacy" }, settings, secrets, async () => { cleared = true; })).rejects.toThrow("verify");
		expect(cleared).toBe(false);
	});

	it("moves a conflicting legacy client secret to distinct SecretStorage before clearing plaintext", async () => {
		const secrets = new MemorySecretStore();
		const settings = migrateSettings({ clientSecret: "legacy" });
		const id = settings.providers.microsoft.clientSecretId;
		const conflictId = `${id}-legacy-conflict`;
		secrets.write(id, "newer-secret");
		let cleared = false;
		await migrateLegacyClientSecrets(
			{ clientSecret: "legacy" },
			settings,
			secrets,
			async () => { cleared = true; },
			{ microsoft: new SecretTokenStore(secrets, conflictId), ticktick: new SecretTokenStore(secrets, "ticktick-conflict") },
		);
		expect(secrets.read(id)).toBe("newer-secret");
		expect(secrets.read(conflictId)).toBe("legacy");
		expect(cleared).toBe(true);
	});

	it("preserves every provider value securely before clearing all plaintext", async () => {
		const settings = migrateSettings({
			providers: {
				microsoft: { clientSecret: "microsoft-legacy" },
				ticktick: { clientSecret: "ticktick-legacy" },
			},
		});
		const secrets = new MemorySecretStore();
		secrets.write(settings.providers.ticktick.clientSecretId, "ticktick-different");
		let cleared = false;
		await migrateLegacyClientSecrets(
			{
				providers: {
					microsoft: { clientSecret: "microsoft-legacy" },
					ticktick: { clientSecret: "ticktick-legacy" },
				},
			},
			settings,
			secrets,
			async () => { cleared = true; },
			{
				microsoft: new SecretTokenStore(secrets, `${settings.providers.microsoft.clientSecretId}-legacy-conflict`),
				ticktick: new SecretTokenStore(secrets, `${settings.providers.ticktick.clientSecretId}-legacy-conflict`),
			},
		);
		expect(secrets.read(settings.providers.microsoft.clientSecretId)).toBe("microsoft-legacy");
		expect(secrets.read(settings.providers.ticktick.clientSecretId)).toBe("ticktick-different");
		expect(secrets.read(`${settings.providers.ticktick.clientSecretId}-legacy-conflict`)).toBe("ticktick-legacy");
		expect(cleared).toBe(true);
	});

	it("removes a legacy token file only after SecretStorage readback succeeds", async () => {
		const legacyPath = "custom-config/plugins/task-syncer/token_cache.json";
		const adapter = memoryAdapter({ [legacyPath]: "legacy-cache" });
		const secrets = new MemorySecretStore();
		const tokens = new SecretTokenStore(secrets, "task-syncer-plugin-microsoft-token-cache");
		await migrateLegacyTokenFile(adapter, legacyPath, tokens);
		expect(await tokens.read()).toBe("legacy-cache");
		expect(adapter.files.has(legacyPath)).toBe(false);
	});

	it("moves a conflicting legacy token to distinct SecretStorage before deleting its plaintext file", async () => {
		const legacyPath = "custom-config/plugins/task-syncer/microsoft-token-cache.json";
		const adapter = memoryAdapter({ [legacyPath]: "older-file-cache" });
		const secrets = new MemorySecretStore();
		const tokens = new SecretTokenStore(secrets, "task-syncer-plugin-microsoft-token-cache");
		const conflicts = new SecretTokenStore(secrets, "task-syncer-plugin-microsoft-token-cache-legacy-conflict");
		await tokens.write("newer-secret-cache");
		await migrateLegacyTokenFile(adapter, legacyPath, tokens, conflicts);
		expect(await tokens.read()).toBe("newer-secret-cache");
		expect(await conflicts.read()).toBe("older-file-cache");
		expect(adapter.files.has(legacyPath)).toBe(false);
	});
});
