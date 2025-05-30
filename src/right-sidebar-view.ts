import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import type TaskSyncerPlugin from "src/main";
import { notify, playConfetti } from "./utils";
import { TaskItem, TaskInputResult } from "./types";
import { TaskTitleModal } from "./task-title-modal";

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

		this.getNewTasksRender(true);
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
			this.getNewTasksRender(true);
		};

		this.createToggleButton(
			navButtons,
			() => this.plugin.settings.showComplete,
			() => this.flipSetting("showComplete"),
			{ on: "eye-off", off: "eye" },
			"Toggle Completed Tasks",
		);
		// Due‑date toggle
		this.createToggleButton(
			navButtons,
			() => this.plugin.settings.showDueDate,
			() => this.flipSetting("showDueDate"),
			{ on: "calendar", off: "calendar-arrow-up" },
			"Toggle Due Dates",
		);
	}

	/**
	 * Render function which always loads tasks from the plugin cache.
	 * @param showCompleted Whether to display completed tasks.
	 */
	async render() {
		const showCompleted = this.plugin.settings.showComplete;
		const showDueDate = this.plugin.settings.showDueDate;
		const container = this.taskContainer;
		container.empty();

		container.createEl("h4", {
			text: this.plugin.settings.selectedTaskListTitle,
		});

		const tasksArray =
			this.plugin.taskCache?.tasks ?? ([] as [string, TaskItem][]);
		if (tasksArray.length === 0) {
			container.createEl("p", { text: "No tasks found" });
			return;
		}

		const tasks = tasksArray.map(([_, task]) => task);

		let filteredTasks = this.sortDueDate(showDueDate, tasks);
		filteredTasks = tasks
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
	 * Refresh task and show animation.
	 * @param spin Show spin animation or not
	 */
	private async getNewTasksRender(spin: boolean) {
		let wrapper: HTMLElement | null = null;

		if (spin) {
			const container = this.taskContainer;
			container.empty();
			wrapper = container.createDiv({ cls: "spinner-wrapper" });
			wrapper.createDiv({ cls: "loading-spinner" });
			wrapper.createEl("div", { text: "Loading tasks…" });
		}

		try {
			await this.plugin.refreshTaskCache();
		} catch (error) {
			console.error("Error refreshing tasks: ", error);
			notify("Failed to refresh tasks", "error");
		} finally {
			if (wrapper) wrapper.remove();
			this.render();
		}
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
		const detailsContainer = line.createEl("div", { cls: "task-details" });

		detailsContainer.createEl("div", {
			cls: "task-title",
			text: task.title,
		});

		const dueDate = task.dueDateTime?.dateTime
			? task.dueDateTime.dateTime.split("T")[0]
			: "";

		detailsContainer.createEl(
			"div",
			this.formatDueDate(dueDate, task.status),
		);

		detailsContainer.addEventListener("dblclick", async () => {
			await this.handleTaskEdit(task, dueDate);
		});
		checkbox.addEventListener("change", async (event) => {
			await this.handleTaskStatusChange(event, task, checkbox);
		});
	}

	/**
	 * Show pop up to edit task using api function
	 */
	async handleTaskEdit(task: TaskItem, dueDate: string) {
		new TaskTitleModal(
			this.app,
			async (result: TaskInputResult) => {
				try {
					await this.plugin.api.updateTask(task.id, {
						title: result.title,
						dueDate: result.dueDate,
						status: false,
					});
					this.getNewTasksRender(false);
					console.log("Edit task complete");
				} catch (error) {
					console.error("Error pushing tasks:", error);
					notify(
						"Error pushing tasks. Check the console for details.",
						"error",
					);
				}
			},
			{ title: task.title, dueDate: dueDate },
		).open();
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
		if (newCompletedState) this.runConfettiAnimation("regular");

		try {
			await this.plugin.api.updateTask(task.id, {
				status: newCompletedState,
			});

			task.status = newCompletedState ? "completed" : "notstarted";
			const refreshedTasks = await this.plugin.refreshTaskCache();
			if (
				Array.from(refreshedTasks.values()).every(
					(task) => task.status === "completed",
				)
			)
				this.runConfettiAnimation(this.plugin.settings.confettiType);
			this.getNewTasksRender(false);
		} catch (error) {
			console.error("Error updating task with checkbox:", error);
			notify("Failed to update task", "error");
			target.checked = !newCompletedState;
		} finally {
			checkbox.disabled = false;
		}
	}

	/**
	 * Toggle the setting for showing completed tasks.
	 */
	async flipSetting<K extends keyof TaskSyncerPlugin["settings"]>(key: K) {
		// @ts-expect-error
		this.plugin.settings[key] = !this.plugin.settings[key];
		await this.plugin.saveSettings();
	}

	/**
	 * Sort due date base on the closest to today
	 * @param show A boolean to show (true) or not (false)
	 * @param tasks The entire task items
	 */
	sortDueDate(show: boolean, tasks: TaskItem[]): TaskItem[] {
		if (!show) return tasks;
		tasks.sort((a, b) => {
			if (a.dueDateTime === undefined && b.dueDateTime === undefined) {
				return 0;
			}

			if (a.dueDateTime === undefined) {
				return 1;
			}

			if (b.dueDateTime === undefined) {
				return -1;
			}

			const dateA = new Date(a.dueDateTime.dateTime);
			const dateB = new Date(b.dueDateTime.dateTime);
			return dateA.getTime() - dateB.getTime();
		});
		return tasks;
	}

	/**
	 * Format due date into cls format for today, tomorrow, and other.
	 * @param date The date to convert.
	 */
	private formatDueDate(
		date: string,
		status: string,
	): { text: string; cls: string } {
		const iso = new Date().toISOString().slice(0, 10);
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomIso = tomorrow.toISOString().slice(0, 10);

		if (status === "completed") return { text: date, cls: "task-due-date" };

		if (date === iso) {
			return { text: "Today", cls: "task-due-date-now" };
		} else if (date === tomIso) {
			return { text: "Tomorrow", cls: "task-due-date-tomorrow" };
		} else if (date && date < iso) {
			return { text: "Past Due", cls: "task-due-date-past" };
		} else return { text: date, cls: "task-due-date" };
	}

	/**
	 * Create toggle button
	 */
	private createToggleButton(
		parent: HTMLElement,
		getState: () => boolean,
		flipState: () => Promise<void>,
		icons: { on: string; off: string },
		title: string,
	): HTMLAnchorElement {
		const btn = parent.createEl("a", { cls: "nav-action-button" });
		btn.title = title;

		const updateIcon = () => {
			setIcon(btn, getState() ? icons.off : icons.on);
		};

		updateIcon();

		btn.onclick = async () => {
			await flipState();
			updateIcon();
			this.getNewTasksRender(true);
		};

		return btn;
	}

	private runConfettiAnimation(type: string) {
		if (this.plugin.settings.enableConfetti) playConfetti(type);
	}

	async onClose() {}
}
