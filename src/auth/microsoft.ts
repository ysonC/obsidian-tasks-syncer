import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import { BrowserWindow } from "@electron/remote";
import { randomBytes } from "crypto";
import { AuthProvider, TokenStore, requireCredentials } from "./index";

const AUTHORITY = "https://login.microsoftonline.com/consumers";
const SCOPES = ["Tasks.ReadWrite", "offline_access"];

interface MicrosoftAuthDependencies {
	client?: ConfidentialClientApplication;
	authorize?: (authUrl: string, redirectUrl: string) => Promise<string>;
	createState?: () => string;
}

export class MicrosoftAuthProvider implements AuthProvider {
	private client: ConfidentialClientApplication;
	private authorize: (authUrl: string, redirectUrl: string) => Promise<string>;
	private createState: () => string;
	constructor(
		private config: { clientId: string; clientSecret: string; redirectUrl: string },
		private store: TokenStore,
		dependencies: MicrosoftAuthDependencies = {},
	) {
		requireCredentials(config.clientId, config.clientSecret, config.redirectUrl);
		const msal: Configuration = { auth: { clientId: config.clientId, clientSecret: config.clientSecret, authority: AUTHORITY } };
		this.client = dependencies.client || new ConfidentialClientApplication(msal);
		this.authorize = dependencies.authorize || openOAuthWindow;
		this.createState = dependencies.createState || (() => randomBytes(32).toString("hex"));
	}
	private async loadCache() { const data = await this.store.read(); if (data) this.client.getTokenCache().deserialize(data); }
	private async saveCache() { await this.store.write(this.client.getTokenCache().serialize()); }
	async login(): Promise<string> {
		const state = this.createState();
		const authUrl = await this.client.getAuthCodeUrl({ scopes: SCOPES, redirectUri: this.config.redirectUrl, prompt: "consent", state });
		const callback = await this.authorize(authUrl, this.config.redirectUrl);
		const callbackUrl = new URL(callback);
		if (callbackUrl.searchParams.get("state") !== state) throw new Error("Microsoft OAuth state validation failed.");
		const code = callbackUrl.searchParams.get("code"); if (!code) throw new Error("Microsoft login did not return an authorization code.");
		const result = await this.client.acquireTokenByCode({ code, scopes: SCOPES, redirectUri: this.config.redirectUrl });
		if (!result?.accessToken) throw new Error("Microsoft login returned no access token.");
		await this.saveCache(); return result.accessToken;
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

export function openOAuthWindow(authUrl: string, redirectUrl: string): Promise<string> {
	let configuredRedirect: URL;
	try {
		configuredRedirect = new URL(redirectUrl);
	} catch {
		return Promise.reject(new Error(`Invalid Microsoft OAuth redirect URL: ${redirectUrl}`));
	}
	return new Promise((resolve, reject) => {
		const win = new BrowserWindow({ width: 600, height: 700, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: `task-syncer-oauth-${Date.now()}` } });
		let settled = false;
		const finish = (error?: Error, url?: string) => { if (settled) return; settled = true; if (!win.isDestroyed()) win.close(); if (error) reject(error); else resolve(url!); };
		const inspect = (event: any, url: string) => {
			try {
				const parsed = new URL(url);
				if (!isSameRedirect(parsed, configuredRedirect)) return;
				event.preventDefault();
				const error = parsed.searchParams.get("error");
				finish(error ? new Error(`OAuth authorization failed: ${error}`) : undefined, url);
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		};
		win.webContents.on("will-redirect", inspect); win.webContents.on("will-navigate", inspect); win.on("closed", () => finish(new Error("OAuth login window was closed."))); win.loadURL(authUrl).catch((e: Error) => finish(e));
	});
}
function isSameRedirect(callback: URL, configured: URL) { return callback.protocol === configured.protocol && callback.host === configured.host && callback.pathname === configured.pathname; }
export function isExactRedirect(callback: string, configured: string) { return isSameRedirect(new URL(callback), new URL(configured)); }
