import { App, FuzzySuggestModal, Notice } from "obsidian";
import { updateTask } from "src/api"; // Make sure to import your updateTask function

/**
 * Interface for a task item.
 */
interface TaskItem {
	title: string;
	status: string;
	id: string;
}

/**
 * A modal that displays all tasks from the selected Microsoft To‑Do list.
 * When the user selects a task (presses Enter), the modal marks it as complete and calls a callback.
 */
export class TaskCompleteModal extends FuzzySuggestModal<TaskItem> {
	tasks: TaskItem[];
	onTaskCompleted: (task: TaskItem) => Promise<void>;

	/**
	 * Constructs the modal.
	 * @param app - The Obsidian app instance.
	 * @param tasks - An array of tasks to display.
	 * @param onTaskCompleted - Callback invoked when a task is marked as complete.
	 */
	constructor(
		app: App,
		tasks: TaskItem[],
		onTaskCompleted: (task: TaskItem) => Promise<void>,
	) {
		super(app);
		this.tasks = tasks;
		this.onTaskCompleted = onTaskCompleted;
	}

	/**
	 * Returns an array of tasks to be displayed.
	 */
	getItems(): TaskItem[] {
		return this.tasks;
	}

	/**
	 * Returns the text to display for each task.
	 * If the task is complete, it appends "[completed]".
	 */
	getItemText(item: TaskItem): string {
		return item.status === "completed"
			? `${item.title} [completed]`
			: item.title;
	}

	/**
	 * Called when a task is chosen.
	 * Marks the selected task as complete (if not already) and calls the onTaskCompleted callback.
	 * @param item - The selected task.
	 * @param evt - The event that triggered the selection.
	 */
	async onChooseItem(
		item: TaskItem,
		evt: MouseEvent | KeyboardEvent,
	): Promise<void> {
		if (item.status === "completed") {
			new Notice("Task is already completed.");
			return;
		}
		await this.onTaskCompleted(item);
	}
}
