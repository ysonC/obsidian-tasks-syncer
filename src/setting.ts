import { App, PluginSettingTab, Setting } from "obsidian";
import TaskSyncerPlugin from "src/main";
import { playConfetti } from "./utils";

export interface MyTodoSettings {
	selectedTaskListId: string;
	selectedTaskListTitle: string;
	selectedService: string;

	showComplete: boolean;
	showDueDate: boolean;

	// A list of available task lists, each with an id and display name.
	taskLists: Array<{ id: string; title: string }>;
	clientId: string;
	clientSecret: string;
	redirectUrl: string;

	enableConfetti: boolean;
	confettiType: "regular" | "big" | "superbig";
}

export const DEFAULT_SETTINGS: MyTodoSettings = {
	selectedTaskListId: "",
	selectedTaskListTitle: "",
	selectedService: "",
	showComplete: true,
	showDueDate: false,
	taskLists: [],
	clientId: "",
	clientSecret: "",
	redirectUrl: "http://localhost:5000",
	enableConfetti: true,
	confettiType: "regular",
};

export class MyTodoSettingTab extends PluginSettingTab {
	plugin: TaskSyncerPlugin;
	settings: MyTodoSettings;

	constructor(app: App, plugin: TaskSyncerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.settings = plugin.settings;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Microsoft To‑Do Settings" });

		new Setting(containerEl)
			.setName("Service")
			.setDesc("Select the service for this plugin to sync")
			.addDropdown((drop) => {
				// Add a default option.
				drop.addOption("", "Select a task list");
				drop.addOption("microsoft", "Microsoft Task");
				drop.addOption("google", "Google Tasks");
				drop.setValue(this.settings.selectedService);
				drop.onChange(async (value) => {
					this.settings.selectedService = value as any;
					await this.plugin.saveSettings();
					console.log(this.settings.selectedService);
				});
			});

		new Setting(containerEl)
			.setName("Client Details")
			.setDesc(
				"Enter the client ID and client secret of your Azure AD app.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Client ID")
					.setValue(this.plugin.settings.clientId)
					.onChange(async (value) => {
						this.plugin.settings.clientId = value;
						await this.plugin.saveSettings();
					}),
			)
			.addText((text) =>
				text
					.setPlaceholder("Client Secret")
					.setValue(this.plugin.settings.clientSecret)
					.onChange(async (value) => {
						this.plugin.settings.clientSecret = value;
						await this.plugin.saveSettings();
					}),
			);

		// Add a section for URL to redirect to after authentication.
		new Setting(containerEl)
			.setName("Redirect URL")
			.setDesc("Enter the URL to redirect to after authentication.")
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:5000")
					.setValue(this.plugin.settings.redirectUrl)
					.onChange(async (value) => {
						this.plugin.settings.redirectUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		// Add a button to get the task lists.
		new Setting(containerEl)
			.setName("Get Task Lists")
			.setDesc("Click to get the list of available task lists.")
			.addButton((button) => {
				button.setButtonText("Get Task Lists").onClick(async () => {
					await this.plugin.loadAvailableTaskLists();
					this.display();
				});
			});

		// Add a dropdown to select the task
		new Setting(containerEl)
			.setName("Task List")
			.setDesc(
				"Select the Microsoft To‑Do list to store your Obsidian tasks.",
			)
			.addDropdown((drop) => {
				// Add a default option.
				drop.addOption("", "Select a task list");

				// Populate dropdown with available task lists.
				if (this.settings.taskLists.length > 0) {
					this.settings.taskLists.forEach((list) => {
						drop.addOption(list.id, list.title);
					});
				} else {
					// Optionally, inform the user no task lists are available.
					drop.addOption("none", "No task lists available");
				}

				// Set the current value.
				drop.setValue(this.settings.selectedTaskListId);
				drop.onChange(async (value: string) => {
					this.settings.selectedTaskListId = value;
					const matchingList = this.settings.taskLists.find(
						(list) => list.id === value,
					);
					this.settings.selectedTaskListTitle = matchingList
						? matchingList.title
						: "";
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Enable Confetti")
			.setDesc(
				"Show a confetti celebration when all tasks are completed.",
			)
			.addDropdown((drop) => {
				drop.addOption("regular", " Regular");
				drop.addOption("big", " Big");
				drop.addOption("superbig", " Super BIG");

				drop.setValue(this.settings.confettiType);
				drop.onChange(async (value) => {
					this.settings.confettiType = value as any;
					await this.plugin.saveSettings();
					playConfetti(this.settings.confettiType);
				});
			})
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.enableConfetti)
					.onChange(async (value) => {
						this.settings.enableConfetti = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
