import { Plugin, Notice, requestUrl } from "obsidian";
import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { BrowserWindow } from "@electron/remote";
import { MyTodoSettingTab, DEFAULT_SETTINGS, MyTodoSettings } from "setting";

// Load the development .env file with override enabled.
const devEnvPath = "/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin/.env";
dotenv.config({ path: devEnvPath, override: true });

// Define the cache directory and OAuth constants.
const cachePath = "/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin/";
const CLIENT_ID: string = process.env.CLIENT_ID ?? "";
const CLIENT_SECRET: string = process.env.CLIENT_SECRET ?? "";
const AUTHORITY = "https://login.microsoftonline.com/consumers";
const REDIRECT_URI = "http://localhost:5000"; // Must match your Azure registration
const SCOPES = ["Tasks.ReadWrite", "offline_access"];

export default class MyTodoPlugin extends Plugin {
	settings: MyTodoSettings;
	tokenFilePath: string;
	pca: ConfidentialClientApplication;

	// onload is called when the plugin is activated.
	async onload(): Promise<void> {
		// 1. Load stored settings (or default settings if none exist).
		await this.loadSettings();

		// 2. Initialize core components (MSAL client, commands, etc.).
		this.initializePlugin();

		// 3. Set up the token cache.
		this.tokenFilePath = `${cachePath}/token_cache.json`;
		if (fs.existsSync(this.tokenFilePath)) {
			const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
			this.pca.getTokenCache().deserialize(cacheData);
			console.log("Token cache loaded from file.");
		}
		console.log("Current Token Cache:", this.pca.getTokenCache().serialize());

		// 4. Load settings from storage
		await this.loadSettings();

		// 5. Add the settings tab so the user can select a task list.
		this.addSettingTab(new MyTodoSettingTab(this.app, this));

		new Notice("Microsoft To-Do Plugin Loaded!");
	}

	// Initializes the MSAL client and registers commands/ribbon icon.
	initializePlugin(): void {
		console.log("Client ID:", CLIENT_ID);
		console.log("Client Secret:", CLIENT_SECRET);

		const config: Configuration = {
			auth: {
				clientId: CLIENT_ID,
				authority: AUTHORITY,
				clientSecret: CLIENT_SECRET,
			},
		};
		this.pca = new ConfidentialClientApplication(config);
		console.log("MSAL Configuration:", config);

		// Register interactive login command.
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

		// Register token refresh command.
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

		// Register command to fetch task lists.
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

		// Add a ribbon icon that fetches task lists.
		this.addRibbonIcon("dice", "Get Microsoft To-Do Task Lists", async () => {
			try {
				await this.getTaskLists();
				new Notice("Task lists fetched successfully!");
			} catch (error) {
				console.error("Error fetching task lists:", error);
				new Notice("❌ Failed to fetch task lists. Check the console for details.");
			}
		});
	}

	// Loads plugin settings from the Obsidian vault.
	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	// Saves plugin settings to the Obsidian vault.
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// Fetches available Microsoft To-Do task lists and stores them in settings.
	async loadAvailableTaskLists(): Promise<void> {
		try {
			// Refresh token (or acquire a new token) for Graph API call.
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
			if (data.value && Array.isArray(data.value)) {
				this.settings.taskLists = data.value.map((list: any) => ({
					id: list.id,
					displayName: list.displayName,
				}));
				console.log("Fetched Task Lists:", this.settings.taskLists);
			} else {
				console.warn("No task lists found.");
			}
		} catch (err) {
			console.error("Error loading task lists:", err);
		}
	}

	// Saves the MSAL token cache to disk.
	private saveTokenCache(): void {
		const tokenCacheSerialized = this.pca.getTokenCache().serialize();
		fs.writeFileSync(this.tokenFilePath, tokenCacheSerialized);
		console.log("Token cache saved to:", this.tokenFilePath);
	}

	// Interactive login: Opens a BrowserWindow to let the user log in, exchanges the auth code for tokens,
	// and saves the token cache.
	async getAccessToken(): Promise<{ accessToken: string }> {
		return new Promise((resolve, reject) => {
			const authUrl =
				`${AUTHORITY}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}` +
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
				},
			});

			// Optionally clear cookies before loading the URL.
			// authWindow.webContents.session.clearStorageData({ storages: ["cookies"] })
			//   .then(() => authWindow.loadURL(authUrl))
			//   .catch(err => {
			//     console.error("Error clearing cookies:", err);
			//     authWindow.loadURL(authUrl);
			//   });

			authWindow.loadURL(authUrl);
			console.log("Opened auth window with URL:", authUrl);

			authWindow.webContents.on("will-redirect", async (event, url) => {
				console.log("Will redirect to:", url);
				try {
					const redirectURL = new URL(url);
					const error = redirectURL.searchParams.get("error");
					if (error) throw new Error("OAuth error: " + error);

					const authCode = redirectURL.searchParams.get("code");
					if (!authCode) return; // If no auth code, exit early.

					console.log("Auth code received:", authCode);
					event.preventDefault();
					authWindow.close();

					const tokenRequest = {
						code: authCode,
						scopes: SCOPES,
						redirectUri: REDIRECT_URI,
					};
					const tokenResponse = await this.pca.acquireTokenByCode(tokenRequest);
					if (!tokenResponse) throw new Error("No token response received.");
					console.log("Token response:", tokenResponse);

					this.saveTokenCache();
					resolve({ accessToken: tokenResponse.accessToken });
				} catch (err) {
					console.error("Error during token exchange:", err);
					if (!authWindow.isDestroyed()) authWindow.close();
					reject(err);
				}
			});
		});
	}

	// Refresh tokens by loading the token cache, extracting the refresh token, and calling acquireTokenByRefreshToken.
	async refreshAccessTokenWithPCA(): Promise<{ accessToken: string }> {
		if (!fs.existsSync(this.tokenFilePath)) {
			throw new Error("No token cache found. Please login first.");
		}

		const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
		this.pca.getTokenCache().deserialize(cacheData);

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
			if (!tokenResponse) throw new Error("No token response received from refresh.");
			console.log("Token response from refresh:", tokenResponse);
			this.saveTokenCache();
			return { accessToken: tokenResponse.accessToken };
		} catch (error) {
			console.error("Error in acquireTokenByRefreshToken:", error);
			throw error;
		}
	}

	// Fetches task lists from Microsoft Graph using a refreshed access token.
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

	// Synchronize task lists to setting
	async syncTaskLists(): Promise<void> {
		try {
			// Fetch the latest task lists from Microsoft Graph
			await this.loadAvailableTaskLists();
			await this.saveSettings();
			new Notice("Task lists synchronized successfully!");
		} catch (err) {
			console.error("Error syncing task lists:", err);
			new Notice("Failed to sync task lists. Check the console for details.");
		}
	}
}

