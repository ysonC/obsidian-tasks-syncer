import { App, PluginSettingTab, Setting } from "obsidian";
import MyTodoPlugin from "./main"; // Adjust the path as needed

export interface MyTodoSettings {
	selectedTaskListId: string;
	// A list of available task lists, each with an id and display name.
	taskLists: Array<{ id: string; displayName: string }>;
}

export const DEFAULT_SETTINGS: MyTodoSettings = {
	selectedTaskListId: "",
	taskLists: [],
};

export class MyTodoSettingTab extends PluginSettingTab {
	plugin: MyTodoPlugin;
	settings: MyTodoSettings;

	constructor(app: App, plugin: MyTodoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.settings = plugin.settings;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Microsoft To‑Do Settings" });

		// Add a sync button to update the task lists.
		new Setting(containerEl)
			.setName("Sync Task Lists")
			.setDesc("Fetch the latest task lists from Microsoft To‑Do.")
			.addButton((btn) => {
				btn.setButtonText("Sync")
					.onClick(async () => {
						await this.plugin.syncTaskLists();
						// Optionally, refresh the UI by re-rendering the settings tab.
						this.display();
					});
			});
		
		// Add a dropdown to select the task
		new Setting(containerEl)
			.setName("Task List")
			.setDesc("Select the Microsoft To‑Do list to store your Obsidian tasks.")
			.addDropdown((drop) => {
				// Add a default option.
				drop.addOption("", "Select a task list");

				// Populate dropdown with available task lists.
				if (this.settings.taskLists.length > 0) {
					this.settings.taskLists.forEach((list) => {
						drop.addOption(list.id, list.displayName);
					});
				} else {
					// Optionally, inform the user no task lists are available.
					drop.addOption("none", "No task lists available");
				}

				// Set the current value.
				drop.setValue(this.settings.selectedTaskListId);
				drop.onChange(async (value: string) => {
					this.settings.selectedTaskListId = value;
					await this.plugin.saveSettings();
				});
			});
	}
}

