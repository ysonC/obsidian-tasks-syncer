import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import type TaskSyncerPlugin from "src/main";
import { notify } from "./utils";
import { updateTask } from "./api";
import { TaskItem } from "./types";

export const VIEW_TYPE_TODO_SIDEBAR = "tasks-syncer-sidebar";

export class TaskSidebarView extends ItemView {
	plugin: TaskSyncerPlugin;
	contentContainer: Element;
	taskContainer: Element;
	navContainer: Element;

	constructor(leaf: WorkspaceLeaf, plugin: TaskSyncerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TODO_SIDEBAR;
	}

	getDisplayText(): string {
		return "To-Do Tasks";
	}

	getIcon(): string {
		return "list-todo";
	}

	async onOpen() {
		const viewContent = this.containerEl.querySelector(".view-content");
		if (viewContent) {
			this.contentContainer = viewContent.createDiv(
				"tasks-syncer-content",
			);
		} else {
			this.contentContainer = this.containerEl.createDiv(
				"tasks-syncer-content",
			);
		}
		const mainContainer = this.contentContainer;

		this.setupNavHeader();
		this.taskContainer = mainContainer.createDiv("tasks-group");

		this.injectStyles();

		this.render();
		this.plugin
			.refreshTaskCache()
			.then(() => this.render())
			.catch((error) => {
				console.error("Error loading tasks in sidebar:", error);
				notify("Error loading tasks in sidebar", error);
			});
	}

	/**
	 * Setup nav header with refresh and toggle-completed buttons.
	 */
	private async setupNavHeader() {
		const navContent = this.contentContainer.createDiv("nav-header");
		const navButtons = navContent.createDiv({ cls: "nav-buttons" });

		// Refresh button.
		const refreshBtn = navButtons.createEl("a", {
			cls: "nav-action-button",
		});
		setIcon(refreshBtn, "refresh-cw");
		refreshBtn.title = "Refresh Tasks";
		refreshBtn.onclick = async () => {
			// Optional: show spinner immediately
			this.render();
			try {
				await this.plugin.refreshTaskCache();
				this.render();
			} catch (error) {
				console.log("Error refreshing tasks:", error);
				notify("Failed to refresh tasks", "error");
			}
		};

		// Toggle button for showing/hiding completed tasks.
		const toggleComplete = navButtons.createEl("a", {
			cls: "nav-action-button",
		});
		setIcon(toggleComplete, "eye");
		toggleComplete.title = "Toggle Completed Tasks";
		toggleComplete.onclick = async () => {
			await this.flipTogCompleteSetting();
			this.render();
		};
	}

	/**
	 * Render function which always loads tasks from the plugin cache.
	 * @param showCompleted Whether to display completed tasks.
	 */
	async render() {
		const showCompleted = this.plugin.settings.showComplete;
		const container = this.taskContainer;
		container.empty();

		container.createEl("h4", {
			text: this.plugin.settings.selectedTaskListTitle,
		});

		const currentData = await this.plugin.loadData();
		const tasksArray = currentData?.tasks as
			| [string, TaskItem][]
			| undefined;

		const tasks = new Map<string, TaskItem>(tasksArray);

		if (tasks.size === 0) {
			container.createEl("p", { text: "No tasks found" });
			return;
		}

		const filteredTasks = Array.from(tasks.values())
			.filter((task) => showCompleted || task.status !== "completed")
			.sort((a, b) => {
				if (a.status === "completed" && b.status !== "completed")
					return 1;
				if (a.status !== "completed" && b.status === "completed")
					return -1;
				return 0;
			});

		filteredTasks.forEach((task) => {
			this.renderTaskLine(task);
		});
	}

	/**
	 * Render a single task line.
	 */
	renderTaskLine(task: TaskItem) {
		const line = this.taskContainer.createEl("div", { cls: "task-line" });
		const checkbox = line.createEl("input", {
			type: "checkbox",
		}) as HTMLInputElement;
		checkbox.checked = task.status === "completed";
		checkbox.disabled = false;
		line.createEl("span", { text: task.title });

		checkbox.addEventListener("change", async (event) => {
			await this.handleTaskStatusChange(event, task, checkbox);
		});
	}

	/**
	 * Handle the checkbox change event for a task.
	 */
	async handleTaskStatusChange(
		event: Event,
		task: TaskItem,
		checkbox: HTMLInputElement,
	) {
		checkbox.disabled = true;
		const target = event.target as HTMLInputElement;
		const newCompletedState = target.checked;

		try {
			const accessToken = await this.plugin.getAccessToken();
			console.log(
				`Updating "${task.title}" to ${newCompletedState ? "completed" : "not started"}`,
			);
			await updateTask(
				this.plugin.settings,
				accessToken,
				task.id,
				newCompletedState,
			);
			task.status = newCompletedState ? "completed" : "notstarted";
			await this.plugin.refreshTaskCache();
			this.render();
		} catch (error) {
			console.error("Error updating task with checkbox:", error);
			notify("Failed to update task", "error");
			// Revert checkbox state on error.
			target.checked = !newCompletedState;
		} finally {
			checkbox.disabled = false;
		}
	}

	/**
	 * Toggle the setting for showing completed tasks.
	 */
	async flipTogCompleteSetting() {
		this.plugin.settings.showComplete = !this.plugin.settings.showComplete;
		await this.plugin.saveSettings();
		console.log(
			"Show complete saved as",
			this.plugin.settings.showComplete,
		);
	}

	async onClose() {
		// Optional cleanup code.
	}

	/**
	 * Inject custom CSS styles into the document.
	 */
	injectStyles() {
		const style = document.createElement("style");
		style.textContent = `
			.spinner-wrapper {
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				padding: 1em;
			}
			.loading-spinner {
				width: 24px;
				height: 24px;
				border: 3px solid var(--background-modifier-border);
				border-top: 3px solid var(--text-accent);
				border-radius: 50%;
				animation: spin 1s linear infinite;
				margin-bottom: 0.5em;
			}
			@keyframes spin {
				0% { transform: rotate(0deg); }
				100% { transform: rotate(360deg); }
			}
			.task-list-spacer {
				height: 1em;
			}
			.nav-action-button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 24px;
				height: 24px;
				color: white;
				background: transparent;
				border-radius: 4px;
				transition: background-color 0.2s ease-in-out;
			}
			.nav-action-button:hover {
				background-color: var(--background-modifier-hover, #444);
			}
		`;
		document.head.appendChild(style);
	}
}
