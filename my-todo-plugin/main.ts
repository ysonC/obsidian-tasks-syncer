import { Plugin, Notice, requestUrl } from "obsidian";
import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { BrowserWindow } from "@electron/remote";

// Load environment variables at the very top
dotenv.config();

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

		this.tokenFilePath = path.join("/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin", "token_cache.json");

		// If a token cache file exists, load it into MSAL's cache
		if (fs.existsSync(this.tokenFilePath)) {
			const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
			this.pca.getTokenCache().deserialize(cacheData);
			console.log("Token cache loaded from file.");
		}
		console.log("Current Token Cache:", this.pca.getTokenCache().serialize());
	}

	initializePlugin() {
		// Determine the plugin directory inside Obsidian's .obsidian/plugins/ folder
		this.pluginDir = path.join(this.app.vault.configDir, "plugins/my-todo-plugin");
		console.log("Plugin directory:", this.pluginDir);

		// Load development .env file (if exists)
		const devEnvPath = "/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin/.env";
		if (fs.existsSync(devEnvPath)) {
			dotenv.config({ path: devEnvPath });
			console.log("Loaded environment variables from:", devEnvPath);
		} else {
			console.warn("Environment file not found at:", devEnvPath);
		}

		console.log("Client ID:", CLIENT_ID);
		console.log("Client Secret:", CLIENT_SECRET);

		// Build the MSAL configuration
		const config: Configuration = {
			auth: {
				clientId: CLIENT_ID,
				authority: AUTHORITY,
				clientSecret: CLIENT_SECRET,
			},
		};
		console.log("MSAL Configuration:", config);

		// Initialize the ConfidentialClientApplication instance
		this.pca = new ConfidentialClientApplication(config);

		// Register interactive login command
		this.addCommand({
			id: "login-microsoft-todo",
			name: "Login to Microsoft To-Do (Interactive)",
			callback: async () => {
				try {
					const tokenData = await this.getAccessToken();
					new Notice("Logged in successfully!");
					console.log("Access Token:", tokenData.accessToken);
				} catch (error) {
					console.error("Authentication error:", error);
					new Notice("❌ Login failed! Check the console for details.");
				}
			},
		});

		// Register command to refresh token using MSAL's acquireTokenByRefreshToken
		this.addCommand({
			id: "refresh-microsoft-todo-token",
			name: "Refresh Microsoft To-Do Token",
			callback: async () => {
				try {
					const tokenData = await this.refreshAccessTokenWithPCA();
					new Notice("Token refreshed successfully!");
					console.log("New Access Token:", tokenData.accessToken);
				} catch (error) {
					console.error("Error refreshing token:", error);
					new Notice("❌ Token refresh failed! Check the console for details.");
				}
			},
		});

		// Register new command to get the task list
		this.addCommand({
			id: "get-microsoft-todo-task-lists",
			name: "Get Microsoft To-Do Task Lists",
			callback: async () => {
				try {
					await this.getTaskLists();
				} catch (error) {
					console.error("Error fetching task lists:", error);
					new Notice("❌ Failed to fetch task lists. Check the console for details.");
				}
			},
		});
		new Notice("Microsoft To-Do Plugin Loaded!");
	}

	/**
	 * Interactive login:
	 * - Opens a BrowserWindow for Microsoft login.
	 * - Exchanges the auth code for tokens.
	 * - Saves only the token cache (which includes the refresh token and account) to disk.
	 */
	async getAccessToken(): Promise<{ accessToken: string }> {
		return new Promise((resolve, reject) => {
			// Construct the authorization URL
			const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}`
				+ `&response_type=code`
				+ `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
				+ `&response_mode=query`
				+ `&scope=${encodeURIComponent(SCOPES.join(" "))}`
				+ `&prompt=consent`;

			console.log("Authorization URL:", authUrl);

			// Open a BrowserWindow for Microsoft login
			const authWindow = new BrowserWindow({
				width: 600,
				height: 700,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
				}
			});
			authWindow.loadURL(authUrl);
			console.log("Opened auth window with URL:", authUrl);

			// Listen for redirection to capture the auth code
			authWindow.webContents.on("will-redirect", async (event, url) => {
				console.log("Will redirect to:", url);
				try {
					const redirectURL = new URL(url);
					const authCode = redirectURL.searchParams.get('code');
					const error = redirectURL.searchParams.get('error');
					if (error) {
						throw new Error("OAuth error: " + error);
					}
					if (authCode) {
						console.log("Auth code received:", authCode);
						event.preventDefault();
						authWindow.close();

						// Exchange the auth code for tokens using MSAL
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

						// Instead of saving the full token response, we only save the serialized token cache.
						const tokenCacheSerialized = this.pca.getTokenCache().serialize();
						fs.writeFileSync(this.tokenFilePath, tokenCacheSerialized);
						console.log("Token cache saved to:", this.tokenFilePath);

						resolve({
							accessToken: tokenResponse.accessToken,
						});
					}
				} catch (err) {
					console.error("Error during token exchange:", err);
					if (!authWindow.isDestroyed()) authWindow.close();
					reject(err);
				}
			});
		});
	}

	/**
	 * Refreshes tokens using MSAL's acquireTokenByRefreshToken.
	 * It loads the token cache, extracts the refresh token, and uses it to obtain new tokens.
	 */
	async refreshAccessTokenWithPCA(): Promise<{ accessToken: string }> {
		// Ensure the token cache file exists
		if (!fs.existsSync(this.tokenFilePath)) {
			throw new Error("No token cache found. Please login first.");
		}
		// Deserialize the token cache into MSAL
		const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
		this.pca.getTokenCache().deserialize(cacheData);

		// Extract the refresh token from the token cache
		const tokenCacheSerialized = this.pca.getTokenCache().serialize();
		const parsedCache = JSON.parse(tokenCacheSerialized);
		if (!parsedCache.RefreshToken) {
			throw new Error("No refresh token found in the cache.");
		}
		const refreshTokenObject = parsedCache.RefreshToken;
		const refreshTokenKey = Object.keys(refreshTokenObject)[0];
		const refreshToken = refreshTokenObject[refreshTokenKey].secret;
		console.log("Extracted Refresh Token:", refreshToken);

		// Build the token request for refresh
		const tokenRequest = {
			refreshToken: refreshToken,
			scopes: SCOPES,
			redirectUri: REDIRECT_URI,
		};

		try {
			// Use MSAL's acquireTokenByRefreshToken method
			const tokenResponse = await this.pca.acquireTokenByRefreshToken(tokenRequest);
			if (!tokenResponse) {
				throw new Error("No token response received from refresh.");
			}
			console.log("Token response from refresh:", tokenResponse);

			// Save the updated token cache to file
			const updatedCache = this.pca.getTokenCache().serialize();
			fs.writeFileSync(this.tokenFilePath, updatedCache);
			console.log("Updated token cache saved to:", this.tokenFilePath);

			return {
				accessToken: tokenResponse.accessToken,
			};
		} catch (error) {
			console.error("Error in acquireTokenByRefreshToken:", error);
			throw error;
		}
	}
	/**
	 * Gets the user's Microsoft To-Do task lists.
	 * - Refreshes or acquires a valid access token.
	 * - Calls the Microsoft Graph API to fetch task lists.
	 * - Displays the task list names.
	 */
	async getTaskLists(): Promise<void> {
		try {
			// Refresh the access token using our refresh function
			const tokenData = await this.refreshAccessTokenWithPCA();
			const accessToken = tokenData.accessToken;
			console.log("Using Access Token:", accessToken);

			// Call Microsoft Graph to get the task lists
			const response = await requestUrl({
				url: "https://graph.microsoft.com/v1.0/me/todo/lists",
				method: "GET",
				headers: { "Authorization": `Bearer ${accessToken}` },
			});

			if (response.status !== 200) {
				throw new Error("Failed to fetch task lists: " + response.text);
			}

			const data = response.json;
			let listsText = "Your Microsoft To-Do Lists:\n";
			if (data.value && data.value.length > 0) {
				for (const list of data.value) {
					listsText += `- ${list.displayName}\n`;
				}
			} else {
				listsText += "No task lists found.";
			}

			new Notice(listsText);
			console.log("Task Lists:", listsText);
		} catch (error) {
			console.error("Error fetching task lists:", error);
			new Notice("Error fetching task lists. Check the console for details.");
		}
	}
}

