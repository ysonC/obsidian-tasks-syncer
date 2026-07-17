import { requestUrl } from "obsidian";
import * as path from "path";
import { AuthProvider, FileTokenStore, migrateLegacyTokenCache } from "./auth";
import { MicrosoftAuthProvider, openOAuthWindow } from "./auth/microsoft";
import { TickTickAuthProvider } from "./auth/ticktick";
import { HttpClient } from "./http";
import { ProviderSettings, TaskSyncerSettings } from "./settings-model";
import { MicrosoftTaskService } from "./services/microsoft";
import { TickTickTaskService } from "./services/ticktick";
import { ProviderId, TaskService } from "./types";

export interface ProviderRuntime { id: ProviderId; auth: AuthProvider; tasks: TaskService; }
export const obsidianHttpClient: HttpClient = async (request) => requestUrl(request as any) as any;

export function createProviderRuntime(id: ProviderId, settings: TaskSyncerSettings, pluginDirectory: string, http: HttpClient = obsidianHttpClient): ProviderRuntime {
	const config: ProviderSettings = settings.providers[id];
	const tokenPath = path.join(pluginDirectory, `${id}-token-cache.json`);
	if (id === "microsoft") migrateLegacyTokenCache(path.join(pluginDirectory, "token_cache.json"), tokenPath);
	const store = new FileTokenStore(tokenPath);
	if (id === "ticktick") {
		const auth = new TickTickAuthProvider(config, store, http, openOAuthWindow);
		return { id, auth, tasks: new TickTickTaskService(() => auth.getAccessToken(), http, settings.timeZone, () => auth.logout()) };
	}
	const auth = new MicrosoftAuthProvider(config, store);
	return { id, auth, tasks: new MicrosoftTaskService(() => auth.getAccessToken(), http) };
}
