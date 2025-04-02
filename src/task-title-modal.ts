import { Modal, App } from "obsidian";

/**
 * A simple modal that prompts the user to enter a task title.
 * The modal is centered, and the task is submitted when the user presses Enter.
 */
export class TaskTitleModal extends Modal {
	result: string;
	onSubmit: (result: string) => void;

	/**
	 * Constructs the modal.
	 * @param app - The Obsidian app instance.
	 * @param onSubmit - A callback that receives the entered task title.
	 */
	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	/**
	 * Called when the modal is opened. Renders the input UI and centers it.
	 */
	onOpen() {
		const { contentEl } = this;

		// Apply centering styles to the modal content.
		contentEl.style.display = "flex";
		contentEl.style.flexDirection = "column";
		contentEl.style.alignItems = "center";
		contentEl.style.justifyContent = "center";
		contentEl.style.gap = "10px";
		contentEl.style.minHeight = "100px";

		// Create and append the header.
		contentEl.createEl("h2", { text: "Enter Task Title" });

		// Create and append the input element.
		const inputEl = contentEl.createEl("input", {
			type: "text",
			placeholder: "Task Title",
		});
		// Optionally set a width for the input.
		inputEl.style.width = "100%";
		inputEl.focus();

		// When the user presses Enter, submit the input.
		inputEl.onkeydown = (e) => {
			if (e.key === "Enter") {
				this.result = inputEl.value;
				this.close();
				this.onSubmit(this.result);
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
