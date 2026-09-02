import { BrowserWindow } from "@electron/remote";
import { randomBytes } from "crypto";
import { createServer, type Server, type ServerResponse } from "http";

export type OAuthAuthorize = (authUrl: string, redirectUrl: string, signal?: AbortSignal) => Promise<string>;

export function abortError(): Error {
	const error = new Error("OAuth authorization was aborted.");
	error.name = "AbortError";
	return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

export function openOAuthWindow(authUrl: string, redirectUrl: string, signal?: AbortSignal): Promise<string> {
	if (signal?.aborted) return Promise.reject(abortError());
	let configuredRedirect: URL;
	try {
		configuredRedirect = new URL(redirectUrl);
	} catch {
		return Promise.reject(new Error(`Invalid OAuth redirect URL: ${redirectUrl}`));
	}
	return new Promise((resolve, reject) => {
		const win = new BrowserWindow({ width: 600, height: 700, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: `task-syncer-oauth-${randomBytes(16).toString("hex")}` } });
		let settled = false;
		let callbackServer: Server | undefined;
		const cleanup = () => {
			signal?.removeEventListener("abort", abort);
			win.webContents.removeListener("will-redirect", inspect);
			win.webContents.removeListener("will-navigate", inspect);
			win.removeListener("closed", closed);
			callbackServer?.close();
			callbackServer = undefined;
		};
		const finish = (error?: Error, url?: string) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (!win.isDestroyed()) win.close();
			if (error) reject(error); else resolve(url!);
		};
		const inspect = (event: { preventDefault(): void }, url: string) => {
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
		const abort = () => finish(abortError());
		const closed = () => finish(new Error("OAuth login window was closed."));
		callbackServer = startLoopbackRedirectServer(configuredRedirect, finish);
		win.webContents.setWindowOpenHandler((details: { url: string }) => {
			if (!settled && details.url) void win.loadURL(details.url).catch((error: Error) => finish(error));
			return { action: "deny" };
		});
		win.webContents.on("will-redirect", inspect);
		win.webContents.on("will-navigate", inspect);
		win.on("closed", closed);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) { abort(); return; }
		void win.loadURL(authUrl).catch((error: Error) => finish(error));
	});
}

function startLoopbackRedirectServer(configuredRedirect: URL, finish: (error?: Error, url?: string) => void): Server | undefined {
	if (configuredRedirect.protocol !== "http:" || !isLoopbackHost(configuredRedirect.hostname)) return undefined;
	const port = Number(configuredRedirect.port || "80");
	if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
	const server = createServer((request, response) => {
		const callbackUrl = `${configuredRedirect.protocol}//${configuredRedirect.host}${request.url ?? "/"}`;
		try {
			const parsed = new URL(callbackUrl);
			if (!isSameRedirect(parsed, configuredRedirect)) {
				writeOAuthResponse(response, 404, "OAuth callback did not match this login request.");
				return;
			}
			const error = parsed.searchParams.get("error");
			writeOAuthResponse(response, error ? 400 : 200, error ? "OAuth authorization failed. You can return to Obsidian." : "OAuth authorization received. You can return to Obsidian.");
			finish(error ? new Error(`OAuth authorization failed: ${error}`) : undefined, callbackUrl);
		} catch (error) {
			writeOAuthResponse(response, 400, "OAuth callback was invalid. You can return to Obsidian.");
			finish(error instanceof Error ? error : new Error(String(error)));
		}
	});
	server.on("error", () => undefined);
	server.listen(port, configuredRedirect.hostname);
	return server;
}

function isLoopbackHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function writeOAuthResponse(response: ServerResponse, statusCode: number, message: string): void {
	response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
	response.end(message);
}

function isSameRedirect(callback: URL, configured: URL) {
	if (callback.protocol !== configured.protocol || callback.host !== configured.host || callback.pathname !== configured.pathname) return false;
	const oauthResponseParameters = new Set(["code", "state", "error", "error_description", "error_uri", "client_info", "clientdata"]);
	const fixedCallback = Array.from(callback.searchParams)
		.filter(([key]) => !oauthResponseParameters.has(key))
		.map(([key, value]) => `${key}\u0000${value}`)
		.sort();
	const fixedConfigured = Array.from(configured.searchParams)
		.map(([key, value]) => `${key}\u0000${value}`)
		.sort();
	return fixedCallback.length === fixedConfigured.length
		&& fixedCallback.every((entry, index) => entry === fixedConfigured[index]);
}

export function isExactRedirect(callback: string, configured: string) { return isSameRedirect(new URL(callback), new URL(configured)); }
