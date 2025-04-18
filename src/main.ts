import { Plugin, TFile } from "obsidian";
import * as fs from "fs";
import * as dotenv from "dotenv";
import * as path from "path";
import { MyTodoSettingTab, DEFAULT_SETTINGS, MyTodoSettings } from "./setting";
import { VIEW_TYPE_TODO_SIDEBAR, TaskSidebarView } from "./right-sidebar-view";
import {
	fetchTasks,
	createTask,
	updateTask,
	fetchTaskLists,
	deleteTask,
} from "./api";
import { AuthManager } from "./auth";
import { TaskTitleModal } from "./task-title-modal";
import { GenericSelectModal } from "./select-modal";
import { notify } from "./utils";
import { TaskCache, TaskInputResult, TaskItem, TaskList } from "./types";

/**
 * Main plugin class for syncing tasks between Obsidian and Microsoft To‑Do.
 */
export default class TaskSyncerPlugin extends Plugin {
	settings: MyTodoSettings;
	sidebarView: TaskSidebarView | null = null;
	tokenFilePath: string;
	authManager: AuthManager;
	taskCache: TaskCache | null = null;

	/**
	 * Called when the plugin is activated.
	 * Loads environment variables, settings, registers views and commands, and initializes authentication.
	 */
	async onload(): Promise<void> {
		// 0. Load environment variables from the plugin's .env file.
		const basePath = (this.app.vault.adapter as any).basePath;
		const pluginPath = path.join(
			basePath,
			".obsidian/plugins/obsidian-tasks-syncer",
		);
		dotenv.config({ path: path.join(pluginPath, ".env"), override: true });

		// 1. Load stored settings (or default settings if none exist).
		await this.loadSettings();

		// 2. Add the settings tab.
		this.addSettingTab(new MyTodoSettingTab(this.app, this));

		// 3. Register the sidebar view.
		this.registerView(VIEW_TYPE_TODO_SIDEBAR, (leaf) => {
			const view = new TaskSidebarView(leaf, this);
			this.sidebarView = view;
			return view;
		});

		// 4. Initialize core components (MSAL client, commands, etc.).
		this.initializeCommand();

		// 5. Initialize the MSAL client
		this.tokenFilePath = `${pluginPath}/token_cache.json`;
		if (this.settings.clientId && this.settings.clientSecret) {
			this.authManager = new AuthManager(
				this.settings.clientId,
				this.settings.clientSecret,
				this.settings.redirectUrl,
				this.tokenFilePath,
			);
		}

		// 6. Set up the token cache.
		if (fs.existsSync(this.tokenFilePath)) {
			const cacheData = fs.readFileSync(this.tokenFilePath, "utf8");
			this.authManager.cca.getTokenCache().deserialize(cacheData);
			console.log("Token cache loaded from file.");
		}
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
					notify("Logging in...");
					await this.authManager.getAccessToken();
					notify("Logged in successfully!", "success");
				} catch (error) {
					console.error("Authentication error:", error);
					notify(
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
					notify("Token refreshed successfully!", "success");
					console.log("New Access Token:", tokenData.accessToken);
				} catch (error) {
					console.error("Error refreshing token:", error);
					notify(
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
					notify("Fetching tasks...");
					await this.getTasksFromSelectedList();
					notify("Tasks fetched successfully!", "success");
				} catch (error) {
					console.error(
						"Error fetching tasks from selected list:",
						error,
					);
					notify(
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
					notify("Syncing tasks to Microsoft To-Do...");
					const tasksCount = await this.pushTasksFromNote();
					notify(
						`Tasks synced successfully! ${tasksCount} new tasks added.`,
						"success",
					);
					await this.refreshViewAndCache();
				} catch (error) {
					console.error("Error pushing tasks:", error);
					notify(
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
				try {
					await this.openPushTaskModal();
				} catch (error) {
					console.error("Error opening push task modal: ", error);
					notify(
						"Error opening push task modal. Check the console for details.",
						"error",
					);
				}
			},
		});

		this.addCommand({
			id: "show-not-started-tasks",
			name: "Show Tasks List",
			callback: async () => {
				try {
					await this.openTaskCompleteModal();
				} catch (error) {
					console.error("Error completing task:", error);
					notify(
						"Error completing task. Check the console for details.",
						"error",
					);
				}
			},
		});

		this.addCommand({
			id: "select-task-list",
			name: "Select Task List",
			callback: async () => {
				try {
					await this.openTaskListsModal();
				} catch (error) {
					console.error("Error selecting task list:", error);
					notify(
						"Error selecting task list. Check the console for details.",
						"error",
					);
				}
			},
		});

		this.addCommand({
			id: "organize-tasks",
			name: "Organize Tasks from All Notes",
			callback: async () => {
				try {
					await this.gatherTasks();
					notify("Tasks organized successfully!", "success");
				} catch (error) {
					console.error("Error organizing tasks:", error);
					notify(
						"Error organizing tasks. Check the console for details.",
						"error",
					);
				}
			},
		});

		this.addCommand({
			id: "delete-completed-tasks",
			name: "Delete Completed Tasks",
			callback: async () => {
				try {
					notify("Deleting completed tasks...");
					const deletedCount = await this.deleteAllCompletedTasks();
					notify(
						`${deletedCount} completed tasks deleted successfully!`,
						"success",
					);
				} catch (error) {
					console.error("Error deleting completed tasks:", error);
					notify(
						"Error deleting tasks. Check the console for details.",
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
					console.log("Testing update time zone");
					notify("Testing...", "success");
				} catch (error) {
					console.error("Error testing:", error);
				}
			},
		});
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

	async getAccessToken(): Promise<string> {
		try {
			const tokenData = await this.authManager.getToken();
			return tokenData.accessToken;
		} catch (error) {
			console.error("Error fetching access token:", error);
			throw error;
		}
	}

	/**
	 * Fetches available Microsoft To-Do task lists and updates the plugin settings.
	 */
	async loadAvailableTaskLists(): Promise<void> {
		notify("Loading task lists...");
		try {
			const accessToken = await this.getAccessToken();
			const listArray = await fetchTaskLists(accessToken);
			console.log("Fetched Task Lists:", listArray);

			this.settings.taskLists = listArray.map((list) => ({
				id: list.id,
				title: list.title,
			}));

			notify("Task lists loaded successfully!", "success");
		} catch (err) {
			console.error("Error loading task lists:", err);
			notify(
				"Error loading task lists. Check the console for details.",
				"error",
			);
		}
	}

	/**
	 * Get task lists using access token with fetchTaskLists api function.
	 * @returns A TaskList interface with fetched task lists.
	 * */
	async getTaskLists(): Promise<TaskList[]> {
		try {
			const accessToken = await this.getAccessToken();
			const taskLists = await fetchTaskLists(accessToken);
			return taskLists;
		} catch (error) {
			console.error("Error fetching task lists:", error);
			throw error;
		}
	}

	/**
	 * Fetches tasks from the selected Microsoft To‑Do list.
	 * @returns A map of task title to an object containing task details.
	 */
	async getTasksFromSelectedList(): Promise<Map<string, TaskItem>> {
		if (!this.settings.selectedTaskListId) {
			throw new Error(
				"No task list selected. Please choose one in settings.",
			);
		}

		if (this.taskCache && this.taskCache.tasks) {
			console.log("Using cached tasks:", this.taskCache.tasks);
			return new Map(this.taskCache.tasks);
		}
		try {
			console.log("No cached tasks found, refreshing task cache.");
			return await this.refreshTaskCache();
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
			const accessToken = await this.getAccessToken();
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
							undefined,
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
	async pushOneTask(task: string, dueDate?: string) {
		if (!this.settings.selectedTaskListId) {
			throw new Error(
				"No task list selected. Please choose one in settings.",
			);
		}

		try {
			const accessToken = await this.getAccessToken();
			const existingTasks = await fetchTasks(this.settings, accessToken);
			const existingTask = existingTasks.get(task);

			if (existingTask) {
				console.log(`Task already exists: ${task}`);
			}

			await createTask(this.settings, accessToken, task, dueDate);
			await this.refreshViewAndCache();
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

	/**
	 * Open an interactive window to create task and push it.
	 */
	async openPushTaskModal() {
		new TaskTitleModal(this.app, async (result: TaskInputResult) => {
			try {
				notify("Pushing tasks to Microsoft To-Do...");
				await this.pushOneTask(result.title, result.dueDate);
				notify(`Tasks pushed successfully!`, "success");
			} catch (error) {
				console.error("Error pushing tasks:", error);
				notify(
					"Error pushing tasks. Check the console for details.",
					"error",
				);
			}
		}).open();
	}

	/**
	 * Open a interactive window for the user to interact and select a target task list.
	 */
	async openTaskListsModal() {
		const tasksLists = this.settings.taskLists;

		console.log("Task Lists:", tasksLists);
		new GenericSelectModal<TaskList>(
			this.app,
			tasksLists,
			(taskList) => taskList.title,
			async (taskList: TaskList) => {
				this.settings.selectedTaskListId = taskList.id;
				this.settings.selectedTaskListTitle = taskList.title;
				await this.saveSettings();
				await this.refreshViewAndCache();
			},
		).open();
	}

	/**
	 * Open a interactive window for the user to interact and select to complete task items.
	 */
	async openTaskCompleteModal() {
		const tasksMap = await this.getTasksFromSelectedList();
		const notStartedTasks = Array.from(tasksMap.values()).filter(
			(task) => task.status !== "completed",
		);

		new GenericSelectModal<TaskItem>(
			this.app,
			notStartedTasks,
			(task) => (task.status !== "completed" ? task.title : ""),
			async (task: { title: string; status: string; id: string }) => {
				notify(`Marking "${task.title}" as complete...`);
				const accessToken = await this.getAccessToken();
				await updateTask(
					this.settings,
					accessToken,
					task.id,
					undefined,
					true,
				);
				notify(
					`Task "${task.title}" marked as complete and synced.`,
					"success",
				);

				await this.refreshViewAndCache();
			},
		).open();
	}

	async getTaskFromCache(): Promise<Map<string, TaskItem>> {
		const currentData = (await this.loadData()) || {};
		const tasksArray = currentData.tasks;
		if (!tasksArray) {
			throw new Error("No task found.");
		}
		const tasks = new Map<string, TaskItem>(tasksArray);
		return tasks;
	}

	/**
	 * Fetch task using api function and store in the cache for quick access.
	 */
	async refreshTaskCache(): Promise<Map<string, TaskItem>> {
		if (!this.settings.selectedTaskListId) {
			throw new Error(
				"No task list selected. Please choose one in settings.",
			);
		}

		try {
			const accessToken = await this.getAccessToken();
			const tasks = await fetchTasks(this.settings, accessToken);

			this.taskCache = { tasks: Array.from(tasks.entries()) };

			console.log("Refresh task cache", tasks);
			return tasks;
		} catch (error) {
			console.error("Error fetching tasks:", error);
			throw error;
		}
	}

	/**
	 * Use the deleteTask api function to delete all completed task in the targeted task list.
	 * @returns Amount of deleted tasks.
	 */
	async deleteAllCompletedTasks(): Promise<number> {
		if (!this.settings.selectedTaskListId) {
			throw new Error(
				"No task list selected. Please choose one in settings.",
			);
		}

		let deletedTasksCount = 0;
		try {
			const accessToken = await this.getAccessToken();
			const tasks = await this.getTasksFromSelectedList();
			const completedTasks = Array.from(tasks.values()).filter(
				(task) => task.status === "completed",
			);

			for (const task of completedTasks) {
				console.log("Deleting Task:", task);
				await deleteTask(this.settings, accessToken, task.id);
				deletedTasksCount++;
			}

			this.refreshViewAndCache();
			return deletedTasksCount;
		} catch (error) {
			console.error("Error deleting tasks:", error);
			return deletedTasksCount;
		}
	}

	/**
	 * Refreshes the sidebar view and task cache to display the latest tasks.
	 */
	async refreshViewAndCache() {
		await this.refreshTaskCache();
		if (this.sidebarView) {
			await this.sidebarView.render();
		} else {
			console.warn("Sidebar view is not active.");
		}
	}
}
