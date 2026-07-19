import { requestUrl } from "obsidian";
import { AuthProvider } from "./auth";
import { MicrosoftAuthProvider, openOAuthWindow } from "./auth/microsoft";
import { TickTickAuthProvider } from "./auth/ticktick";
import { HttpClient } from "./http";
import { TaskSyncerSettings, tokenCacheSecretId } from "./settings-model";
import { SecretStore, SecretTokenStore } from "./secret-store";
import { MicrosoftTaskService } from "./services/microsoft";
import { TickTickTaskService } from "./services/ticktick";
import { ProviderId, TaskService } from "./types";

export interface ProviderRuntime { id: ProviderId; auth: AuthProvider; tasks: TaskService; }
export const obsidianHttpClient: HttpClient = async <T>(request: Parameters<HttpClient>[0]) => {
	const response = await requestUrl(request);
	return { status: response.status, json: response.json as T, text: response.text };
};

export function createProviderRuntime(id: ProviderId, settings: TaskSyncerSettings, secrets: SecretStore, http: HttpClient = obsidianHttpClient, signal?: AbortSignal): ProviderRuntime {
	const persisted = settings.providers[id];
	const config = {
		clientId: persisted.clientId,
		clientSecret: secrets.read(persisted.clientSecretId) ?? "",
		redirectUrl: persisted.redirectUrl,
	};
	const store = new SecretTokenStore(secrets, tokenCacheSecretId(id));
	if (id === "ticktick") {
		const auth = new TickTickAuthProvider(config, store, http, openOAuthWindow, undefined, signal);
		return { id, auth, tasks: new TickTickTaskService(() => auth.getAccessToken(), http, settings.timeZone, () => auth.logout()) };
	}
	const auth = new MicrosoftAuthProvider(config, store, { signal });
	return { id, auth, tasks: new MicrosoftTaskService(() => auth.getAccessToken(), http) };
}
