import {
	App,
	PluginSettingTab,
	SecretComponent,
	Setting,
	type ButtonComponent,
	type SettingDefinitionGroup,
	type SettingDefinitionItem,
	type SettingDefinitionRender,
} from "obsidian";
import TaskSyncerPlugin from "./main";
import { playConfetti } from "./utils";
import { ProviderId } from "./types";

export { DEFAULT_SETTINGS } from "./settings-model";
export type { TaskSyncerSettings } from "./settings-model";

type ConfettiType = "regular" | "big" | "superbig";
type RefreshSettings = () => void;
type RenderSetting = (setting: Setting) => void;

interface TaskSyncerSettingDefinition {
	name: string;
	desc?: string;
	aliases?: string[];
	render: RenderSetting;
}

interface TaskSyncerSettingGroup {
	heading: string;
	items: TaskSyncerSettingDefinition[];
}

const REFRESH_INTERVAL_OPTIONS = [
	["0", "Disabled"],
	["1", "Every minute"],
	["5", "Every 5 minutes"],
	["10", "Every 10 minutes"],
	["15", "Every 15 minutes"],
	["30", "Every 30 minutes"],
	["60", "Every hour"],
] as const;

const CONFETTI_OPTIONS = [
	["regular", "Regular"],
	["big", "Big"],
	["superbig", "Super big"],
] as const;

function isProviderId(value: string): value is ProviderId {
	return value === "microsoft" || value === "ticktick";
}

function isConfettiType(value: string): value is ConfettiType {
	return value === "regular" || value === "big" || value === "superbig";
}

