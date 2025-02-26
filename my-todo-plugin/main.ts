import { Plugin, Notice, requestUrl } from "obsidian";
import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { BrowserWindow } from "@electron/remote"; // Use @electron/remote for BrowserWindow


// Constants for OAuth flow
const CLIENT_ID: string = process.env.CLIENT_ID ?? "";
const CLIENT_SECRET: string = process.env.CLIENT_SECRET ?? "";
const AUTHORITY = "https://login.microsoftonline.com/consumers";
const REDIRECT_URI = "http://localhost:5000"; // Must match your Azure registration
const SCOPES = ["Tasks.ReadWrite", "offline_access"];
const TOKEN_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

export default class MyTodoPlugin extends Plugin {
	private tokenFilePath: string;
	private pluginDir: string;
	private pca: ConfidentialClientApplication;

	async onload() {
		this.initializePlugin();

		// Temporary path for the token file
		this.tokenFilePath = path.join("/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin", "auth_token.json");
		if (fs.existsSync(this.tokenFilePath)) {
			const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
			this.pca.getTokenCache().deserialize(cacheData);
			console.log("Token cache loaded from file.");
		}
		console.log("Cache Data: ", this.pca.getTokenCache());

	}

	initializePlugin() {
		// Determine the plugin directory inside Obsidian's .obsidian/plugins/ folder
		this.pluginDir = path.join(this.app.vault.configDir, "plugins/my-todo-plugin");
		console.log("Plugin directory: ", this.pluginDir);

		// Define the development path for .env
		const devEnvPath = "/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin/.env";
		if (fs.existsSync(devEnvPath)) {
			dotenv.config({ path: devEnvPath });
			console.log("Loaded environment variables from:", devEnvPath);
		} else {
			console.warn("Environment file not found at:", devEnvPath);
		}

		console.log("Client ID: ", CLIENT_ID);
		console.log("Client Secret: ", CLIENT_SECRET);

		const config: Configuration = {
			auth: {
				clientId: CLIENT_ID,
				authority: AUTHORITY,
				clientSecret: CLIENT_SECRET,
			},
		};

		console.log("MSAL Configuration: ", config);

		// Initialize the ConfidentialClientApplication instance
		this.pca = new ConfidentialClientApplication(config);

		// Register a command to trigger interactive login (to get new tokens)
		this.addCommand({
			id: "login-microsoft-todo",
			name: "Login to Microsoft To-Do (Interactive)",
			callback: async () => {
				try {
					const tokenData = await this.getAccessToken();
					new Notice("Logged in successfully!");
					console.log("Access Token: ", tokenData.accessToken);
				} catch (error) {
					console.error("Authentication error:", error);
					new Notice("❌ Login failed! Check the console for details.");
				}
			},
		});

		this.addCommand({
			id: "acquire-microsoft-todo-token-silent",
			name: "Acquire Microsoft To-Do Token Silently",
			callback: async () => {
				try {
					const tokenData = await this.refreshAccessTokenWithPCA();
					new Notice("Token acquired silently!");
					console.log("Silent Access Token: ", tokenData.accessToken);
				} catch (error) {
					console.error("Error acquiring token silently:", error);
					new Notice("❌ Silent token acquisition failed. Try interactive login.");
				}
			},
		});
		new Notice("Microsoft To-Do Plugin Loaded!");
	}

