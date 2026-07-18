import { TaskSyncerSettings } from "./settings-model";

type CredentialKey = "clientId" | "clientSecretId" | "redirectUrl";

export interface SettingsEffects {
	logout(): Promise<void>;

	rebuild(): Promise<void>;
	save(): Promise<void>;
	refresh(): Promise<void>;
}

export async function changeProviderCredential(
	settings: TaskSyncerSettings,
	key: CredentialKey,
	value: string,
	effects: SettingsEffects,
): Promise<void> {
	await effects.logout();
	settings.providers[settings.provider][key] = value;
	await effects.rebuild();
	await effects.save();
	await effects.refresh();
}

export async function changeTimeZone(
	settings: TaskSyncerSettings,
	value: string,
	effects: SettingsEffects,
): Promise<void> {
	try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); }
	catch { throw new Error(`Invalid IANA time zone: ${value}`); }
	settings.timeZone = value;
	await effects.rebuild();
	await effects.save();
	await effects.refresh();
}
