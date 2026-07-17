import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import type TaskSyncerPlugin from "./main";
import { playConfetti } from "./utils";
import { TaskItem, TaskInputResult } from "./types";
import { TaskTitleModal } from "./task-title-modal";

export const VIEW_TYPE_TODO_SIDEBAR = "tasks-syncer-sidebar";

export class TaskSidebarView extends ItemView {
	plugin: TaskSyncerPlugin;
	contentContainer: HTMLElement;
	taskContainer: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: TaskSyncerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}
	getViewType() { return VIEW_TYPE_TODO_SIDEBAR; }
	getDisplayText() { return "Task Syncer"; }
	getIcon() { return "list-todo"; }

	async onOpen() {
		const view = this.containerEl.querySelector(".view-content") as HTMLElement | null;
		this.contentContainer = (view || this.containerEl).createDiv("tasks-syncer-content");
		this.setupNavHeader();
		this.taskContainer = this.contentContainer.createDiv("tasks-group");
		await this.refresh(true);
	}

	private setupNavHeader() {
		const buttons = this.contentContainer.createDiv("nav-header").createDiv({ cls: "nav-buttons" });
		const refresh = buttons.createEl("a", { cls: "nav-action-button" });
		setIcon(refresh, "refresh-cw");
		refresh.title = "Refresh tasks";
		refresh.onclick = () => this.refresh(true);
		this.toggle(buttons, "showCompleted", { on: "eye-off", off: "eye" }, "Toggle completed tasks");
		this.toggle(buttons, "showDueDate", { on: "calendar", off: "calendar-arrow-up" }, "Toggle due dates");
	}

	private toggle(
		parent: HTMLElement,
		key: "showCompleted" | "showDueDate",
		icons: { on: string; off: string },
		title: string,
	) {
		const button = parent.createEl("a", { cls: "nav-action-button" });
		button.title = title;
		const updateIcon = () => setIcon(button, this.plugin.settings[key] ? icons.off : icons.on);
		updateIcon();
		button.onclick = async () => {
			try {
				this.plugin.settings[key] = !this.plugin.settings[key];
				if (key === "showCompleted") this.plugin.taskCache = null;
				await this.plugin.saveSettings();
				updateIcon();
				await this.refresh(key === "showCompleted");
			} catch (error) {
				this.plugin.reportError("Sidebar setting update failed", error);
			}
		};
	}

	async render() {
		if (!this.taskContainer) return;
		this.taskContainer.empty();
		this.taskContainer.createEl("h4", { text: this.plugin.providerSettings.selectedListTitle || "No task list selected" });
		const tasks = this.plugin.taskCache?.tasks || [];
		const visible = tasks
			.filter(task => this.plugin.settings.showCompleted || task.status === "open")
			.slice()
			.sort((a, b) => {
				if (a.status !== b.status) return a.status === "completed" ? 1 : -1;
				if (!this.plugin.settings.showDueDate) return 0;
				return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
			});
		if (!visible.length) {
			this.taskContainer.createEl("p", { text: "No tasks found" });
			return;
		}
		visible.forEach(task => this.renderTask(task));
	}

	private renderTask(task: TaskItem) {
		const line = this.taskContainer.createEl("div", { cls: "task-line" });
		const checkbox = line.createEl("input", { type: "checkbox" }) as HTMLInputElement;
		checkbox.checked = task.status === "completed";
		const canReopen = this.plugin.api.capabilities.reopenTask && !!this.plugin.api.reopenTask;
		if (checkbox.checked && !canReopen) {
			checkbox.disabled = true;
			checkbox.title = "TickTick's Open API does not support reopening completed tasks.";
		}
		const details = line.createDiv("task-details");
		details.createDiv({ cls: "task-title", text: task.title });
		details.createDiv(this.formatDueDate(task.dueDate?.slice(0, 10) || "", task.status));
		details.addEventListener("dblclick", () => this.editTask(task));
		checkbox.addEventListener("change", async () => {
			checkbox.disabled = true;
			try {
				if (checkbox.checked) {
					await this.plugin.api.completeTask(task.listId, task.id);
					if (this.plugin.settings.enableConfetti) playConfetti(this.plugin.settings.confettiType);
				} else if (this.plugin.api.reopenTask) {
					await this.plugin.api.reopenTask(task.listId, task.id);
				} else {
					throw new Error("This provider cannot reopen completed tasks.");
				}
				await this.refresh(false);
			} catch (error) {
				checkbox.checked = !checkbox.checked;
				this.plugin.reportError("Task status update failed", error);
			} finally {
				if (!checkbox.checked || canReopen) checkbox.disabled = false;
			}
		});
	}

	private editTask(task: TaskItem) {
		new TaskTitleModal(this.app, async (result: TaskInputResult) => {
			try {
				await this.plugin.api.updateTask(task.listId, task.id, { title: result.title, dueDate: result.dueDate });
				await this.refresh(false);
			} catch (error) {
				this.plugin.reportError("Task edit failed", error);
			}
		}, { title: task.title, dueDate: task.dueDate }).open();
	}

	private async refresh(spin: boolean) {
		let wrapper: HTMLElement | undefined;
		if (spin && this.taskContainer) {
			this.taskContainer.empty();
			wrapper = this.taskContainer.createDiv("spinner-wrapper");
			wrapper.createDiv("loading-spinner");
		}
		try { await this.plugin.refreshTaskCache(); }
		catch (error) { this.plugin.reportError("Task refresh failed", error); }
		finally { wrapper?.remove(); await this.render(); }
	}

	private formatDueDate(date: string, status: string) {
		if (!this.plugin.settings.showDueDate) return { text: "", cls: "task-due-date" };
		const today = new Date().toISOString().slice(0, 10);
		const next = new Date();
		next.setDate(next.getDate() + 1);
		const tomorrow = next.toISOString().slice(0, 10);
		if (status === "completed") return { text: date, cls: "task-due-date" };
		if (date === today) return { text: "Today", cls: "task-due-date-now" };
		if (date === tomorrow) return { text: "Tomorrow", cls: "task-due-date-tomorrow" };
		if (date && date < today) return { text: "Past Due", cls: "task-due-date-past" };
		return { text: date, cls: "task-due-date" };
	}

	async onClose() {}
}