export class TaskSyncerSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TaskSyncerPlugin,
	) {
		super(app, plugin);
	}

	/**
	 * Obsidian 1.13.0+ uses these declarative definitions.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const groups = this.buildSettingGroups(() => this.update());

		return groups.map((group) => this.toDeclarativeGroup(group));
	}

	/**
	 * Obsidian versions below 1.13.0 use this legacy renderer.
	 */
	display(): void {
		this.renderLegacySettings();
	}

	/**
	 * Creates the shared settings structure used by both rendering systems.
	 */
	private buildSettingGroups(
		refreshSettings: RefreshSettings,
	): TaskSyncerSettingGroup[] {
		return [
			this.providerGroup(refreshSettings),
			this.refreshAndDisplayGroup(),
		];
	}

	private providerGroup(
		refreshSettings: RefreshSettings,
	): TaskSyncerSettingGroup {
		return {
			heading: "Provider and account",
			items: [
				this.providerSetting(refreshSettings),
				this.credentialsSetting(),
				this.redirectUrlSetting(),
				this.accountConnectionSetting(refreshSettings),
				this.taskListsSetting(refreshSettings),
				this.selectedTaskListSetting(),
			],
		};
	}

	private refreshAndDisplayGroup(): TaskSyncerSettingGroup {
		return {
			heading: "Refresh and display",
			items: [
				this.refreshIntervalSetting(),
				this.refreshOnStartupSetting(),
				this.showCompletedSetting(),
				this.showDueDatesSetting(),
				this.timeZoneSetting(),
				this.confettiSetting(),
			],
		};
	}

	/**
	 * Converts an internal shared group into Obsidian's declarative format.
	 */
	private toDeclarativeGroup(
		group: TaskSyncerSettingGroup,
	): SettingDefinitionGroup {
		return {
			type: "group",
			heading: group.heading,
			items: group.items.map((item) => this.toDeclarativeSetting(item)),
		};
	}

	private toDeclarativeSetting(
		item: TaskSyncerSettingDefinition,
	): SettingDefinitionRender {
		return {
			name: item.name,
			...(item.desc !== undefined ? { desc: item.desc } : {}),
			...(item.aliases !== undefined ? { aliases: item.aliases } : {}),
			render: (setting) => {
				item.render(setting);
			},
		};
	}

	/**
	 * Manually renders the same shared definitions for Obsidian < 1.13.
	 */
	private renderLegacySettings(): void {
		const { containerEl } = this;
		containerEl.empty();

		const groups = this.buildSettingGroups(() =>
			this.renderLegacySettings(),
		);

		for (const group of groups) {
			new Setting(containerEl).setName(group.heading).setHeading();

			for (const item of group.items) {
				const setting = new Setting(containerEl).setName(item.name);

				if (item.desc !== undefined) {
					setting.setDesc(item.desc);
				}

				item.render(setting);
			}
		}
	}

	private providerSetting(
		refreshSettings: RefreshSettings,
	): TaskSyncerSettingDefinition {
		const provider = this.plugin.settings.provider;

		return {
			name: "Provider",
			desc: "Choose the task provider used by all commands and the sidebar.",
			aliases: ["Microsoft To Do", "TickTick", "Task service"],
			render: (setting) => {
				setting.addDropdown((dropdown) =>
					dropdown
						.addOption("microsoft", "Microsoft To Do")
						.addOption("ticktick", "TickTick")
						.setValue(provider)
						.onChange((value) => {
							if (!isProviderId(value)) {
								return;
							}

							this.executeAndRefresh(
								"Provider change failed",
								() => this.plugin.switchProvider(value),
								refreshSettings,
							);
						}),
				);
			},
		};
	}

	private credentialsSetting(): TaskSyncerSettingDefinition {
		const provider = this.plugin.settings.provider;
		const config = this.plugin.providerSettings;
		const providerName = provider === "ticktick" ? "TickTick" : "Microsoft";

		return {
			name: `${providerName} OAuth credentials`,
			desc: "Client secrets are referenced through Obsidian SecretStorage and are not saved in the plugin data file.",
			aliases: ["Client ID", "Client secret", "OAuth", "SecretStorage"],
			render: (setting) => {
				setting.addText((text) =>
					text
						.setPlaceholder("Client ID")
						.setValue(config.clientId)
						.onChange((value) => {
							this.execute("Credential update failed", () =>
								this.plugin.updateProviderCredential(
									"clientId",
									value.trim(),
								),
							);
						}),
				);

				setting.addComponent((element) =>
					new SecretComponent(this.app, element)
						.setValue(config.clientSecretId)
						.onChange((value) => {
							this.execute("Credential update failed", () =>
								this.plugin.updateProviderCredential(
									"clientSecretId",
									value,
								),
							);
						}),
				);
			},
		};
	}

	private redirectUrlSetting(): TaskSyncerSettingDefinition {
		const config = this.plugin.providerSettings;

		return {
			name: "Redirect URL",
			desc: "Must exactly match the URL registered with the provider.",
			aliases: ["OAuth callback", "Callback URL"],
			render: (setting) => {
				setting.addText((text) =>
					text
						.setPlaceholder("Redirect URL")
						.setValue(config.redirectUrl)
						.onChange((value) => {
							this.execute("Redirect URL update failed", () =>
								this.plugin.updateProviderCredential(
									"redirectUrl",
									value.trim(),
								),
							);
						}),
				);
			},
		};
	}

	private accountConnectionSetting(
		refreshSettings: RefreshSettings,
	): TaskSyncerSettingDefinition {
		return {
			name: "Account connection",
			desc: "Connect or disconnect the selected provider.",
			aliases: [
				"Connect",
				"Disconnect",
				"Sign in",
				"Sign out",
				"OAuth connection",
			],
			render: (setting) => {
				setting.addButton((button) =>
					button.setButtonText("Connect").onClick(() => {
						this.executeAndRefresh(
							"Connection failed",
							() => this.plugin.connectCurrentProvider(),
							refreshSettings,
						);
					}),
				);

				setting.addButton((button) => {
					button.setButtonText("Disconnect");
					this.setDestructiveCompat(button);

					button.onClick(() => {
						this.executeAndRefresh(
							"Disconnect failed",
							() => this.plugin.disconnectCurrentProvider(),
							refreshSettings,
						);
					});
				});
			},
		};
	}

	private taskListsSetting(
		refreshSettings: RefreshSettings,
	): TaskSyncerSettingDefinition {
		return {
			name: "Task lists",
			desc: "Load lists after connecting, then select the list used by commands.",
			aliases: ["Load remote lists", "Refresh task lists"],
			render: (setting) => {
				setting.addButton((button) =>
					button.setButtonText("Load lists").onClick(() => {
						this.executeAndRefresh(
							"Load lists failed",
							() => this.plugin.loadAvailableTaskLists(),
							refreshSettings,
						);
					}),
				);
			},
		};
	}

	private selectedTaskListSetting(): TaskSyncerSettingDefinition {
		const config = this.plugin.providerSettings;

		return {
			name: "Selected task list",
			desc: "Choose the remote list used by commands and the sidebar.",
			aliases: ["Default task list", "Remote list"],
			render: (setting) => {
				setting.addDropdown((dropdown) => {
					dropdown.addOption("", "Select a task list");

					for (const list of config.taskLists) {
						dropdown.addOption(list.id, list.title);
					}

					dropdown
						.setValue(config.selectedListId)
						.onChange((value) => {
							this.execute(
								"Task list update failed",
								async () => {
									const list = config.taskLists.find(
										(item) => item.id === value,
									);

									await this.plugin.selectTaskList(
										value,
										list?.title ?? "",
									);
								},
							);
						});
				});
			},
		};
	}

	private refreshIntervalSetting(): TaskSyncerSettingDefinition {
		return {
			name: "Automatic refresh interval",
			desc: "Fetch remote tasks in the background. This does not push Markdown tasks.",
			aliases: [
				"Automatic synchronization",
				"Auto refresh",
				"Sync interval",
			],
			render: (setting) => {
				setting.addDropdown((dropdown) => {
					for (const [value, label] of REFRESH_INTERVAL_OPTIONS) {
						dropdown.addOption(value, label);
					}

					dropdown
						.setValue(
							String(
								this.plugin.settings.autoSyncIntervalMinutes,
							),
						)
						.onChange((value) => {
							this.execute(
								"Automatic refresh update failed",
								() =>
									this.plugin.updateAutoSyncInterval(
										Number(value),
									),
							);
						});
				});
			},
		};
	}

	private refreshOnStartupSetting(): TaskSyncerSettingDefinition {
		return {
			name: "Refresh on startup",
			desc: "Fetch remote tasks once after the Obsidian workspace is ready.",
			aliases: ["Startup synchronization", "Startup refresh"],
			render: (setting) => {
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.autoSyncOnStartup)
						.onChange((value) => {
							this.execute("Startup refresh update failed", () =>
								this.plugin.updateAutoSyncOnStartup(value),
							);
						}),
				);
			},
		};
	}

	private showCompletedSetting(): TaskSyncerSettingDefinition {
		const provider = this.plugin.settings.provider;

		const description =
			provider === "ticktick"
				? "Loads TickTick's documented completed-task endpoint. Completed TickTick tasks cannot be reopened."
				: "Include completed tasks in the sidebar.";

		return {
			name: "Show completed tasks",
			desc: description,
			aliases: ["Completed items", "Finished tasks", "Done tasks"],
			render: (setting) => {
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.showCompleted)
						.onChange((value) => {
							this.execute("Setting update failed", () =>
								this.plugin.updateShowCompleted(value),
							);
						}),
				);
			},
		};
	}

	private showDueDatesSetting(): TaskSyncerSettingDefinition {
		return {
			name: "Show due dates",
			desc: "Display task due dates in the sidebar.",
			aliases: ["Deadline", "Task date"],
			render: (setting) => {
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.showDueDate)
						.onChange((value) => {
							this.execute("Setting update failed", async () => {
								this.plugin.settings.showDueDate = value;

								await this.plugin.saveSettings();
							});
						}),
				);
			},
		};
	}

	private timeZoneSetting(): TaskSyncerSettingDefinition {
		return {
			name: "IANA time zone",
			desc: "Used when writing TickTick due dates, for example America/Toronto.",
			aliases: ["Timezone", "Time zone", "UTC"],
			render: (setting) => {
				setting.addText((text) =>
					text
						.setPlaceholder("UTC")
						.setValue(this.plugin.settings.timeZone)
						.onChange((value) => {
							this.execute("Time zone update failed", () =>
								this.plugin.updateTimeZone(
									value.trim() || "UTC",
								),
							);
						}),
				);
			},
		};
	}

	private confettiSetting(): TaskSyncerSettingDefinition {
		return {
			name: "Confetti",
			desc: "Configure the celebration shown when completing a task.",
			aliases: ["Celebration", "Animation", "Completion effect"],
			render: (setting) => {
				setting.addDropdown((dropdown) => {
					for (const [value, label] of CONFETTI_OPTIONS) {
						dropdown.addOption(value, label);
					}

					dropdown
						.setValue(this.plugin.settings.confettiType)
						.onChange((value) => {
							if (!isConfettiType(value)) {
								return;
							}

							this.execute(
								"Confetti setting failed",
								async () => {
									this.plugin.settings.confettiType = value;

									await this.plugin.saveSettings();

									if (this.plugin.settings.enableConfetti) {
										playConfetti(value);
									}
								},
							);
						});
				});

				setting.addToggle((toggle) =>
					toggle
						.setTooltip("Enable confetti when completing a task")
						.setValue(this.plugin.settings.enableConfetti)
						.onChange((value) => {
							this.execute(
								"Confetti setting failed",
								async () => {
									this.plugin.settings.enableConfetti = value;

									await this.plugin.saveSettings();
								},
							);
						}),
				);
			},
		};
	}

	/**
	 * Uses the new destructive style on Obsidian 1.13+.
	 *
	 * Older Obsidian versions do not have setDestructive(), so the
	 * legacy warning class is used as a runtime fallback.
	 */
	private setDestructiveCompat(button: ButtonComponent): void {
		const compatibleButton: {
			setDestructive?: () => ButtonComponent;
		} = button;

		if (compatibleButton.setDestructive !== undefined) {
			compatibleButton.setDestructive();
			return;
		}

		button.setClass("mod-warning");
	}

	private execute(action: string, work: () => void | Promise<void>): void {
		void this.run(action, work);
	}

	private executeAndRefresh(
		action: string,
		work: () => void | Promise<void>,
		refreshSettings: RefreshSettings,
	): void {
		this.execute(action, async () => {
			await work();
			refreshSettings();
		});
	}

	private async run(
		action: string,
		work: () => void | Promise<void>,
	): Promise<void> {
		try {
			await work();
		} catch (error) {
			this.plugin.reportError(action, error);
		}
	}
}
