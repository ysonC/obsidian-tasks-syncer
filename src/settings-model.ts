import { ProviderId, TaskList } from "./types";

export const clientSecretId = (provider: ProviderId): string => `task-syncer-plugin-${provider}-client-secret`;
export const tokenCacheSecretId = (provider: ProviderId): string => `task-syncer-plugin-${provider}-token-cache`;

export interface ProviderSettings {
	clientId: string; clientSecretId: string; redirectUrl: string;
	selectedListId: string; selectedListTitle: string; taskLists: TaskList[];
}
export interface TaskSyncerSettings {
	version: 3; provider: ProviderId; providers: Record<ProviderId, ProviderSettings>;
	showCompleted: boolean; showDueDate: boolean; enableConfetti: boolean;
	confettiType: "regular" | "big" | "superbig"; timeZone: string;
	autoSyncIntervalMinutes: number; autoSyncOnStartup: boolean;
}
const providerDefaults = (provider: ProviderId, redirectUrl: string): ProviderSettings => ({ clientId: "", clientSecretId: clientSecretId(provider), redirectUrl, selectedListId: "", selectedListTitle: "", taskLists: [] });
export const createDefaultSettings = (): TaskSyncerSettings => ({
	version: 3, provider: "microsoft",
	providers: { microsoft: providerDefaults("microsoft", "http://localhost:5000"), ticktick: providerDefaults("ticktick", "http://localhost:5000") },
	showCompleted: true, showDueDate: false, enableConfetti: true, confettiType: "regular",
	autoSyncIntervalMinutes: 10, autoSyncOnStartup: false,
	timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
});
export const DEFAULT_SETTINGS = createDefaultSettings();

function cleanProvider(raw: any, defaults: ProviderSettings): ProviderSettings {
	return {
		clientId: typeof raw?.clientId === "string" ? raw.clientId : defaults.clientId,
		clientSecretId: typeof raw?.clientSecretId === "string" ? raw.clientSecretId : defaults.clientSecretId,
		redirectUrl: typeof raw?.redirectUrl === "string" ? raw.redirectUrl : defaults.redirectUrl,
		selectedListId: typeof raw?.selectedListId === "string" ? raw.selectedListId : defaults.selectedListId,
		selectedListTitle: typeof raw?.selectedListTitle === "string" ? raw.selectedListTitle : defaults.selectedListTitle,
		taskLists: [...(raw?.taskLists || [])],
	};
}

export function migrateSettings(raw: any): TaskSyncerSettings {
	const defaults = createDefaultSettings();
	if (!raw) return defaults;
	if ((raw.version === 2 || raw.version === 3) && raw.providers) {
		return {
			...defaults, ...raw,
			version: 3,
			provider: raw.provider === "ticktick" ? "ticktick" : "microsoft",
			providers: {
				microsoft: cleanProvider(raw.providers.microsoft, defaults.providers.microsoft),
				ticktick: cleanProvider(raw.providers.ticktick, defaults.providers.ticktick),
			},
		};
	}
	const microsoft: ProviderSettings = {
		...defaults.providers.microsoft,
		clientId: raw.clientId || "", redirectUrl: raw.redirectUrl || defaults.providers.microsoft.redirectUrl,
		selectedListId: raw.selectedTaskListId || "", selectedListTitle: raw.selectedTaskListTitle || "", taskLists: [...(raw.taskLists || [])],
	};
	return { ...defaults, provider: raw.selectedService === "ticktick" ? "ticktick" : "microsoft", providers: { ...defaults.providers, microsoft }, showCompleted: raw.showComplete ?? defaults.showCompleted, showDueDate: raw.showDueDate ?? defaults.showDueDate, enableConfetti: raw.enableConfetti ?? defaults.enableConfetti, confettiType: raw.confettiType || defaults.confettiType };
}
