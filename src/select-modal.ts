import { App, FuzzySuggestModal } from "obsidian";

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

	async onChooseItem(item: T): Promise<void> {
		await this.onSelect(item);
	}
}
