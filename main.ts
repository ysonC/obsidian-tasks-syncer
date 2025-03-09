import { Plugin, Notice, requestUrl, TFile } from "obsidian";
import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { BrowserWindow } from "@electron/remote";
import { MyTodoSettingTab, DEFAULT_SETTINGS, MyTodoSettings } from "setting";
import * as path from "path";

// Define the cache directory and OAuth constants.
const CLIENT_ID: string = process.env.CLIENT_ID ?? "";
const CLIENT_SECRET: string = process.env.CLIENT_SECRET ?? "";
const AUTHORITY = "https://login.microsoftonline.com/consumers";
const REDIRECT_URI = "http://localhost:5000"; // Must match your Azure registration
const SCOPES = ["Tasks.ReadWrite", "offline_access"];

export default class TaskSyncerPlugin extends Plugin {
	settings: MyTodoSettings;
	tokenFilePath: string;
	cca: ConfidentialClientApplication;
	clientId: string;
	clientSecret: string;

	// Unified notification helper.
	private notify(message: string, type: "error" | "warning" | "success" | "info" = "info"): void {
		let prefix = "";
		switch (type) {
			case "error":
				prefix = "❌ ";
				break;
			case "warning":
				prefix = "⚠️ ";
				break;
			case "success":
				prefix = "✅ ";
				break;
			// For info we leave it as is.
		}
		new Notice(prefix + message);
	}

	// onload is called when the plugin is activated.
	async onload(): Promise<void> {
		// 0. Load environment variables from the plugin's .env file.
		const basePath = (this.app.vault.adapter as any).basePath;
		const pluginPath = path.join(basePath, ".obsidian/plugins/sync-obsidian-todo-plugin");
		dotenv.config({ path: path.join(pluginPath, ".env"), override: true });

		// 1. Load stored settings (or default settings if none exist).
		await this.loadSettings();

		// 2. Initialize core components (MSAL client, commands, etc.).
		this.initializePlugin();

		// 3. Set up the token cache.
		this.tokenFilePath = `${pluginPath}/token_cache.json`;
		if (fs.existsSync(this.tokenFilePath)) {
			const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
			this.cca.getTokenCache().deserialize(cacheData);
			console.log("Token cache loaded from file.");
		}

		// 4. Add the settings tab so the user can select a task list.
		this.addSettingTab(new MyTodoSettingTab(this.app, this));

		this.notify("Microsoft To-Do Plugin Loaded!", "info");

	}

