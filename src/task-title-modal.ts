import { Modal, App } from "obsidian";
import { TaskInputResult } from "./types";

export function buildTaskInputResult(title: string, date: string, editing: boolean, dateChanged = editing): TaskInputResult {
	const trimmed = title.trim();
	if (!trimmed) throw new Error("Task title cannot be blank.");
	const result: TaskInputResult = { title: trimmed };
	if (dateChanged && date) result.dueDate = `${date}T00:00:00`;
	else if (dateChanged && editing) result.dueDate = "";
	return result;
}

export function submitTaskFormOnEnter(event: KeyboardEvent, form: HTMLFormElement, submitter: HTMLButtonElement): void {
	if (event.key !== "Enter" || event.isComposing) return;
	event.preventDefault();
	event.stopPropagation();
	form.requestSubmit(submitter);
}

export function openNativeDatePicker(input: HTMLInputElement): void {
	try {
		input.showPicker?.();
	} catch {
		// Some platforms only allow showPicker() during specific user-activation
		// paths. Keep the normal date input usable when the native picker refuses.
	}
}

export class TaskTitleModal extends Modal {
	private readonly initial?: TaskInputResult;
	constructor(
		app: App,
		private readonly onSubmit: (result: TaskInputResult) => void | Promise<void>,
		initial?: TaskInputResult,
	) { super(app); this.initial = initial; }

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("task-syncer-modal");
		const form = contentEl.createEl("form", { cls: "task-syncer-task-form" });
		const inputEl = form.createEl("input", { type: "text", cls: "task-syncer-task-input", placeholder: "Task title", value: this.initial?.title ?? "" });
		const initialDate = this.initial?.dueDate?.slice(0, 10) ?? "";
		const dueInput = form.createEl("input", { type: "date", cls: "task-syncer-task-input", value: initialDate });
		dueInput.setAttr("aria-label", "Due date (optional)");
		const errorEl = form.createDiv({ cls: "task-syncer-form-error" });
		errorEl.setAttr("role", "alert");
		const actions = form.createDiv({ cls: "task-syncer-modal-actions" });
		const cancel = actions.createEl("button", { text: "Cancel", type: "button" });
		const save = actions.createEl("button", { text: "Save", type: "submit", cls: "mod-cta" });
		inputEl.addEventListener("keydown", event => submitTaskFormOnEnter(event, form, save));
		dueInput.addEventListener("keydown", event => submitTaskFormOnEnter(event, form, save));
		dueInput.addEventListener("focus", () => openNativeDatePicker(dueInput));
		dueInput.addEventListener("click", () => openNativeDatePicker(dueInput));
		cancel.addEventListener("click", () => this.close());
		form.addEventListener("submit", event => {
			event.preventDefault();
			errorEl.empty();
			let result: TaskInputResult;
			try { result = buildTaskInputResult(inputEl.value, dueInput.value, this.initial !== undefined, dueInput.value !== initialDate); }
			catch (error) { errorEl.setText(error instanceof Error ? error.message : "Could not save task."); inputEl.focus(); return; }
			save.disabled = true;
			void Promise.resolve(this.onSubmit(result)).then(() => this.close(), error => {
				save.disabled = false;
				errorEl.setText(error instanceof Error ? error.message : "Could not save task.");
			});
		});
		inputEl.focus();
	}

	onClose(): void { this.contentEl.empty(); }
}
