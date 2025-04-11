import { ItemView, WorkspaceLeaf } from "obsidian";
import type TaskSyncerPlugin from "src/main";
import { notify } from "./utils";
import { updateTask } from "./api";

export const VIEW_TYPE_TODO_SIDEBAR = "tasks-syncer-sidebar";

export class TaskSidebarView extends ItemView {
	plugin: TaskSyncerPlugin;

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
	private async setupRefreshButton(container: Element) {
		const button = container.createEl("button", { text: "Refresh Tasks" });
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

	async render(
		tasks: Map<
			string,
			{ title: string; status: string; id: string }
		> | null,
	) {
		const container = this.containerEl.children[1];
		container.empty();

		this.setupRefreshButton(container);

		container.createEl("h3", { text: "Tasks" });

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
	`;
		document.head.appendChild(style);
	}
}
