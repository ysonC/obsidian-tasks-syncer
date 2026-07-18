
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

export const legacyConflictSecretId = (id: string, source = ""): string =>
	`${id}-legacy-conflict${source ? `-${source}` : ""}`;

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);

function legacyClientSecret(raw: unknown, provider: ProviderId): string {
	if (!isRecord(raw)) return "";
	if (provider === "microsoft" && typeof raw.clientSecret === "string") return raw.clientSecret;
	const providers = isRecord(raw.providers) ? raw.providers : undefined;
	const providerSettings = providers && isRecord(providers[provider]) ? providers[provider] : undefined;
	const value = providerSettings?.clientSecret;
	return typeof value === "string" ? value : "";
}

/** Transactionally moves legacy data.json client secrets into Obsidian SecretStorage. */
export async function migrateLegacyClientSecrets(
	raw: unknown,
	settings: TaskSyncerSettings,
	secrets: SecretStore,
	clearPlaintext: () => Promise<void>,
	conflictStores: Partial<Record<ProviderId, TokenStore>> = {},
): Promise<void> {
	const legacy: Array<{ provider: ProviderId; id: string; value: string; destination?: TokenStore }> = [];
	for (const provider of ["microsoft", "ticktick"] as const) {
		const value = legacyClientSecret(raw, provider);
		if (!value) continue;
		const id = settings.providers[provider].clientSecretId;
		const existing = secrets.read(id);
		if (existing && existing !== value) {
			const destination = conflictStores[provider];
			if (!destination) throw new Error(`No secure conflict store was provided for the legacy ${provider} client secret.`);
			legacy.push({ provider, id, value, destination });
			continue;
		}
		legacy.push({ provider, id, value });
	}
	for (const entry of legacy) {
		if (entry.destination) {
			const existing = await entry.destination.read();
			if (existing && existing !== entry.value) throw new Error(`SecretStorage legacy conflict slot is already occupied for ${entry.provider}.`);
			if (!existing) await entry.destination.write(entry.value);
		} else if (!secrets.read(entry.id)) secrets.write(entry.id, entry.value);
	}
	for (const entry of legacy) {
		const migrated = entry.destination ? await entry.destination.read() : secrets.read(entry.id);
		if (migrated !== entry.value) throw new Error(`Could not verify migrated ${entry.provider} client secret.`);
	}
	if (legacy.length) await clearPlaintext();
}

/** Moves a plaintext token cache only after SecretStorage returns the exact value. */
export interface LegacyFileAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	remove(path: string): Promise<void>;
}

/** Migrates a vault-relative legacy token file through Obsidian's adapter. */
export async function migrateLegacyTokenFile(adapter: LegacyFileAdapter, filePath: string, store: TokenStore, conflictStore?: TokenStore): Promise<void> {
	if (!await adapter.exists(filePath)) return;
	const value = await adapter.read(filePath);
	const existing = await store.read();
	const destination = existing && existing !== value ? conflictStore : store;
	if (!destination) throw new Error(`No secure conflict store was provided for legacy token cache: ${filePath}`);
	const destinationValue = await destination.read();
	if (destinationValue && destinationValue !== value) throw new Error(`SecretStorage legacy conflict slot is already occupied for token cache: ${filePath}`);
	if (!destinationValue) await destination.write(value);
	if (await destination.read() !== value) throw new Error(`Could not verify migrated token cache: ${filePath}`);
	await adapter.remove(filePath);
}
