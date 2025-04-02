import { Plugin, Notice, TFile } from "obsidian";
import * as fs from "fs";
import * as dotenv from "dotenv";
import * as path from "path";
import {
	MyTodoSettingTab,
	DEFAULT_SETTINGS,
	MyTodoSettings,
} from "src/setting";
import { VIEW_TYPE_TODO_SIDEBAR, TaskSidebarView } from "src/plugin-view";
import { fetchTasks, createTask, updateTask, fetchTaskLists } from "src/api";
import { AuthManager } from "src/auth";
import { TaskTitleModal } from "src/task-title-modal";
import { TaskCompleteModal } from "src/task-complete-modal";

/**
 * Interface for the task cache.
 */
interface TaskCache {
	tasks: Array<[string, { title: string; status: string; id: string }]>;
	lastUpdated: number;
}

/**
 * Main plugin class for syncing tasks between Obsidian and Microsoft To‑Do.
 */
export default class TaskSyncerPlugin extends Plugin {
	settings: MyTodoSettings;
	tokenFilePath: string;
	authManager: AuthManager;
	taskCache: TaskCache | null = null;

	/**
	 * Displays a notification to the user.
	 * @param message - The message to display.
	 * @param type - The type of notification ("error", "warning", "success", "info").
	 */
	private notify(
		message: string,
		type: "error" | "warning" | "success" | "info" = "info",
	): void {
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

	/**
	 * Called when the plugin is activated.
	 * Loads environment variables, settings, registers views and commands, and initializes authentication.
	 */
	async onload(): Promise<void> {
		// 0. Load environment variables from the plugin's .env file.
		const basePath = (this.app.vault.adapter as any).basePath;
		const pluginPath = path.join(
			basePath,
			".obsidian/plugins/sync-obsidian-todo-plugin",
		);
		dotenv.config({ path: path.join(pluginPath, ".env"), override: true });

		// 1. Load stored settings (or default settings if none exist).
		await this.loadSettings();

		// 2. Add the settings tab.
		this.addSettingTab(new MyTodoSettingTab(this.app, this));

		// 3. Register the sidebar view.
		this.registerView(
			VIEW_TYPE_TODO_SIDEBAR,
			(leaf) => new TaskSidebarView(leaf, this),
		);

		// 4. Initialize core components (MSAL client, commands, etc.).
		this.initializeCommand();

		// 5. Initialize the MSAL client
		this.tokenFilePath = `${pluginPath}/token_cache.json`;
		this.authManager = new AuthManager(
			this.settings.clientId,
			this.settings.clientSecret,
			this.settings.redirectUrl,
			this.tokenFilePath,
		);

		// 6. Set up the token cache.
		if (fs.existsSync(this.tokenFilePath)) {
			const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
			this.authManager.cca.getTokenCache().deserialize(cacheData);
			console.log("Token cache loaded from file.");
		}

		// 7. Register styles
		// this.registerStyles(pluginPath);
		this.injectStyles();
		this.notify("Microsoft To-Do Plugin Loaded!", "info");
	}

	/**
	 * Initializes the MSAL client and registers commands/ribbon icons.
	 */
	initializeCommand(): void {
		// Register command to open the sidebar.
		this.addCommand({
			id: "open-microsoft-todo-sidebar",
			name: "Open Microsoft To-Do Sidebar",
			callback: async () => {
				this.activateSidebar();
			},
		});

		// Register interactive login command.
		this.addCommand({
			id: "login-microsoft-todo",
			name: "Login to Microsoft To-Do (Interactive)",
			callback: async () => {
				try {
					this.notify("Logging in...");
					await this.authManager.getAccessToken();
					this.notify("Logged in successfully!", "success");
				} catch (error) {
					console.error("Authentication error:", error);
					this.notify(
						"Error logining in! Check the console for details.",
						"error",
					);
				}
			},
		});

		// Register token refresh command.
		this.addCommand({
			id: "refresh-microsoft-todo-token",
			name: "Refresh Microsoft To-Do Token",
			callback: async () => {
				try {
					const tokenData =
						await this.authManager.refreshAccessTokenWithCCA();
					this.notify("Token refreshed successfully!", "success");
					console.log("New Access Token:", tokenData.accessToken);
				} catch (error) {
					console.error("Error refreshing token:", error);
					this.notify(
						"Error refreshing token. Check the console for details.",
						"error",
					);
				}
			},
		});

		// Register command to fetch task from selected list.
		this.addCommand({
			id: "get-tasks-from-selected-list",
			name: "Get Tasks from Selected List",
			callback: async () => {
				try {
					this.notify("Fetching tasks...");
					await this.getTasksFromSelectedList();
					this.notify("Tasks fetched successfully!", "success");
				} catch (error) {
					console.error(
						"Error fetching tasks from selected list:",
						error,
					);
					this.notify(
						"Error fetching tasks. Check the console for details.",
						"error",
					);
				}
			},
		});

		// Register command to sync task lists for the current note.
		this.addCommand({
			id: "push-all-tasks-from-note",
			name: "Push All Tasks from Note to Microsoft To-Do",
			callback: async () => {
				try {
					this.notify("Syncing tasks to Microsoft To-Do...");
					const tasksCount = await this.pushTasksFromNote();
					this.notify(
						`Tasks synced successfully! ${tasksCount} new tasks added.`,
						"success",
					);
					await this.refreshSidebarView();
				} catch (error) {
					console.error("Error pushing tasks:", error);
					this.notify(
						"Error pushing tasks. Check the console for details.",
						"error",
					);
				}
			},
		});

		this.addCommand({
			id: "push-one-task",
			name: "Create and push Task",
			callback: async () => {
				new TaskTitleModal(this.app, async (taskTitle: string) => {
					try {
						this.notify("Syncing tasks to Microsoft To-Do...");
						await this.pushOneTask(taskTitle);
						this.notify(`Tasks synced successfully!`, "success");
						await this.refreshSidebarView();
					} catch (error) {
						console.error("Error pushing tasks:", error);
						this.notify(
							"Error pushing tasks. Check the console for details.",
							"error",
						);
					}
				}).open();
			},
		});

		this.addCommand({
			id: "show-not-started-tasks",
			name: "Show Not Started Tasks List",
			callback: async () => {
				try {
					this.notify("Opening task list...");
					await this.openTaskCompleteModal();
				} catch (error) {
					console.error("Error completing task:", error);
					this.notify(
						"Error completing task. Check the console for details.",
						"error",
					);
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
					this.notify(
						"Error organizing tasks. Check the console for details.",
						"error",
					);
				}
			},
		});

		this.addCommand({
			id: "testing",
			name: "Testing",
			callback: async () => {
				try {
					console.log("Testing");
					await this.refreshTaskCache();
					this.taskCache = await this.loadData();
					console.log("Loaded data:", this.taskCache);
				} catch (error) {
					console.error("Error organizing tasks:", error);
				}
			},
		});
	}

	/**
	 * Injects custom CSS styles into the document.
	 */
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

	/**
	 * Activates the sidebar view.
	 */
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
	/**
	 * Loads plugin settings from the Obsidian vault.
	 */
	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	/**
	 * Saves plugin settings to the Obsidian vault.
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Fetches available Microsoft To-Do task lists and updates the plugin settings.
	 */
	async loadAvailableTaskLists(): Promise<void> {
		this.notify("Loading task lists...");
		try {
			const tokenData = await this.authManager.getToken();
			const accessToken = tokenData.accessToken;

			const listArray = await fetchTaskLists(accessToken);
			console.log("Fetched Task Lists:", listArray);

			this.settings.taskLists = listArray.map((list) => ({
				id: list.id,
				displayName: list.title,
			}));

			this.notify("Task lists loaded successfully!", "success");
		} catch (err) {
			console.error("Error loading task lists:", err);
			this.notify(
				"Error loading task lists. Check the console for details.",
				"error",
			);
		}
	}

	/**
	 * Fetches tasks from the selected Microsoft To‑Do list.
	 * @returns A map of task title to an object containing task details.
	 */
	async getTasksFromSelectedList(): Promise<
		Map<string, { title: string; status: string; id: string }>
	> {
		if (!this.settings.selectedTaskListId) {
			throw new Error(
				"No task list selected. Please choose one in settings.",
			);
		}

		try {
			const tokenData = await this.authManager.getToken();
			const accessToken = tokenData.accessToken;
			// fetchTasks already returns a Map<string, { title, status, id }>
			const tasks = await fetchTasks(this.settings, accessToken);
			console.log("Fetched Tasks:", tasks);
			return tasks;
		} catch (error) {
			console.error("Error fetching tasks:", error);
			throw error;
		}
	}

	/**
	 * Pushes tasks from the active note to Microsoft To‑Do.
	 * @returns The number of new tasks created.
	 */
	async pushTasksFromNote(): Promise<number> {
		// Ensure a task list is selected.
		if (!this.settings.selectedTaskListId) {
			throw new Error(
				"No task list selected. Please choose one in settings.",
			);
		}

		// Get the active note.
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			throw new Error("No active file found.");
		}

		// Read note content and extract tasks using a regex.
		const fileContent = await this.app.vault.read(activeFile);
		const taskRegex = /^-\s*\[( |x)\]\s+(.+)$/gm;
		const noteTasks: Array<{ title: string; complete: boolean }> = [];
		let match;
		while ((match = taskRegex.exec(fileContent)) !== null) {
			const complete = match[1] === "x";
			const title = match[2].trim();
			noteTasks.push({ title, complete });
		}
		if (noteTasks.length === 0) {
			throw new Error("No tasks found in the active note.");
		}

		try {
			// Get a fresh access token.
			const tokenData = await this.authManager.getToken();
			const accessToken = tokenData.accessToken;
			// Fetch existing tasks from Microsoft To‑Do via API.
			const existingTasks = await fetchTasks(this.settings, accessToken);
			let newTasksCount = 0;

			// Loop over each note task.
			for (const task of noteTasks) {
				const existingTask = existingTasks.get(task.title);
				if (existingTask) {
					// If the task exists and the note marks it as complete while its status is not complete, update it.
					if (task.complete && existingTask.status !== "completed") {
						await updateTask(
							this.settings,
							accessToken,
							existingTask.id,
							true,
						);
					} else {
						console.log(`Task already exists: ${task.title}`);
					}
					continue;
				}

				// If the task doesn't exist, create it with the appropriate status.
				const initialStatus = task.complete
					? "completed"
					: "notStarted";
				await createTask(
					this.settings,
					accessToken,
					task.title,
					initialStatus,
				);
				newTasksCount++;
			}
			console.log("Synced Tasks:", noteTasks);
			return newTasksCount;
		} catch (error) {
			console.error("Error syncing tasks:", error);
			throw error;
		}
	}

