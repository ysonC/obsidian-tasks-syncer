import { Plugin, Notice, requestUrl } from "obsidian";
import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { BrowserWindow } from "@electron/remote";

// Load environment variables at the very top.
dotenv.config();

// Constants for OAuth flow
const CLIENT_ID: string = process.env.CLIENT_ID ?? "";
const CLIENT_SECRET: string = process.env.CLIENT_SECRET ?? "";
const AUTHORITY = "https://login.microsoftonline.com/consumers";
const REDIRECT_URI = "http://localhost:5000"; // Must match your Azure registration
const SCOPES = ["Tasks.ReadWrite", "offline_access"];

export default class MyTodoPlugin extends Plugin {
	private tokenFilePath: string;
	private pluginDir: string;
	private pca: ConfidentialClientApplication;

	// onload is called when the plugin is activated.
	async onload(): Promise<void> {
		this.initializePlugin();

		// Set the token file path (adjust as needed)
		this.tokenFilePath = path.join(
			"/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin",
			"token_cache.json"
		);

		// If a token cache file exists, load it into MSAL's token cache.
		if (fs.existsSync(this.tokenFilePath)) {
			const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
			this.pca.getTokenCache().deserialize(cacheData);
			console.log("Token cache loaded from file.");
		}
		console.log("Current Token Cache:", this.pca.getTokenCache().serialize());
	}

	// initializePlugin sets up directories, loads environment settings, builds the MSAL client, and registers commands.
	initializePlugin(): void {
		// Determine the plugin directory inside Obsidian's .obsidian/plugins/ folder.
		this.pluginDir = path.join(this.app.vault.configDir, "plugins/my-todo-plugin");
		console.log("Plugin directory:", this.pluginDir);

		// Load a development .env file if it exists.
		const devEnvPath = "/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin/.env";
		if (fs.existsSync(devEnvPath)) {
			dotenv.config({ path: devEnvPath });
			console.log("Loaded environment variables from:", devEnvPath);
		} else {
			console.warn("Environment file not found at:", devEnvPath);
		}

		console.log("Client ID:", CLIENT_ID);
		console.log("Client Secret:", CLIENT_SECRET);

		// Build the MSAL configuration.
		const config: Configuration = {
			auth: {
				clientId: CLIENT_ID,
				authority: AUTHORITY,
				clientSecret: CLIENT_SECRET,
			},
		};
		console.log("MSAL Configuration:", config);

		// Initialize the ConfidentialClientApplication instance.
		this.pca = new ConfidentialClientApplication(config);

		// Register the interactive login command.
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

		// Register the command to refresh token using MSAL's acquireTokenByRefreshToken.
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

		// Register the command to get the task lists.
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

	// Helper method to save the MSAL token cache to disk.
	private saveTokenCache(): void {
		const tokenCacheSerialized = this.pca.getTokenCache().serialize();
		fs.writeFileSync(this.tokenFilePath, tokenCacheSerialized);
		console.log("Token cache saved to:", this.tokenFilePath);
	}

	// Interactive login method:
	// - Opens a BrowserWindow to allow the user to log in.
	// - Exchanges the authorization code for tokens.
	// - Saves only the serialized token cache (which contains the refresh token and account info).
	async getAccessToken(): Promise<{ accessToken: string }> {
		return new Promise((resolve, reject) => {
			const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}` +
				`&response_type=code` +
				`&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
				`&response_mode=query` +
				`&scope=${encodeURIComponent(SCOPES.join(" "))}` +
				`&prompt=consent`;

			console.log("Authorization URL:", authUrl);

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

			authWindow.webContents.on("will-redirect", async (event, url) => {
				console.log("Will redirect to:", url);
				try {
					const redirectURL = new URL(url);
					const authCode = redirectURL.searchParams.get("code");
					const error = redirectURL.searchParams.get("error");
					if (error) {
						throw new Error("OAuth error: " + error);
					}
					if (authCode) {
						console.log("Auth code received:", authCode);
						event.preventDefault();
						authWindow.close();

						// Exchange the auth code for tokens.
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

						// Save the token cache (containing the refresh token & account info).
						this.saveTokenCache();
						resolve({ accessToken: tokenResponse.accessToken });
					}
				} catch (err) {
					console.error("Error during token exchange:", err);
					if (!authWindow.isDestroyed()) authWindow.close();
					reject(err);
				}
			});
		});
	}

	// Refresh tokens using MSAL's acquireTokenByRefreshToken.
	// Loads the token cache, extracts the refresh token, and uses it to obtain new tokens.
	async refreshAccessTokenWithPCA(): Promise<{ accessToken: string }> {
		if (!fs.existsSync(this.tokenFilePath)) {
			throw new Error("No token cache found. Please login first.");
		}

		const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
		this.pca.getTokenCache().deserialize(cacheData);

		// Extract the refresh token from the token cache.
		const tokenCacheSerialized = this.pca.getTokenCache().serialize();
		const parsedCache = JSON.parse(tokenCacheSerialized);
		if (!parsedCache.RefreshToken) {
			throw new Error("No refresh token found in the cache.");
		}
		const refreshTokenObject = parsedCache.RefreshToken;
		const refreshTokenKey = Object.keys(refreshTokenObject)[0];
		const refreshToken = refreshTokenObject[refreshTokenKey].secret;
		console.log("Extracted Refresh Token:", refreshToken);

		const tokenRequest = {
			refreshToken: refreshToken,
			scopes: SCOPES,
			redirectUri: REDIRECT_URI,
		};

		try {
			const tokenResponse = await this.pca.acquireTokenByRefreshToken(tokenRequest);
			if (!tokenResponse) {
				throw new Error("No token response received from refresh.");
			}
			console.log("Token response from refresh:", tokenResponse);
			// Save updated token cache.
			this.saveTokenCache();
			return { accessToken: tokenResponse.accessToken };
		} catch (error) {
			console.error("Error in acquireTokenByRefreshToken:", error);
			throw error;
		}
	}

	// Command to get Microsoft To-Do task lists.
	// Refreshes the access token and then calls the Microsoft Graph API.
	async getTaskLists(): Promise<void> {
		try {
			const tokenData = await this.refreshAccessTokenWithPCA();
			const accessToken = tokenData.accessToken;
			console.log("Using Access Token:", accessToken);

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

