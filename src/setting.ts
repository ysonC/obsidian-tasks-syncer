import { App, PluginSettingTab, Setting } from "obsidian";
import TaskSyncerPlugin from "./main";
import { playConfetti } from "./utils";
import { ProviderId } from "./types";
export { DEFAULT_SETTINGS } from "./settings-model";
export type { TaskSyncerSettings as MyTodoSettings } from "./settings-model";

export class MyTodoSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: TaskSyncerPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const provider = this.plugin.settings.provider;
		const config = this.plugin.providerSettings;
		containerEl.createEl("h2", { text: "Task Syncer Settings" });

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("Choose the task provider used by all commands and the sidebar.")
			.addDropdown(drop => drop
				.addOption("microsoft", "Microsoft To Do")
				.addOption("ticktick", "TickTick")
				.setValue(provider)
				.onChange(value => this.run("Provider change failed", async () => {
					await this.plugin.switchProvider(value as ProviderId);
					this.display();
				})));

		new Setting(containerEl)
			.setName(`${provider === "ticktick" ? "TickTick" : "Microsoft"} OAuth credentials`)
			.setDesc("Stored in this plugin's Obsidian settings. Desktop OAuth clients that require a secret cannot keep it fully confidential.")
			.addText(text => text.setPlaceholder("Client ID").setValue(config.clientId).onChange(value =>
				this.run("Credential update failed", () => this.plugin.updateProviderCredential("clientId", value.trim()))))
			.addText(text => text.setPlaceholder("Client secret").setValue(config.clientSecret).onChange(value =>
				this.run("Credential update failed", () => this.plugin.updateProviderCredential("clientSecret", value))));

		new Setting(containerEl)
			.setName("Redirect URL")
			.setDesc("Must exactly match the URL registered with the provider.")
			.addText(text => text.setPlaceholder("http://localhost:5000").setValue(config.redirectUrl).onChange(value =>
				this.run("Redirect URL update failed", () => this.plugin.updateProviderCredential("redirectUrl", value.trim()))));

		new Setting(containerEl)
			.setName("Account connection")
			.setDesc("Connect or disconnect the selected provider.")
			.addButton(button => button.setButtonText("Connect").onClick(() =>
				this.run("Connection failed", async () => { await this.plugin.connectCurrentProvider(); this.display(); })))
			.addButton(button => button.setButtonText("Disconnect").setWarning().onClick(() =>
				this.run("Disconnect failed", async () => { await this.plugin.disconnectCurrentProvider(); this.display(); })));

		new Setting(containerEl)
			.setName("Task lists")
			.setDesc("Load lists after connecting, then select the list used by commands.")
			.addButton(button => button.setButtonText("Load lists").onClick(async () => {
				await this.plugin.loadAvailableTaskLists();
				this.display();
			}));

		new Setting(containerEl).setName("Selected task list").addDropdown(drop => {
			drop.addOption("", "Select a task list");
			config.taskLists.forEach(list => drop.addOption(list.id, list.title));
			drop.setValue(config.selectedListId);
			drop.onChange(value => this.run("Task list update failed", async () => {
				const list = config.taskLists.find(item => item.id === value);
				config.selectedListId = value;
				config.selectedListTitle = list?.title || "";
				this.plugin.taskCache = null;
				await this.plugin.saveSettings();
			}));
		});

		new Setting(containerEl)
			.setName("Show completed tasks")
			.setDesc(provider === "ticktick" ? "Loads TickTick's documented completed-task endpoint. Completed TickTick tasks cannot be reopened." : "Include completed tasks in the sidebar.")
			.addToggle(toggle => toggle.setValue(this.plugin.settings.showCompleted).onChange(value =>
				this.run("Setting update failed", async () => {
					this.plugin.settings.showCompleted = value;
					this.plugin.taskCache = null;
					await this.plugin.saveSettings();
				})));

		new Setting(containerEl).setName("Show due dates").addToggle(toggle =>
			toggle.setValue(this.plugin.settings.showDueDate).onChange(value => this.run("Setting update failed", async () => {
				this.plugin.settings.showDueDate = value;
				await this.plugin.saveSettings();
			})));

		new Setting(containerEl)
			.setName("IANA time zone")
			.setDesc("Used when writing TickTick due dates (for example, America/Toronto).")
			.addText(text => text.setValue(this.plugin.settings.timeZone).onChange(value =>
				this.run("Time zone update failed", () => this.plugin.updateTimeZone(value.trim() || "UTC"))));

		new Setting(containerEl)
			.setName("Confetti")
			.addDropdown(drop => drop
				.addOption("regular", "Regular").addOption("big", "Big").addOption("superbig", "Super BIG")
				.setValue(this.plugin.settings.confettiType)
				.onChange(value => this.run("Confetti setting failed", async () => {
					this.plugin.settings.confettiType = value as "regular" | "big" | "superbig";
					await this.plugin.saveSettings();
					if (this.plugin.settings.enableConfetti) playConfetti(value);
				})))
			.addToggle(toggle => toggle.setValue(this.plugin.settings.enableConfetti).onChange(value =>
				this.run("Confetti setting failed", async () => { this.plugin.settings.enableConfetti = value; await this.plugin.saveSettings(); })));
	}

	private async run(action: string, work: () => void | Promise<void>) {
		try { await work(); }
		catch (error) { this.plugin.reportError(action, error); }
	}
}
