import { App, Modal, Setting, type ButtonComponent } from "obsidian";
import { DeleteConfirmationDetails } from "./delete-completed";

export class DeleteCompletedConfirmationModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly details: DeleteConfirmationDetails,
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Delete completed tasks?");

		this.contentEl.createEl("p", {
			text: this.confirmationText(),
		});

		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText("Cancel")
					.onClick(() => this.finish(false)),
			)
			.addButton((button) => {
				button.setButtonText("Delete");
				button.setCta();

				this.setDestructiveCompat(button);

				button.onClick(() => this.finish(true));
			});
	}

	onClose(): void {
		this.contentEl.empty();

		if (!this.settled) {
			this.finish(false);
		}
	}

	private confirmationText(): string {
		const suffix = this.details.count === 1 ? "" : "s";

		return (
			`Delete ${this.details.count} completed task${suffix} ` +
			`from ${this.details.provider} list ` +
			`“${this.details.list}”? This cannot be undone.`
		);
	}

	private setDestructiveCompat(button: ButtonComponent): void {
		const compatibleButton = button as unknown as {
			setDestructive?: () => ButtonComponent;
		};

		if (typeof compatibleButton.setDestructive === "function") {
			compatibleButton.setDestructive.call(button);
			return;
		}

		// Obsidian versions before 1.13.0.
		button.setClass("mod-warning");
	}

	private finish(confirmed: boolean): void {
		if (this.settled) {
			return;
		}

		this.settled = true;
		this.resolve(confirmed);
		this.close();
	}
}

export function confirmCompletedTaskDeletion(
	app: App,
	details: DeleteConfirmationDetails,
): Promise<boolean> {
	return new Promise((resolve) => {
		new DeleteCompletedConfirmationModal(app, details, resolve).open();
	});
}
