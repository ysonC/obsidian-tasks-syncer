import { randomBytes } from "crypto";
import { AuthProvider, TokenStore, requireCredentials } from "./index";
import { HttpClient } from "../http";

const AUTHORIZE_URL = "https://ticktick.com/oauth/authorize";
const TOKEN_URL = "https://ticktick.com/oauth/token";
const SCOPES = "tasks:read tasks:write";
interface TokenRecord { accessToken: string; expiresAt?: number; }

export function buildTickTickAuthorizationUrl(clientId: string, redirectUrl: string, state: string): string {
	const url = new URL(AUTHORIZE_URL); url.searchParams.set("client_id", clientId); url.searchParams.set("scope", SCOPES); url.searchParams.set("state", state); url.searchParams.set("redirect_uri", redirectUrl); url.searchParams.set("response_type", "code"); return url.toString();
}
export class TickTickAuthProvider implements AuthProvider {
	constructor(private config: { clientId: string; clientSecret: string; redirectUrl: string }, private store: TokenStore, private http: HttpClient, private authorize: (url: string, redirect: string) => Promise<string>, private createState: () => string = () => randomBytes(32).toString("hex")) { requireCredentials(config.clientId, config.clientSecret, config.redirectUrl); }
	async login(): Promise<string> {
		const state = this.createState(); const callback = await this.authorize(buildTickTickAuthorizationUrl(this.config.clientId, this.config.redirectUrl, state), this.config.redirectUrl);
		const callbackUrl = new URL(callback), configured = new URL(this.config.redirectUrl);
		if (callbackUrl.protocol !== configured.protocol || callbackUrl.host !== configured.host || callbackUrl.pathname !== configured.pathname) throw new Error("TickTick OAuth redirect did not exactly match the configured redirect URL.");
		if (callbackUrl.searchParams.get("state") !== state) throw new Error("TickTick OAuth state validation failed.");
		const oauthError = callbackUrl.searchParams.get("error"); if (oauthError) throw new Error(`TickTick authorization failed: ${oauthError}`);
		const code = callbackUrl.searchParams.get("code"); if (!code) throw new Error("TickTick authorization returned no code.");
		const body = new URLSearchParams({ code, grant_type: "authorization_code", scope: SCOPES, redirect_uri: this.config.redirectUrl }).toString();
		const res = await this.http<any>({ url: TOKEN_URL, method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
		if (res.status < 200 || res.status >= 300 || !res.json?.access_token) throw new Error("TickTick token exchange failed. Verify the client credentials and redirect URL.");
		const record: TokenRecord = { accessToken: res.json.access_token }; if (typeof res.json.expires_in === "number") record.expiresAt = Date.now() + res.json.expires_in * 1000;
		await this.store.write(JSON.stringify(record)); return record.accessToken;
	}
	async getAccessToken(): Promise<string> { const raw = await this.store.read(); if (!raw) throw new Error("Connect TickTick before syncing."); try { const record = JSON.parse(raw) as TokenRecord; if (!record.accessToken || (record.expiresAt && Date.now() >= record.expiresAt)) { await this.store.remove(); throw new Error("TickTick session expired. Connect TickTick again."); } return record.accessToken; } catch (e) { if (e instanceof Error && e.message.includes("TickTick session")) throw e; await this.store.remove(); throw new Error("TickTick token cache is invalid. Connect TickTick again."); } }
	async logout() { await this.store.remove(); }
	async isAuthenticated() { try { await this.getAccessToken(); return true; } catch { return false; } }
}
