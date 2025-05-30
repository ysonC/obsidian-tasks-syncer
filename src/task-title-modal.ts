import { Modal, App } from "obsidian";
import { TaskInputResult } from "./types";

/**
 * A simple modal that prompts the user to enter a task title.
 * The modal is centered, and the task is submitted when the user presses Enter.
 */
export class TaskTitleModal extends Modal {
	result: string;
	onSubmit: (result: TaskInputResult) => void;
	private initial?: TaskInputResult;

	/**
	 * Constructs the modal.
	 * @param app - The Obsidian app instance.
	 * @param onSubmit - A callback that receives the entered task title.
	 * @param initial - Optional initial values to pre-populate the inputs.
	 */
	constructor(
		app: App,
		onSubmit: (result: TaskInputResult) => void,
		initial?: TaskInputResult,
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.initial = initial;
	}

	/**
	 * Called when the modal is opened. Renders the input UI and centers it.
	 */
	onOpen() {
		const { contentEl } = this;

		contentEl.style.display = "flex";
		contentEl.style.flexDirection = "column";
		contentEl.style.alignItems = "center";
		contentEl.style.justifyContent = "center";

		const inputEl = contentEl.createEl("input", {
			type: "text",
			placeholder: "Task Title",
			value: this.initial?.title ?? "",
		});

		inputEl.style.width = "100%";
		inputEl.focus();

		const dueInput = contentEl.createEl("input", {
			type: "date",
			placeholder: "Due Date (optional)",
			value: this.initial?.dueDate
				? this.initial.dueDate.slice(0, 10)
				: "",
		});
		dueInput.style.width = "100%";

		inputEl.onkeydown = (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				const title = inputEl.value.trim();
				const dueDate = dueInput.value
					? `${dueInput.value}T00:00:00`
					: undefined;
				this.close();
				this.onSubmit({ title, dueDate });
			}
		};
	}

	/**
	 * Called when the modal is closed. Clears the content.
	 */
	onClose() {
		this.contentEl.empty();
	}
}
