import { App, Modal, Setting } from "obsidian";
import { DeleteConfirmationDetails } from "./delete-completed";

export class DeleteCompletedConfirmationModal extends Modal {
	private settled = false;
	constructor(app: App, private details: DeleteConfirmationDetails, private resolve: (confirmed: boolean) => void) {
		super(app);
	}
	onOpen(): void {
		this.titleEl.setText("Delete completed tasks?");
		this.contentEl.createEl("p", {
			text: `Delete ${this.details.count} completed task${this.details.count === 1 ? "" : "s"} from ${this.details.provider} list “${this.details.list}”? This cannot be undone.`,
		});
		new Setting(this.contentEl)
			.addButton(button => button.setButtonText("Cancel").onClick(() => this.finish(false)))
			.addButton(button => button.setButtonText("Delete").setWarning().onClick(() => this.finish(true)));
	}
	onClose(): void {
		this.contentEl.empty();
		if (!this.settled) this.finish(false);
	}
	private finish(confirmed: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.resolve(confirmed);
		this.close();
	}
}

export function confirmCompletedTaskDeletion(app: App, details: DeleteConfirmationDetails): Promise<boolean> {
	return new Promise(resolve => new DeleteCompletedConfirmationModal(app, details, resolve).open());
}
