import { Plugin, Notice, requestUrl, TFile } from "obsidian";
import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { BrowserWindow } from "@electron/remote";
import * as path from "path";
import { MyTodoSettingTab, DEFAULT_SETTINGS, MyTodoSettings } from "src/setting";
import { VIEW_TYPE_TODO_SIDEBAR, TaskSidebarView } from "src/plugin-view";

// Define the cache directory and OAuth constants.
const AUTHORITY = "https://login.microsoftonline.com/consumers";
const REDIRECT_URI = "http://localhost:5000"; // Must match your Azure registration
const SCOPES = ["Tasks.ReadWrite", "offline_access"];

export default class TaskSyncerPlugin extends Plugin {
	settings: MyTodoSettings;
	tokenFilePath: string;
	cca: ConfidentialClientApplication;
	clientId: string;
	clientSecret: string;
	redirectUrl: string;

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

		// 2. Add the settings tab.
		this.addSettingTab(new MyTodoSettingTab(this.app, this));

		// 3. Register the sidebar view.
		this.registerView(
			VIEW_TYPE_TODO_SIDEBAR,
			(leaf) => new TaskSidebarView(leaf, this));

		// 4. Initialize core components (MSAL client, commands, etc.).
		this.initializeCommand();

		// 5. Initialize the MSAL client
		this.initClient().catch((err) => {
			console.error("Error initializing MSAL client:", err);
			this.notify("Error initializing MSAL client. Check the console for details.", "error");
		});

		// 6. Set up the token cache.
		this.tokenFilePath = `${pluginPath}/token_cache.json`;
		if (fs.existsSync(this.tokenFilePath)) {
			const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
			this.cca.getTokenCache().deserialize(cacheData);
			console.log("Token cache loaded from file.");
		}

