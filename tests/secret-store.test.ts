import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
	MemorySecretStore,
	ObsidianSecretStore,
	SecretTokenStore,
	migrateLegacyClientSecrets,
	migrateLegacyTokenFile,
} from "../src/secret-store";
import { migrateSettings } from "../src/settings-model";

const directories: string[] = [];
function tempDirectory(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "task-syncer-secret-"));
	directories.push(directory);
	return directory;
}
afterEach(() => directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));

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

	it("rejects a conflicting SecretStorage client secret without clearing plaintext", async () => {
		const secrets = new MemorySecretStore();
		const settings = migrateSettings({ clientSecret: "legacy" });
		const id = settings.providers.microsoft.clientSecretId;
		secrets.write(id, "newer-secret");
		let cleared = false;
		await expect(migrateLegacyClientSecrets(
			{ clientSecret: "legacy" },
			settings,
			secrets,
			async () => { cleared = true; },
		)).rejects.toThrow(/conflict.*microsoft/i);
		expect(secrets.read(id)).toBe("newer-secret");
		expect(cleared).toBe(false);
	});

	it("preflights every provider conflict before writing any missing secret", async () => {
		const settings = migrateSettings({
			providers: {
				microsoft: { clientSecret: "microsoft-legacy" },
				ticktick: { clientSecret: "ticktick-legacy" },
			},
		});
		const values = new Map<string, string>([
			[settings.providers.ticktick.clientSecretId, "ticktick-different"],
		]);
		const writes: Array<[string, string]> = [];
		const secrets = {
			read: (id: string) => values.get(id) ?? null,
			write: (id: string, value: string) => { writes.push([id, value]); values.set(id, value); },
			remove: (id: string) => { values.delete(id); },
		};
		let cleared = false;
		await expect(migrateLegacyClientSecrets(
			{
				providers: {
					microsoft: { clientSecret: "microsoft-legacy" },
					ticktick: { clientSecret: "ticktick-legacy" },
				},
			},
			settings,
			secrets,
			async () => { cleared = true; },
		)).rejects.toThrow(/conflict.*ticktick/i);
		expect(writes).toEqual([]);
		expect(cleared).toBe(false);
	});

	it("removes a legacy token file only after SecretStorage readback succeeds", async () => {
		const directory = tempDirectory();
		const legacyPath = path.join(directory, "token_cache.json");
		fs.writeFileSync(legacyPath, "legacy-cache");
		const secrets = new MemorySecretStore();
		const tokens = new SecretTokenStore(secrets, "task-syncer-plugin-microsoft-token-cache");
		await migrateLegacyTokenFile(legacyPath, tokens);
		expect(await tokens.read()).toBe("legacy-cache");
		expect(fs.existsSync(legacyPath)).toBe(false);
	});

	it("does not overwrite an existing SecretStorage token or delete an unverified legacy file", async () => {
		const directory = tempDirectory();
		const legacyPath = path.join(directory, "microsoft-token-cache.json");
		fs.writeFileSync(legacyPath, "older-file-cache");
		const secrets = new MemorySecretStore();
		const tokens = new SecretTokenStore(secrets, "task-syncer-plugin-microsoft-token-cache");
		await tokens.write("newer-secret-cache");
		await migrateLegacyTokenFile(legacyPath, tokens);
		expect(await tokens.read()).toBe("newer-secret-cache");
		expect(fs.existsSync(legacyPath)).toBe(true);
	});
});