	/**
	 * Pushes a single task to selected list in Microsoft To‑Do.
	 * @param task - The task title text to push.
	 */
	async pushOneTask(task: string) {
		if (!this.settings.selectedTaskListId) {
			throw new Error(
				"No task list selected. Please choose one in settings.",
			);
		}

		try {
			const tokenData = await this.authManager.getToken();
			const accessToken = tokenData.accessToken;
			const existingTasks = await fetchTasks(this.settings, accessToken);
			const existingTask = existingTasks.get(task);

			if (existingTask) {
				console.log(`Task already exists: ${task}`);
			}

			await createTask(this.settings, accessToken, task);
			console.log("Synced Tasks:", task);
		} catch (error) {
			console.error("Error syncing tasks:", error);
			throw error;
		}
	}

	/**
	 * Gathers tasks from all markdown files in the vault and updates (or creates) a consolidated note.
	 * @returns A map of task text to its current state.
	 */
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
			([taskText, state]) => `- ${state} ${taskText}`,
		);
		const newContent = finalTasks.join("\n");

		// Update or create the consolidated note.
		const targetFile = this.app.vault.getAbstractFileByPath(noteName);
		if (!targetFile) {
			await this.app.vault.create(noteName, newContent);
		} else if (targetFile instanceof TFile) {
			await this.app.vault.modify(targetFile, newContent);
		} else {
			throw new Error("Unexpected file type for Tasks List");
		}

		return tasksMap;
	}

	async openTaskCompleteModal() {
		const tasksMap = await this.getTasksFromSelectedList();
		const notStartedTasks = Array.from(tasksMap.values()).filter(
			(task) => task.status !== "completed",
		);

		new TaskCompleteModal(
			this.app,
			notStartedTasks,
			async (task: { title: string; status: string; id: string }) => {
				const tokenData = await this.authManager.getToken();
				const accessToken = tokenData.accessToken;

				await updateTask(this.settings, accessToken, task.id, true);
				this.notify(
					`Task "${task.title}" marked as complete and synced.`,
					"success",
				);
				// Optionally refresh the sidebar view.
				await this.refreshSidebarView();
			},
		).open();
	}

	async refreshTaskCache(): Promise<
		Map<string, { title: string; status: string; id: string }>
	> {
		if (!this.settings.selectedTaskListId) {
			throw new Error(
				"No task list selected. Please choose one in settings.",
			);
		}

		try {
			const tokenData = await this.authManager.getToken();
			const accessToken = tokenData.accessToken;
			const tasks = await fetchTasks(this.settings, accessToken);
			console.log("Fetched Tasks:", tasks);

			// Load the current data (or initialize as an empty object if nothing exists)
			const currentData = (await this.loadData()) || {};

			// Update only the tasks section and add a timestamp
			currentData.tasks = Array.from(tasks.entries());
			currentData.lastUpdated = Date.now();

			// Save the updated data back without overwriting any other properties
			await this.saveData(currentData);

			// Optionally update your in-memory cache too
			this.taskCache = currentData;
			return tasks;
		} catch (error) {
			console.error("Error fetching tasks:", error);
			throw error;
		}
	}

	// TODO: Implement this method
	async refreshSidebarView() {}
}
