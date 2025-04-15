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

		// Layer: nav -> button -> tasks
		this.setupNavHeader();
		// this.setupRefreshButton();
		this.taskContainer = mainContainer.createDiv("tasks-group");

		this.injectStyles();
		this.render(null);
		this.plugin
			.getTasksFromSelectedList()
			.then((tasks) => this.render(tasks))
			.catch((error) => {
				console.error("Error loading tasks in sidebar:", error);
				notify("Error loading tasks in sidebar", error);
			});
	}

	/**
	 * Setup button for refreshing sidebar tasks.
	 * @param Container for button
	 */
	private async setupRefreshButton() {
		const button = this.contentContainer.createEl("button", {
			text: "Refresh Tasks",
		});
		button.onclick = async () => {
			this.render(null);
			try {
				const tasks = await this.plugin.refreshTaskCache();
				this.render(tasks);
			} catch (error) {
				console.log("Error refreshing tasks:", error);
				notify("Failed to refresh tasks", "error");
			}
		};
	}

	/**
	 * Setup nav header for storing buttons
	 * @param Main container
	 */
	private async setupNavHeader() {
		const navContent = this.contentContainer.createDiv("nav-header");
		const navButtons = navContent.createDiv({ cls: "nav-buttons" });

		const refreshBtn = navButtons.createEl("a", {
			cls: "nav-action-button",
		});
		setIcon(refreshBtn, "refresh-cw");
		refreshBtn.title = "Refreash-Tasks";
		refreshBtn.onclick = async () => {
			this.render(null);
			try {
				const tasks = await this.plugin.refreshTaskCache();
				this.render(tasks);
			} catch (error) {
				console.log("Error refreshing tasks:", error);
				notify("Failed to refresh tasks", "error");
			}
		};
	}

	async render(tasks: Map<string, TaskItem> | null) {
		const container = this.taskContainer;
		container.empty();

		container.createEl("h4", {
			text: this.plugin.settings.selectedTaskListTitle,
		});
		// container.createEl("div", { cls: "task-list-spacer" });

		if (tasks === null) {
			const spinnerWrapper = container.createDiv({
				cls: "spinner-wrapper",
			});
			spinnerWrapper.createDiv({ cls: "loading-spinner" });
			spinnerWrapper.createEl("p", { text: "Loading tasks..." });
			return;
		}

		if (tasks.size === 0) {
			container.createEl("p", {
				text: "No tasks found",
			});
			return;
		}

		Array.from(tasks.values())
			.sort((a, b) => {
				// Move completed tasks to the bottom
				if (a.status === "completed" && b.status !== "completed")
					return 1;
				if (a.status !== "completed" && b.status === "completed")
					return -1;
				return 0; // Keep original order otherwise
			})
			.forEach((task) => {
				const line = container.createEl("div", {
					cls: "task-line",
				});

				const checkbox = line.createEl("input", {
					type: "checkbox",
				}) as HTMLInputElement;

				checkbox.checked = task.status === "completed";
				checkbox.disabled = false;

				line.createEl("span", {
					text: task.title,
				});
				checkbox.addEventListener("change", async (event) => {
					checkbox.disabled = true;

					const target = event.target as HTMLInputElement;
					const newCompletedState = target.checked; // true if checked, false otherwise

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

						task.status = newCompletedState
							? "completed"
							: "notstarted";
						try {
							const tasks = await this.plugin.refreshTaskCache();
							this.render(tasks);
						} catch (error) {
							console.log("Error refreshing tasks:", error);
							notify("Failed to refresh tasks", "error");
						}
					} catch (error) {
						console.error(
							"Error updating task with checkbox:",
							error,
						);
						notify("Failed to update task", "error");

						target.checked = !newCompletedState;
					} finally {
						checkbox.disabled = false;
					}
				});
			});
	}

	async onClose() {
		// Optional cleanup
	}

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
	
	.task-list-spacer{
		height: 1em
	}

	.nav-action-button {
	  /* Ensure the button is displayed as an inline-flex container */
	  display: inline-flex;
	  align-items: center;
	  justify-content: center;
	  width: 24px;       /* Match Obsidian’s typical icon button size */
	  height: 24px;
	  /* Set the icon color to white */
	  color: white;
	  background: transparent; /* No background by default */
	  border-radius: 4px;      /* Optional rounding to mimic the square with rounded corners */
	  transition: background-color 0.2s ease-in-out;
	}

	.nav-action-button:hover {
	  background-color: var(--background-modifier-hover, #444);
	}

	`;
		document.head.appendChild(style);
	}
}
