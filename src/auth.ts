// src/auth.ts
import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import { BrowserWindow } from "@electron/remote";
import * as fs from "fs";

const AUTHORITY = "https://login.microsoftonline.com/consumers";
const REDIRECT_URI = "http://localhost:5000"; // Must match your Azure registration
const SCOPES = ["Tasks.ReadWrite", "offline_access"];

/**
 * AuthManager handles authentication, token caching, and token refreshing using MSAL.
 */
export class AuthManager {
	cca: ConfidentialClientApplication;
	tokenFilePath: string;
	clientId: string;
	clientSecret: string;
	redirectUrl: string;

	/**
	 * Creates an instance of AuthManager.
	 * @param clientId - The client ID of your Azure AD application.
	 * @param clientSecret - The client secret of your Azure AD application.
	 * @param redirectUrl - The redirect URL registered in your Azure AD app.
	 * @param tokenFilePath - Path to the file where the token cache will be stored.
	 */
	constructor(clientId: string, clientSecret: string, redirectUrl: string, tokenFilePath: string) {
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.redirectUrl = redirectUrl;
		this.tokenFilePath = tokenFilePath;
		this.initClient();
	}

	/**
	 * Initializes the MSAL client with the given configuration.
	 */
	initClient(): void {
		const config: Configuration = {
			auth: {
				clientId: this.clientId,
				authority: AUTHORITY,
				clientSecret: this.clientSecret,
			},
		};
		this.cca = new ConfidentialClientApplication(config);
	}

	/**
	 * Saves the current token cache to disk.
	 */
	saveTokenCache(): void {
		const tokenCacheSerialized = this.cca.getTokenCache().serialize();
		fs.writeFileSync(this.tokenFilePath, tokenCacheSerialized);
	}

	/**
	 * Performs an interactive login to acquire an access token.
	 * Opens a BrowserWindow to let the user sign in.
	 * @returns A promise that resolves with an object containing a valid access token.
	 */
	async getAccessToken(): Promise<{ accessToken: string }> {
		return new Promise((resolve, reject) => {
			const authUrl =
				`${AUTHORITY}/oauth2/v2.0/authorize?client_id=${this.clientId}` +
				`&response_type=code` +
				`&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
				`&response_mode=query` +
				`&scope=${encodeURIComponent(SCOPES.join(" "))}` +
				`&prompt=consent`;

			const authWindow = new BrowserWindow({
				width: 600,
				height: 700,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
				},
			});

			authWindow.loadURL(authUrl);

			authWindow.webContents.on("will-redirect", async (event, url) => {
				try {
					const redirectURL = new URL(url);
					const error = redirectURL.searchParams.get("error");
					if (error) throw new Error("OAuth error: " + error);

					const authCode = redirectURL.searchParams.get("code");
					if (!authCode) return; // If no auth code, exit early.

					event.preventDefault();
					authWindow.close();

					const tokenRequest = {
						code: authCode,
						scopes: SCOPES,
						redirectUri: REDIRECT_URI,
					};
					const tokenResponse = await this.cca.acquireTokenByCode(tokenRequest);
					if (!tokenResponse) throw new Error("No token response received.");
					this.saveTokenCache();
					resolve({ accessToken: tokenResponse.accessToken });
				} catch (err) {
					if (!authWindow.isDestroyed()) authWindow.close();
					reject(err);
				}
			});
		});
	}

	/**
	 * Refreshes the access token using the refresh token stored in the token cache.
	 * @returns A promise that resolves with an object containing a new access token.
	 */
	async refreshAccessTokenWithCCA(): Promise<{ accessToken: string }> {
		if (!fs.existsSync(this.tokenFilePath)) {
			throw new Error("No token cache found. Please login first.");
		}

		const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
		this.cca.getTokenCache().deserialize(cacheData);

		const tokenCacheSerialized = this.cca.getTokenCache().serialize();
		const parsedCache = JSON.parse(tokenCacheSerialized);
		if (!parsedCache.RefreshToken) {
			throw new Error("No refresh token found in the cache.");
		}
		const refreshTokenObject = parsedCache.RefreshToken;
		const refreshTokenKey = Object.keys(refreshTokenObject)[0];
		const refreshToken = refreshTokenObject[refreshTokenKey].secret;

		const tokenRequest = {
			refreshToken: refreshToken,
			scopes: SCOPES,
			redirectUri: REDIRECT_URI,
		};

		try {
			const tokenResponse = await this.cca.acquireTokenByRefreshToken(tokenRequest);
			if (!tokenResponse) throw new Error("No token response received from refresh.");
			this.saveTokenCache();
			return { accessToken: tokenResponse.accessToken };
		} catch (error) {
			throw error;
		}
	}

	/**
	 * Returns a valid access token by checking the token cache.
	 * If a token is available, it refreshes it; otherwise, it performs an interactive login.
	 * @returns A promise that resolves with an object containing a valid access token.
	 */
	async getToken(): Promise<{ accessToken: string }> {
		if (fs.existsSync(this.tokenFilePath)) {
			return this.refreshAccessTokenWithCCA();
		} else {
			return this.getAccessToken();
		}
	}
}

