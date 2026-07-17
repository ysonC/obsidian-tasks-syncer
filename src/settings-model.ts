import { ProviderId, TaskList } from "./types";

export interface ProviderSettings {
	clientId: string; clientSecret: string; redirectUrl: string;
	selectedListId: string; selectedListTitle: string; taskLists: TaskList[];
}
export interface TaskSyncerSettings {
	version: 2; provider: ProviderId; providers: Record<ProviderId, ProviderSettings>;
	showCompleted: boolean; showDueDate: boolean; enableConfetti: boolean;
	confettiType: "regular" | "big" | "superbig"; timeZone: string;
	autoSyncIntervalMinutes: number; autoSyncOnStartup: boolean;
}
const providerDefaults = (redirectUrl: string): ProviderSettings => ({ clientId: "", clientSecret: "", redirectUrl, selectedListId: "", selectedListTitle: "", taskLists: [] });
export const createDefaultSettings = (): TaskSyncerSettings => ({
	version: 2, provider: "microsoft",
	providers: { microsoft: providerDefaults("http://localhost:5000"), ticktick: providerDefaults("http://localhost:5000") },
	showCompleted: true, showDueDate: false, enableConfetti: true, confettiType: "regular",
	autoSyncIntervalMinutes: 10, autoSyncOnStartup: false,
	timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
});
export const DEFAULT_SETTINGS = createDefaultSettings();

export function migrateSettings(raw: any): TaskSyncerSettings {
	const defaults = createDefaultSettings();
	if (!raw) return defaults;
	if (raw.version === 2 && raw.providers) {
		return {
			...defaults, ...raw,
			provider: raw.provider === "ticktick" ? "ticktick" : "microsoft",
			providers: {
				microsoft: { ...defaults.providers.microsoft, ...raw.providers.microsoft, taskLists: [...(raw.providers.microsoft?.taskLists || [])] },
				ticktick: { ...defaults.providers.ticktick, ...raw.providers.ticktick, taskLists: [...(raw.providers.ticktick?.taskLists || [])] },
			},
		};
	}
	const microsoft: ProviderSettings = {
		...defaults.providers.microsoft,
		clientId: raw.clientId || "", clientSecret: raw.clientSecret || "", redirectUrl: raw.redirectUrl || defaults.providers.microsoft.redirectUrl,
		selectedListId: raw.selectedTaskListId || "", selectedListTitle: raw.selectedTaskListTitle || "", taskLists: [...(raw.taskLists || [])],
	};
	return { ...defaults, provider: raw.selectedService === "ticktick" ? "ticktick" : "microsoft", providers: { ...defaults.providers, microsoft }, showCompleted: raw.showComplete ?? defaults.showCompleted, showDueDate: raw.showDueDate ?? defaults.showDueDate, enableConfetti: raw.enableConfetti ?? defaults.enableConfetti, confettiType: raw.confettiType || defaults.confettiType };
}
