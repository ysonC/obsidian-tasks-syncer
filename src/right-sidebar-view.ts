import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import type TaskSyncerPlugin from "./main";
import { playConfetti } from "./utils";
import { TaskItem, TaskUpdate } from "./types";
import { TaskTitleModal } from "./task-title-modal";
import { sortTasksForSidebar } from "./task-sort";
import { calendarDateInTimeZone, dueDateLabel } from "./date-only";

export const VIEW_TYPE_TODO_SIDEBAR = "tasks-syncer-sidebar";

export class TaskSidebarView extends ItemView {
	private contentContainer: HTMLElement;
	private taskContainer: HTMLElement;
	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TaskSyncerPlugin,
	) {
		super(leaf);
	}
	getViewType(): string {
		return VIEW_TYPE_TODO_SIDEBAR;
	}
	getDisplayText(): string {
		return "Task Syncer";
	}
	getIcon(): string {
		return "list-todo";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentContainer = this.contentEl.createDiv("task-syncer-content");
		this.setupNavHeader();
		this.taskContainer =
			this.contentContainer.createDiv("task-syncer-tasks");
		await this.refresh(true);
	}

	private setupNavHeader(): void {
		const buttons = this.contentContainer.createDiv("task-syncer-nav");
		const refresh = buttons.createEl("button", {
			cls: "task-syncer-nav-button",
			type: "button",
		});
		setIcon(refresh, "refresh-cw");
		refresh.setAttr("aria-label", "Refresh tasks");
		refresh.title = "Refresh tasks";
		refresh.addEventListener("click", () => {
			void this.refresh(true);
		});
		this.toggle(
			buttons,
			"showCompleted",
			{ on: "eye-off", off: "eye" },
			"Toggle completed tasks",
		);
		this.toggle(
			buttons,
			"showDueDate",
			{ on: "calendar", off: "calendar-arrow-up" },
			"Toggle due dates",
		);
	}

	private toggle(
		parent: HTMLElement,
		key: "showCompleted" | "showDueDate",
		icons: { on: string; off: string },
		title: string,
	): void {
		const button = parent.createEl("button", {
			cls: "task-syncer-nav-button",
			type: "button",
		});
		button.title = title;
		button.setAttr("aria-label", title);
		const updateIcon = (): void =>
			setIcon(button, this.plugin.settings[key] ? icons.off : icons.on);
		updateIcon();
		button.addEventListener("click", () => {
			void (async () => {
				try {
					const enabled = !this.plugin.settings[key];
					if (key === "showCompleted")
						await this.plugin.updateShowCompleted(enabled);
					else {
						this.plugin.settings.showDueDate = enabled;
						await this.plugin.saveSettings();
					}
					updateIcon();
					await this.refresh(key === "showCompleted");
				} catch (error) {
					this.plugin.reportError(
						"Sidebar setting update failed",
						error,
					);
				}
			})();
		});
	}

	async render(): Promise<void> {
		if (!this.taskContainer) return;
		this.taskContainer.empty();
		this.taskContainer.createEl("h4", {
			text:
				this.plugin.providerSettings.selectedListTitle ||
				"No task list selected",
		});
		const today = calendarDateInTimeZone(
			new Date(),
			this.plugin.settings.timeZone,
		);
		const visible = sortTasksForSidebar(
			(this.plugin.taskCache?.tasks ?? []).filter(
				(task) =>
					this.plugin.settings.showCompleted ||
					task.status === "open",
			),
			this.plugin.settings.showDueDate,
			today,
		);
		if (!visible.length) {
			this.taskContainer.createEl("p", { text: "No tasks found" });
			return;
		}
		visible.forEach((task) => this.renderTask(task, today));
	}

	private renderTask(task: TaskItem, today: string): void {
		const context = this.plugin.captureMutationContext();
		const line = this.taskContainer.createDiv({
			cls: "task-syncer-task-line",
		});
		const checkbox = line.createEl("input", { type: "checkbox" });
		checkbox.checked = task.status === "completed";
		checkbox.setAttr(
			"aria-label",
			`Mark ${task.title} ${checkbox.checked ? "open" : "completed"}`,
		);
		const canReopen =
			this.plugin.api.capabilities.reopenTask &&
			this.plugin.api.reopenTask !== undefined;
		if (checkbox.checked && !canReopen) {
			checkbox.disabled = true;
			checkbox.title =
				"TickTick's open API does not support reopening completed tasks.";
		}
		const details = line.createDiv("task-syncer-task-details");
		details.createDiv({ cls: "task-syncer-task-title", text: task.title });
		const date = task.dueDate?.slice(0, 10) ?? "";
		const label = this.plugin.settings.showDueDate
			? dueDateLabel(date, task.status, today)
			: "";
		details.createDiv({ cls: this.dueDateClass(label), text: label });
		details.addEventListener("dblclick", () => this.editTask(task));
		checkbox.addEventListener("change", () => {
			void (async () => {
				checkbox.disabled = true;
				try {
					await this.plugin.runMutationInContext(
						context,
						async (service) => {
							if (checkbox.checked) {
								await service.completeTask(
									task.listId,
									task.id,
								);
								if (this.plugin.settings.enableConfetti)
									playConfetti(
										this.plugin.settings.confettiType,
									);
							} else if (service.reopenTask)
								await service.reopenTask(task.listId, task.id);
							else
								throw new Error(
									"This provider cannot reopen completed tasks.",
								);
						},
					);
					await this.refresh(false);
				} catch (error) {
					checkbox.checked = !checkbox.checked;
					this.plugin.reportError("Task status update failed", error);
				} finally {
					if (!checkbox.checked || canReopen)
						checkbox.disabled = false;
				}
			})();
		});
	}

	private dueDateClass(label: string): string {
		if (label === "Today")
			return "task-syncer-due-date task-syncer-due-date-now";
		if (label === "Tomorrow")
			return "task-syncer-due-date task-syncer-due-date-tomorrow";
		if (label === "Past due")
			return "task-syncer-due-date task-syncer-due-date-past";
		return "task-syncer-due-date";
	}

	private editTask(task: TaskItem): void {
		const context = this.plugin.captureMutationContext();
		new TaskTitleModal(
			this.app,
			async (result) => {
				const update: TaskUpdate = { title: result.title };
				if (result.dueDate !== undefined)
					update.dueDate = result.dueDate;
				await this.plugin.runMutationInContext(context, (service) =>
					service.updateTask(task.listId, task.id, update),
				);
				await this.refresh(false);
			},
			{ title: task.title, dueDate: task.dueDate },
		).open();
	}

	private async refresh(spin: boolean): Promise<void> {
		let wrapper: HTMLElement | undefined;
		if (spin && this.taskContainer) {
			this.taskContainer.empty();
			wrapper = this.taskContainer.createDiv(
				"task-syncer-spinner-wrapper",
			);
			wrapper.createDiv("task-syncer-loading-spinner");
		}
		try {
			await this.plugin.refreshViewAndCache();
		} catch (error) {
			this.plugin.reportError("Task refresh failed", error);
		} finally {
			wrapper?.remove();
			await this.render();
		}
	}
}
