import * as fs from "fs";

import type { TokenStore } from "./auth";
import type { TaskSyncerSettings } from "./settings-model";
import type { ProviderId } from "./types";

export interface SecretStore {
	read(id: string): string | null;
	write(id: string, value: string): void;
	remove(id: string): void;
}

export interface ObsidianSecretStorageApi {
	getSecret(id: string): string | null;
	setSecret(id: string, value: string): void;
}

export class ObsidianSecretStore implements SecretStore {
	constructor(private storage: ObsidianSecretStorageApi) {}
	read(id: string): string | null { return this.storage.getSecret(id); }
	write(id: string, value: string): void { this.storage.setSecret(id, value); }
	remove(id: string): void { this.storage.setSecret(id, ""); }
}

export class MemorySecretStore implements SecretStore {
	private values = new Map<string, string>();
	read(id: string): string | null { return this.values.get(id) ?? null; }
	write(id: string, value: string): void { this.values.set(id, value); }
	remove(id: string): void { this.values.delete(id); }
}

export class SecretTokenStore implements TokenStore {
	constructor(private secrets: SecretStore, private id: string) {}
	async read(): Promise<string> { return this.secrets.read(this.id) ?? ""; }
	async write(value: string): Promise<void> { this.secrets.write(this.id, value); }
	async remove(): Promise<void> { this.secrets.remove(this.id); }
}

function legacyClientSecret(raw: any, provider: ProviderId): string {
	if (provider === "microsoft" && typeof raw?.clientSecret === "string") return raw.clientSecret;
	const value = raw?.providers?.[provider]?.clientSecret;
	return typeof value === "string" ? value : "";
}

/** Transactionally moves legacy data.json client secrets into Obsidian SecretStorage. */
export async function migrateLegacyClientSecrets(
	raw: any,
	settings: TaskSyncerSettings,
	secrets: SecretStore,
	clearPlaintext: () => Promise<void>,
): Promise<void> {
	const legacy: Array<{ provider: ProviderId; id: string; value: string }> = [];
	for (const provider of ["microsoft", "ticktick"] as const) {
		const value = legacyClientSecret(raw, provider);
		if (!value) continue;
		const id = settings.providers[provider].clientSecretId;
		const existing = secrets.read(id);
		if (existing && existing !== value) {
			throw new Error(`SecretStorage conflict for ${provider}: the stored client secret differs from the legacy plaintext. Resolve the conflict before retrying migration.`);
		}
		legacy.push({ provider, id, value });
	}
	for (const entry of legacy) {
		if (!secrets.read(entry.id)) secrets.write(entry.id, entry.value);
	}
	for (const entry of legacy) {
		if (secrets.read(entry.id) !== entry.value) throw new Error(`Could not verify migrated ${entry.provider} client secret.`);
	}
	if (legacy.length) await clearPlaintext();
}

/** Moves a plaintext token cache only after SecretStorage returns the exact value. */
export async function migrateLegacyTokenFile(filePath: string, store: TokenStore): Promise<void> {
	if (!fs.existsSync(filePath)) return;
	if (await store.read()) return;
	const value = fs.readFileSync(filePath, "utf8");
	await store.write(value);
	if (await store.read() !== value) throw new Error(`Could not verify migrated token cache: ${filePath}`);
	fs.unlinkSync(filePath);
}
