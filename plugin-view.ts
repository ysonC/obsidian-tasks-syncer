import { ItemView, WorkspaceLeaf } from "obsidian";
import type TaskSyncerPlugin from "./main";

export const VIEW_TYPE_TODO_SIDEBAR = "microsoft-todo-sidebar";

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
		return "Microsoft To-Do Tasks";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		container.createEl("h3", { text: "Microsoft To-Do Tasks" });

		const tasks = await this.plugin.getTasksFromSelectedList();
		if (tasks.size === 0) {
			container.createEl("p", { text: "No tasks found or not authenticated." });
			return;
		}

		tasks.forEach((status, title) => {
			const line = container.createEl("div");
			line.createEl("span", { text: ` ${title}` });
		});
	}

	async onClose() {
		// Optional cleanup
	}
}