		// 7. Register styles
		// this.registerStyles(pluginPath);
		this.injectStyles();
		this.notify("Microsoft To-Do Plugin Loaded!", "info");
	}


	// Initializes the MSAL client and registers commands/ribbon icon.
	initializeCommand(): void {

		// Register command to open the sidebar.
		this.addCommand({
			id: "open-microsoft-todo-sidebar",
			name: "Open Microsoft To-Do Sidebar",
			callback: async () => {
				this.activateSidebar();
			}
		});

		// Register interactive login command.
		this.addCommand({
			id: "login-microsoft-todo",
			name: "Login to Microsoft To-Do (Interactive)",
			callback: async () => {
				try {
					await this.getAccessToken();
					this.notify("Logged in successfully!", "success");
				} catch (error) {
					console.error("Authentication error:", error);
					this.notify("Error logining in! Check the console for details.", "error");
				}
			},
		});

		// Register token refresh command.
		this.addCommand({
			id: "refresh-microsoft-todo-token",
			name: "Refresh Microsoft To-Do Token",
			callback: async () => {
				try {
					const tokenData = await this.refreshAccessTokenWithCCA();
					this.notify("Token refreshed successfully!", "success");
					console.log("New Access Token:", tokenData.accessToken);
				} catch (error) {
					console.error("Error refreshing token:", error);
					this.notify("Error refreshing token. Check the console for details.", "error");
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
					this.notify("Task lists fetched successfully!", "success");
				} catch (error) {
					console.error("Error fetching task lists:", error);
					this.notify("Error fetching task lists. Check the console for details.", "error");
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
					this.notify("Tasks fetched successfully!", "success");
				} catch (error) {
					console.error("Error fetching tasks from selected list:", error);
					this.notify("Error fetching tasks. Check the console for details.", "error");
				}
			},
		});

		// Register command to sync task lists for the current note.
		this.addCommand({
			id: "push-tasks-to-microsoft-todo",
			name: "Push Tasks to Microsoft To-Do",
			callback: async () => {
				try {
					await this.pushTasksFromNote();
					this.notify("Tasks pushed successfully!", "success");
					await this.refreshSidebarView();
				} catch (error) {
					console.error("Error pushing tasks:", error);
					this.notify("Error pushing tasks. Check the console for details.", "error");
				}
			},
		});

		// Register command to organize tasks from all notes into a single note.
		this.addCommand({
			id: "organize-tasks",
			name: "Organize Tasks from All Notes",
			callback: async () => {
				try {
					await this.gatherTasks();
					this.notify("Tasks organized successfully!", "success");
				} catch (error) {
					console.error("Error organizing tasks:", error);
					this.notify("Error organizing tasks. Check the console for details.", "error");
				}
			},
		});

		// Register command to sync Obisidan tasks and Microsoft To-Do.
		this.addCommand({
			id: "sync-obsidian-tasks",
			name: "Sync Obsidian Tasks with Microsoft To-Do",
			callback: async () => {
				try {
					// Update here
					await this.syncTasksBothWay();
				} catch (error) {
					console.error("Error syncing tasks:", error);
					this.notify("Error syncing tasks. Check the console for details.", "error");
				}
			},
		});

		// Add a ribbon icon that fetches task lists.
		this.addRibbonIcon("dice", "Get Microsoft To-Do Task Lists", async () => {
			try {
				await this.getTaskLists();
				this.notify("Task lists fetched successfully!", "success");
			} catch (error) {
				console.error("Error fetching task lists:", error);
				this.notify("Error fetching task lists. Check the console for details.");
			}
		});
	}

	injectStyles() {
		const style = document.createElement("style");
		style.textContent = `
		.task-line {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 2px 0;
		}

		.task-line input[type="checkbox"] {
			margin: 0;
			transform: scale(1.1);
		}

		.task-line span {
			font-size: 14px;
		}
	`;
		document.head.appendChild(style);
	}

	async activateSidebar() {
		const rightLeaf = this.app.workspace.getRightLeaf(false);
		if (!rightLeaf) {
			console.warn("No right leaf available.");
			return;
		}

		await rightLeaf.setViewState({
			type: VIEW_TYPE_TODO_SIDEBAR,
			active: true,
		});

		this.app.workspace.revealLeaf(rightLeaf);
	}

	// Initialize client pca
	async initClient(): Promise<void> {
		// Load and check the client ID and secret
		this.clientId = this.settings.clientId;
		this.clientSecret = this.settings.clientSecret;
		this.redirectUrl = this.settings.redirectUrl;
		if (!this.clientId || !this.clientSecret || !this.redirectUrl) {
			throw new Error("Client ID, Client ID, client secret, or redirect URL not set.");
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
			tokenData = await this.refreshAccessTokenWithCCA();
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
			console.error("Error in acquireTokenByRefreshToken:", error);
			throw error;
		}
	}

	// Fetches available Microsoft To-Do task lists and stores them in settings.
	async loadAvailableTaskLists(): Promise<void> {
		this.notify("Loading task lists...");
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
				this.notify("Task lists loaded successfully!", "success");
			} else {
				console.warn("No task lists found.");
			}
		} catch (err) {
			console.error("Error loading task lists:", err);
			this.notify("Error loading task lists. Check the console for details.", "error");
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
	async getTasksFromSelectedList(): Promise<Map<string, { title: string, status: string, id: string }>> {
		this.notify("Fetching tasks from selected list...");
		const msTasks = new Map<string, { title: string, status: string, id: string }>();
		// Ensure a task list is selected
		if (!this.settings.selectedTaskListId) {
			this.notify("No task list selected. Please choose one in settings.", "warning");
			return new Map();
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

			if (data.value && Array.isArray(data.value) && data.value.length > 0) {
				for (const task of data.value) {
					const title = task.title.trim();
					const status = task.status; // e.g., "completed" or "notStarted"
					tasksText += `- ${title} (Status: ${status})\n`;
					msTasks.set(title, { title, status, id: task.id });
				}
			} else {
				tasksText += "No tasks found.";
			}

			console.log("Fetched Tasks:", tasksText);
		} catch (error) {
			console.error("Error fetching tasks:", error);
			this.notify("Error fetching tasks. Check the console for details.", "error");
		}

		console.log("MS Tasks:", msTasks);
		return msTasks;
	}

	async pushTasksFromNote(): Promise<void> {
		this.notify("Syncing tasks to Microsoft To-Do...");
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
		const taskRegex = /^-\s*\[( |x)\]\s+(.+)$/gm;
		const noteTasks: Array<{ title: string, complete: boolean }> = [];
		let match;
		while ((match = taskRegex.exec(fileContent)) !== null) {
			const complete = match[1] === "x";
			const title = match[2].trim();
			noteTasks.push({ title, complete });
		}
		if (noteTasks.length === 0) {
			this.notify("No tasks found in this note.", "info");
			return;
		}

		try {
			// Get a fresh access token
			const tokenData = await this.refreshAccessTokenWithCCA();
			const accessToken = tokenData.accessToken;

			// Get the selected task list
			const existingTasks = await this.getTasksFromSelectedList();
			let newTasksCount = 0;

			// Add each task to Microsoft To-Do
			for (const task of noteTasks) {
				const existingTask = existingTasks.get(task.title);
				if (existingTask) {
					if (task.complete && existingTask.status === "notStarted") {
						await this.updateTaskInMicrosoftToDo(accessToken, existingTask.id, true);
					} else {
						console.log(`Task already exists: ${task}`);
					}
					continue;
				} 
				await this.createTaskInMicrosoftToDo(accessToken, task.title);
				newTasksCount++;
			}

			this.notify(`Synced ${newTasksCount} new tasks to Microsoft To-Do!`, "success");
			console.log("Synced Tasks:", noteTasks);
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

	async gatherTasks(): Promise<Map<string, string>> {
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

		return tasksMap;
	}

	async updateTaskInMicrosoftToDo(accessToken: string, taskId: string, complete: boolean): Promise<void> {
		const newStatus = complete ? "completed" : "notStarted";
		const response = await requestUrl({
			url: `https://graph.microsoft.com/v1.0/me/todo/lists/${this.settings.selectedTaskListId}/tasks/${taskId}`,
			method: "PATCH",
			headers: {
				"Authorization": `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				status: newStatus
			}),
		});
		if (response.status !== 200) {
			throw new Error(`Failed to update task: ${response.text}`);
		}
		console.log(`Task ${taskId} updated to status: ${newStatus}`);
	}
	async syncTasksBothWay(): Promise<void> {
		console.log("Syncing tasks both ways...");
		const localTasks = await this.gatherTasks();
		const msTasks = await this.getTasksFromSelectedList();
		console.log("Local Tasks:", localTasks);
		console.log("Microsoft Tasks:", msTasks);

	}

	// TODO: Implement this method
	async refreshSidebarView() {
	}
}