	// Initializes the MSAL client and registers commands/ribbon icon.
	initializePlugin(): void {
		// console.log("Client ID:", CLIENT_ID);
		// console.log("Client Secret:", CLIENT_SECRET);

		// Initialize the MSAL client
		this.initClient().catch((err) => {
			console.error("Error initializing MSAL client:", err);
			this.notify("Error initializing MSAL client. Check the console for details.", "error");
		});

		// Register interactive login command.
		this.addCommand({
			id: "login-microsoft-todo",
			name: "Login to Microsoft To-Do (Interactive)",
			callback: async () => {
				try {
					await this.getAccessToken();
					new Notice("Logged in successfully!");
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

		// Register command to fetch task from selected list.
		this.addCommand({
			id: "get-tasks-from-selected-list",
			name: "Get Tasks from Selected List",
			callback: async () => {
				try {
					await this.getTasksFromSelectedList();
				} catch (error) {
					console.error("Error fetching tasks from selected list:", error);
					new Notice("❌ Failed to fetch tasks. Check the console for details.");
				}
			},
		});

		// Register command to sync task lists for the current note.
		this.addCommand({
			id: "sync-tasks-to-microsoft-todo",
			name: "Sync Tasks to Microsoft To-Do",
			callback: async () => {
				try {
					await this.syncTasksFromNote();
				} catch (error) {
					console.error("Error syncing tasks:", error);
					new Notice("❌ Failed to sync tasks. Check the console for details.");
				}
			},
		});

		// Testing new function command
		this.addCommand({
			id: "testing",
			name: "Testing",
			callback: async () => {
				try {
					console.log("Testing organizeTasks function");
					await this.gatherTasks();
				} catch (error) {
					console.error("Error testing:", error);
					new Notice("❌ Failed to test. Check the console for details.");
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

	// Initialize client pca
	async initClient(): Promise<void> {
		// Load and check the client ID and secret
		this.clientId = this.settings.clientId;
		this.clientSecret = this.settings.clientSecret;
		if (!this.clientId || !this.clientSecret) {
			throw new Error("Client ID and Client Secret are required.");
		}

		try {
			// Initialize the MSAL client
			const config: Configuration = {
				auth: {
					clientId: this.clientId,
					authority: AUTHORITY,
					clientSecret: this.clientSecret,
				},
			};
			this.cca = new ConfidentialClientApplication(config);
		} catch (error) {
			throw new Error("Error initializing MSAL client:" + error.message);
		}
	}

	// Loads plugin settings from the Obsidian vault.
	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	// Saves plugin settings to the Obsidian vault.
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// Ensures token cache is available
	async getToken(): Promise<{ accessToken: string }> {
		let tokenData;
		if (fs.existsSync(this.tokenFilePath)) {
			tokenData = await this.refreshAccessTokenWithPCA();
		} else {
			new Notice("No token cache found. Opening login window...");
			tokenData = await this.getAccessToken();
		}
		return tokenData;
	}

	// Saves the MSAL token cache to disk.
	private saveTokenCache(): void {
		const tokenCacheSerialized = this.cca.getTokenCache().serialize();
		fs.writeFileSync(this.tokenFilePath, tokenCacheSerialized);
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

			authWindow.webContents.on("will-redirect", async (event, url) => {
				console.log("Will redirect to:", url);
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
					// console.log("Token response:", tokenResponse);

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
			console.error("Error in acquireTokenByRefreshToken:", error);
			throw error;
		}
	}

	// Fetches available Microsoft To-Do task lists and stores them in settings.
	async loadAvailableTaskLists(): Promise<void> {
		try {
			// Refresh token (or acquire a new token) for Graph API call.
			const tokenData = await this.getToken();
			const accessToken = tokenData.accessToken;

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

	// Fetches task lists from Microsoft Graph using a refreshed access token.
	async getTaskLists(): Promise<void> {
		try {
			// Check if a token cache exists.
			const tokenData = await this.getToken();
			const accessToken = tokenData.accessToken;

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

			this.notify(listsText);
			console.log("Task Lists:", listsText);
		} catch (error) {
			console.error("Error fetching task lists:", error);
			this.notify("Error fetching task lists. Check the console for details.", "error");
		}
	}

	async getTasksFromSelectedList(): Promise<void> {
		// Ensure a task list is selected
		if (!this.settings.selectedTaskListId) {
			this.notify("No task list selected. Please choose one in settings.", "warning");
			return;
		}

		try {
			// Get a fresh access token
			const tokenData = await this.getToken();
			const accessToken = tokenData.accessToken;

			// Microsoft Graph API request for tasks in the selected list
			const response = await requestUrl({
				url: `https://graph.microsoft.com/v1.0/me/todo/lists/${this.settings.selectedTaskListId}/tasks`,
				method: "GET",
				headers: { "Authorization": `Bearer ${accessToken}` },
			});

			if (response.status !== 200) {
				throw new Error("Failed to fetch tasks: " + response.text);
			}

			// Parse and display tasks
			const data = response.json;
			const listName = this.settings.taskLists.find((l) => l.id === this.settings.selectedTaskListId)?.displayName;
			let tasksText = `Tasks: ${listName}\n`;
			if (data.value && data.value.length > 0) {
				for (const task of data.value) {
					tasksText += `- ${task.title} (Status: ${task.status})\n`;
				}
			} else {
				tasksText += "No tasks found.";
			}

			this.notify(tasksText);
			console.log("Fetched Tasks:", tasksText);
		} catch (error) {
			console.error("Error fetching tasks:", error);
			this.notify("Error fetching tasks. Check the console for details.", "error");
		}
	}

	// Synchronize task lists to setting.
	async syncTaskLists(): Promise<void> {
		try {
			// Fetch the latest task lists from Microsoft Graph
			await this.loadAvailableTaskLists();
			await this.saveSettings();
			this.notify("Task lists synchronized successfully!", "success");
		} catch (err) {
			console.error("Error syncing task lists:", err);
			this.notify("Failed to sync task lists. Check the console for details.", "error");
		}
	}

	async syncTasksFromNote(): Promise<void> {
		// Ensure a task list is selected
		if (!this.settings.selectedTaskListId) {
			this.notify("No task list selected. Please choose one in settings.", "warning");
			return;
		}

		// Get the current active note
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			this.notify("No active note found. Open a note with tasks.", "warning");
			return;
		}

		// Read the content of the note and extract tasks
		const fileContent = await this.app.vault.read(activeFile);
		const taskRegex = /^- \[ \] (.+)$/gm;
		const tasks: string[] = [];
		let match;
		while ((match = taskRegex.exec(fileContent)) !== null) {
			tasks.push(match[1].trim()); // Extract only the task text
		}
		if (tasks.length === 0) {
			this.notify("No tasks found in this note.", "info");
			return;
		}

		try {
			// Get a fresh access token
			const tokenData = await this.refreshAccessTokenWithPCA();
			const accessToken = tokenData.accessToken;

			// Add each task to Microsoft To-Do
			for (const task of tasks) {
				await this.createTaskInMicrosoftToDo(accessToken, task);
			}

			this.notify(`Synced ${tasks.length} tasks to Microsoft To-Do!`, "success");
			console.log("Synced Tasks:", tasks);
		} catch (error) {
			console.error("Error syncing tasks:", error);
			this.notify("Error syncing tasks. Check the console for details.", "error");
		}
	}

	// Create a task in Microsoft To-Do using the Graph API.
	async createTaskInMicrosoftToDo(accessToken: string, taskTitle: string): Promise<void> {
		const response = await requestUrl({
			url: `https://graph.microsoft.com/v1.0/me/todo/lists/${this.settings.selectedTaskListId}/tasks`,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				title: taskTitle,
			}),
		});

		if (response.status !== 201) {
			throw new Error(`Failed to create task: ${response.text}`);
		}

		console.log(`Task created: ${taskTitle}`);
	}

	async gatherTasks(): Promise<void> {
		const noteName = "Tasks List.md";
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const tasksMap = new Map<string, string>();

		// Regex to match both undone (- [ ]) and done (- [x]) tasks, allowing optional leading spaces.
		const taskRegex = /^\s*-\s*\[( |x)\]\s+(.*)$/gm;

		// Loop through every file in the vault.
		for (const file of markdownFiles) {
			const content = await this.app.vault.read(file);
			let match;
			while ((match = taskRegex.exec(content)) !== null) {
				// console.log("Match:", match);
				// match[1] is either " " (undone) or "x" (done)
				// match[2] is the task text
				const currentState = match[1] === "x" ? "[x]" : "[ ]";
				const taskText = match[2].trim();

				// If the task already exists and any occurrence is done, mark it as done.
				if (tasksMap.has(taskText)) {
					if (currentState === "[x]") {
						tasksMap.set(taskText, "[x]");
					}
				} else {
					tasksMap.set(taskText, currentState);
				}
			}
		}

		// Build the new consolidated content.
		const finalTasks = Array.from(tasksMap.entries()).map(
			([taskText, state]) => `- ${state} ${taskText}`
		);
		const newContent = finalTasks.join("\n");

		// Update or create the consolidated note.
		const targetFile = this.app.vault.getAbstractFileByPath(noteName);
		if (!targetFile) {
			await this.app.vault.create(noteName, newContent);
			this.notify("Tasks List created successfully!", "success");
		} else if (targetFile instanceof TFile) {
			await this.app.vault.modify(targetFile, newContent);
			this.notify("Tasks List updated successfully!", "success");
		} else {
			this.notify("Error: Tasks note is not a file.", "error");
		}
	}
}