	/**
	 * Initiates an interactive login flow and exchanges the auth code for tokens.
	 */
	async getAccessToken(): Promise<{ accessToken: string, refreshToken: string, expiresIn: number }> {
		return new Promise((resolve, reject) => {
			// 1. Construct the authorization URL.
			const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}`
				+ `&response_type=code`
				+ `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
				+ `&response_mode=query`
				+ `&scope=${encodeURIComponent(SCOPES.join(" "))}`
				+ `&prompt=consent`;

			console.log("Authorization URL:", authUrl);
			// 2. Open a BrowserWindow for Microsoft login.
			const authWindow = new BrowserWindow({
				width: 600,
				height: 700,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
				}
			});

			// Clear cookies and storage before loading the URL:
			//authWindow.webContents.session.clearStorageData({
			//	storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers'],
			//});

			authWindow.loadURL(authUrl);
			console.log("Opened auth window with URL:", authUrl);

			// 3. Listen for redirection (when Microsoft returns the auth code).
			authWindow.webContents.on("will-redirect", async (event, url) => {
				console.log("Will redirect to:", url);
				try {
					const redirectURL = new URL(url);
					const authCode = redirectURL.searchParams.get('code');
					console.log(authCode);
					const error = redirectURL.searchParams.get('error');
					if (error) {
						throw new Error("OAuth error: " + error);
					}
					if (authCode) {
						console.log("Auth code received:", authCode);
						// Prevent further navigation and close the window.
						event.preventDefault();
						authWindow.close();

						// 4. Exchange the auth code for tokens using MSAL.
						const tokenRequest = {
							code: authCode,
							scopes: SCOPES,
							redirectUri: REDIRECT_URI,
						};

						const tokenResponse = await this.pca.acquireTokenByCode(tokenRequest);

						if (!tokenResponse) {
							throw new Error("No token response received.");
						}
						console.log("Token response:", tokenResponse);
						// 5. Save the token data to a file.
						fs.writeFileSync(this.tokenFilePath, JSON.stringify(tokenResponse, null, 2));
						console.log("Token data saved to:", this.tokenFilePath);
						console.log("Cache Data: ", this.pca.getTokenCache());

						
						const tokenCache = this.pca.getTokenCache().serialize();
						const refreshTokenObject = (JSON.parse(tokenCache)).RefreshToken
						const refreshToken = refreshTokenObject[Object.keys(refreshTokenObject)[0]].secret;
						console.log("Extracted Refresh Token:", refreshToken);
						// Use MSAL's acquireTokenByRefreshToken method to get new tokens.
						const tmpHolder = {
							refreshToken: refreshToken,
							scopes: SCOPES,
						};
						const tmp = await this.pca.acquireTokenByRefreshToken(tmpHolder);
						if (!tmp) {
							throw new Error("No token response received.");
						}
						console.log("Token response from refresh:", tmp);
					}
				} catch (err) {
					console.error("Error during token exchange:", err);
					if (!authWindow.isDestroyed()) authWindow.close();
					reject(err);
				}
			});
		});

	}

	async getRefreshToken(): Promise<{ accessToken: string, refreshToken: string, expiresIn: number }> {
		// Ensure a token file exists
		if (!fs.existsSync(this.tokenFilePath)) {
			throw new Error("No token file found. Please login first.");
		}
		const tokenData = JSON.parse(fs.readFileSync(this.tokenFilePath, "utf8"));
		if (!tokenData.account) {
			throw new Error("No account found in token file. Please login again.");
		}
		const account = tokenData.account;

		try {
			// Create a silent request using the cached account and desired scopes.
			const silentRequest = {
				account: account,
				scopes: SCOPES,
				// Optional: forceRefresh: true,
			};
			// Attempt to acquire a token silently.
			const tokenResponse = await this.pca.acquireTokenSilent(silentRequest);
			console.log("Silent token acquisition successful:", tokenResponse);
			// Update the token file with the new token data.
			fs.writeFileSync(this.tokenFilePath, JSON.stringify(tokenResponse, null, 2));
			return {
				accessToken: tokenResponse.accessToken,
				refreshToken: tokenResponse.refreshToken,
				expiresIn: tokenResponse.expiresIn,
			};
		} catch (err) {
			console.error("Silent token acquisition failed:", err);
			// Fallback to interactive login if silent acquisition fails.
			return this.getAccessToken();
		}
	}
	async refreshAccessTokenWithPCA(): Promise<{ accessToken: string, refreshToken: string, expiresIn: number }> {
		// After you acquire the token via acquireTokenByCode:
		const tokenResponse = JSON.parse(fs.readFileSync(this.tokenFilePath, "utf8"));
		if (!tokenResponse) {
			throw new Error("No token response received.");
		}

		const tokenCache = this.pca.getTokenCache().serialize();
		const refreshTokenObject = (JSON.parse(tokenCache)).RefreshToken
		const refreshToken = refreshTokenObject[Object.keys(refreshTokenObject)[0]].secret;

		console.log("Extracted Refresh Token:", refreshToken);

		// Build the token request using the refresh token
		const tokenRequest = {
			refreshToken: refreshToken,
			scopes: SCOPES,
			redirectUri: REDIRECT_URI,
		};

		try {
			// Use MSAL's acquireTokenByRefreshToken method to get new tokens.
			const tokenResponse = await this.pca.acquireTokenByRefreshToken(tokenRequest);
			if (!tokenResponse) {
				throw new Error("No token response received.");
			}
			console.log("Token response from refresh:", tokenResponse);

			// Save the updated token data to the file.
			fs.writeFileSync(this.tokenFilePath, JSON.stringify(tokenResponse, null, 2));
			console.log("Updated token data saved to:", this.tokenFilePath);

			return {
				accessToken: tokenResponse.accessToken,
				refreshToken: tokenResponse.refreshToken,
				expiresIn: tokenResponse.expiresIn,
			};
		} catch (error) {
			console.error("Error in acquireTokenByRefreshToken:", error);
			throw error;
		}
	}

}
