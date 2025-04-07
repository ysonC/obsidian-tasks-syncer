import { ItemView, WorkspaceLeaf } from "obsidian";
import type TaskSyncerPlugin from "src/main";
import { notify } from "./utils";

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

	async onOpen() {
		this.render(new Map());
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
			notify("Refreshing tasks...");
			const tasks = await this.plugin.refreshTaskCache();
			this.render(tasks);
			notify("Task refreshed!", "success");
		};
	}

	async render(
		tasks: Map<string, { title: string; status: string; id: string }>,
	) {
		const container = this.containerEl.children[1];
		container.empty();

		this.setupRefreshButton(container);

		container.createEl("h3", { text: "Tasks" });

		if (tasks.size === 0) {
			container.createEl("p", {
				text: "No tasks found or not authenticated.",
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
				const line = container.createEl("div", { cls: "task-line" });

				const checkbox = line.createEl("input", {
					type: "checkbox",
				}) as HTMLInputElement;

				checkbox.checked = task.status === "completed";
				checkbox.disabled = true;

				line.createEl("span", {
					text: task.title,
				});
			});
	}
	async onClose() {
		// Optional cleanup
	}
}
