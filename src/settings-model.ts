import { ProviderId, TaskList } from "./types";

export const clientSecretId = (provider: ProviderId): string => `task-syncer-plugin-${provider}-client-secret`;
export const tokenCacheSecretId = (provider: ProviderId): string => `task-syncer-plugin-${provider}-token-cache`;
export const AUTO_SYNC_INTERVALS = [0, 1, 5, 10, 15, 30, 60] as const;

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

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown, fallback: string): string => typeof value === "string" ? value : fallback;
const booleanValue = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;
const providerDefaults = (provider: ProviderId, redirectUrl: string): ProviderSettings => ({ clientId: "", clientSecretId: clientSecretId(provider), redirectUrl, selectedListId: "", selectedListTitle: "", taskLists: [] });

function systemTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
function validTimeZone(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return fallback; }
}
function validLists(value: unknown): TaskList[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap(item => isRecord(item) && typeof item.id === "string" && typeof item.title === "string"
		? [{ id: item.id, title: item.title }]
		: []);
}
function interval(value: unknown, fallback: number): number {
	return typeof value === "number" && (AUTO_SYNC_INTERVALS as readonly number[]).includes(value) ? value : fallback;
}
function confettiType(value: unknown, fallback: TaskSyncerSettings["confettiType"]): TaskSyncerSettings["confettiType"] {
	return value === "regular" || value === "big" || value === "superbig" ? value : fallback;
}

export const createDefaultSettings = (): TaskSyncerSettings => ({
	version: 3, provider: "microsoft",
	providers: { microsoft: providerDefaults("microsoft", "http://localhost:5000"), ticktick: providerDefaults("ticktick", "http://localhost:5000") },
	showCompleted: true, showDueDate: false, enableConfetti: true, confettiType: "regular",
	autoSyncIntervalMinutes: 10, autoSyncOnStartup: false, timeZone: systemTimeZone(),
});
export const DEFAULT_SETTINGS = createDefaultSettings();

function cleanProvider(value: unknown, defaults: ProviderSettings): ProviderSettings {
	const raw = isRecord(value) ? value : {};
	return {
		clientId: stringValue(raw.clientId, defaults.clientId),
		// Secret references remain stable; arbitrary persisted IDs are accepted only when syntactically valid.
		clientSecretId: typeof raw.clientSecretId === "string" && /^[a-z0-9-]+$/.test(raw.clientSecretId) ? raw.clientSecretId : defaults.clientSecretId,
		redirectUrl: stringValue(raw.redirectUrl, defaults.redirectUrl),
		selectedListId: stringValue(raw.selectedListId, defaults.selectedListId),
		selectedListTitle: stringValue(raw.selectedListTitle, defaults.selectedListTitle),
		taskLists: validLists(raw.taskLists),
	};
}

export function migrateSettings(value: unknown): TaskSyncerSettings {
	const defaults = createDefaultSettings();
	if (!isRecord(value)) return defaults;
	const providers = isRecord(value.providers) ? value.providers : {};
	const modern = value.version === 2 || value.version === 3 || isRecord(value.providers);
	const microsoftValue: unknown = modern ? providers.microsoft : {
		clientId: value.clientId, redirectUrl: value.redirectUrl,
		selectedListId: value.selectedTaskListId, selectedListTitle: value.selectedTaskListTitle,
		taskLists: value.taskLists,
	};
	return {
		version: 3,
		provider: (modern ? value.provider : value.selectedService) === "ticktick" ? "ticktick" : "microsoft",
		providers: {
			microsoft: cleanProvider(microsoftValue, defaults.providers.microsoft),
			ticktick: cleanProvider(providers.ticktick, defaults.providers.ticktick),
		},
		showCompleted: booleanValue(modern ? value.showCompleted : value.showComplete, defaults.showCompleted),
		showDueDate: booleanValue(value.showDueDate, defaults.showDueDate),
		enableConfetti: booleanValue(value.enableConfetti, defaults.enableConfetti),
		confettiType: confettiType(value.confettiType, defaults.confettiType),
		timeZone: validTimeZone(value.timeZone, defaults.timeZone),
		autoSyncIntervalMinutes: interval(value.autoSyncIntervalMinutes, defaults.autoSyncIntervalMinutes),
		autoSyncOnStartup: booleanValue(value.autoSyncOnStartup, defaults.autoSyncOnStartup),
	};
}
