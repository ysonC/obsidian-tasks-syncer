import { ConfidentialClientApplication, Configuration, type INetworkModule, type NetworkRequestOptions, type NetworkResponse } from "@azure/msal-node";
import { requestUrl } from "obsidian";
import { randomBytes } from "crypto";
import { AuthProvider, TokenStore, requireCredentials } from "./index";
import { abortError, isExactRedirect, openOAuthWindow, throwIfAborted, type OAuthAuthorize } from "./oauth";

const AUTHORITY = "https://login.microsoftonline.com/consumers";
const SCOPES = ["Tasks.ReadWrite", "offline_access"];

interface MicrosoftAuthDependencies {
	client?: ConfidentialClientApplication;
	authorize?: OAuthAuthorize;
	createState?: () => string;
	signal?: AbortSignal;
}

export class MicrosoftAuthProvider implements AuthProvider {
	private client: ConfidentialClientApplication;
	private authorize: OAuthAuthorize;
	private createState: () => string;
	private signal?: AbortSignal;
	constructor(
		private config: { clientId: string; clientSecret: string; redirectUrl: string },
		private store: TokenStore,
		dependencies: MicrosoftAuthDependencies = {},
	) {
		requireCredentials(config.clientId, config.clientSecret, config.redirectUrl);
		const msal: Configuration = {
			auth: { clientId: config.clientId, clientSecret: config.clientSecret, authority: AUTHORITY },
			system: { networkClient: new ObsidianMsalNetworkClient() },
		};
		this.client = dependencies.client || new ConfidentialClientApplication(msal);
		this.authorize = dependencies.authorize || openOAuthWindow;
		this.createState = dependencies.createState || (() => randomBytes(32).toString("hex"));
		this.signal = dependencies.signal;
	}
	private async loadCache() { const data = await this.store.read(); if (data) this.client.getTokenCache().deserialize(data); }
	private async saveCache() { await this.store.write(this.client.getTokenCache().serialize()); }
	async login(): Promise<string> {
		throwIfAborted(this.signal);
		const state = this.createState();
		const authUrl = await this.client.getAuthCodeUrl({ scopes: SCOPES, redirectUri: this.config.redirectUrl, prompt: "consent", state });
		throwIfAborted(this.signal);
		const callback = await this.authorize(authUrl, this.config.redirectUrl, this.signal);
		throwIfAborted(this.signal);
		if (!isExactRedirect(callback, this.config.redirectUrl)) throw new Error("Microsoft OAuth redirect did not exactly match the configured redirect URL.");
		const callbackUrl = new URL(callback);
		if (callbackUrl.searchParams.get("state") !== state) throw new Error("Microsoft OAuth state validation failed.");
		const code = callbackUrl.searchParams.get("code"); if (!code) throw new Error("Microsoft login did not return an authorization code.");
		const result = await this.client.acquireTokenByCode({ code, scopes: SCOPES, redirectUri: this.config.redirectUrl });
		if (!result?.accessToken) throw new Error("Microsoft login returned no access token.");
		throwIfAborted(this.signal);
		await this.saveCache();
		if (this.signal?.aborted) { await this.store.remove(); throw abortError(); }
		return result.accessToken;
	}
	async getAccessToken(): Promise<string> {
		await this.loadCache(); const accounts = await this.client.getTokenCache().getAllAccounts();
		if (!accounts.length) throw new Error("Connect Microsoft To Do before syncing.");
		const result = await this.client.acquireTokenSilent({ account: accounts[0], scopes: SCOPES });
		if (!result?.accessToken) throw new Error("Microsoft session expired. Connect again."); await this.saveCache(); return result.accessToken;
	}
	async logout() { const cache = this.client.getTokenCache(); for (const account of await cache.getAllAccounts()) await cache.removeAccount(account); await this.store.remove(); }
	async isAuthenticated() { await this.loadCache(); return (await this.client.getTokenCache().getAllAccounts()).length > 0; }
}

export class ObsidianMsalNetworkClient implements INetworkModule {
	async sendGetRequestAsync<T>(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
		return this.send<T>("GET", url, options);
	}
	async sendPostRequestAsync<T>(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
		return this.send<T>("POST", url, options);
	}
	private async send<T>(method: string, url: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
		const headers = { ...(options?.headers ?? {}) };
		delete headers.Origin;
		delete headers.origin;
		const contentType = headers["Content-Type"] ?? headers["content-type"];
		const response = await requestUrl({ url, method, headers, contentType, body: options?.body, throw: false });
		const text = response.text;
		let body: unknown = text;
		if (text.trim()) {
			try {
				body = JSON.parse(text);
			} catch {
				body = text;
			}
		}
		return { headers: response.headers, body: body as T, status: response.status };
	}
}
