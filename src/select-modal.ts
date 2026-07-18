import { App, FuzzySuggestModal } from "obsidian";
import { notify } from "./utils";

export class GenericSelectModal<T> extends FuzzySuggestModal<T> {
	items: T[];
	getText: (item: T) => string;
	onSelect: (item: T) => Promise<void>;

	constructor(
		app: App,
		items: T[],
		getText: (item: T) => string,
		onSelect: (item: T) => Promise<void>,
	) {
		super(app);
		this.items = items;
		this.getText = getText;
		this.onSelect = onSelect;
	}

	getItems(): T[] {
		return this.items;
	}

	getItemText(item: T): string {
		return this.getText(item);
	}

	onChooseItem(item: T): void {
		void this.onSelect(item).catch(error => {
			notify(error instanceof Error ? error.message : "The selected task action failed.", "error");
		});
	}
}
