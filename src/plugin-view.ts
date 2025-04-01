import { ItemView, WorkspaceLeaf } from "obsidian";
import type TaskSyncerPlugin from "src/main";

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
		await this.render();
	}

	async render() {
		const container = this.containerEl.children[1];
		container.empty();

		const refreshBtn = container.createEl("button", {
			text: "Refresh Tasks",
		});
		refreshBtn.onclick = () => this.render();

		container.createEl("h3", { text: "Tasks" });

		const tasks = await this.plugin.getTasksFromSelectedList();

		if (tasks.size === 0) {
			container.createEl("p", { text: "No tasks found or not authenticated." });
			return;
		}

		tasks.forEach((task) => {
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

