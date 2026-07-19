import { Plugin, TFile, normalizePath } from "obsidian";
import { TaskSyncerSettingTab } from "./setting";
import { VIEW_TYPE_TODO_SIDEBAR, TaskSidebarView } from "./right-sidebar-view";
import { TaskTitleModal } from "./task-title-modal";
import { GenericSelectModal } from "./select-modal";
import { notify } from "./utils";
import {
	migrateSettings,
	TaskSyncerSettings,
	tokenCacheSecretId,
} from "./settings-model";
import { createProviderRuntime, ProviderRuntime } from "./provider";
import {
	ProviderId,
	TaskCache,
	TaskItem,
	TaskList,
	TaskService,
} from "./types";
import { canRunCommand, CommandId, COMMAND_IDS } from "./commands";
import {
	changeProviderCredential,
	changeTimeZone,
	SettingsEffects,
} from "./settings-actions";
import { resolvePluginDirectory } from "./plugin-path";
import { AutoSyncController } from "./auto-sync";
import {
	legacyConflictSecretId,
	migrateLegacyClientSecrets,
	migrateLegacyTokenFile,
	ObsidianSecretStore,
	SecretStore,
	SecretTokenStore,
} from "./secret-store";
import {
	deleteCompletedTasksAndRefresh,
	deleteCompletedTasksWithConfirmation,
} from "./delete-completed";
import { confirmCompletedTaskDeletion } from "./delete-confirmation-modal";
import { RefreshCoordinator } from "./refresh-controller";
import { matchRemoteTask } from "./task-matching";
import {
	GENERATED_END,
	GENERATED_START,
	updateManagedTaskSection,
} from "./task-organizer";

export interface MutationContext {
	provider: ProviderId;
	listId: string;
	generation: number;
	service: TaskService;
}

export default class TaskSyncerPlugin extends Plugin {
	settings: TaskSyncerSettings;
	taskCache: TaskCache | null = null;
	private runtime?: ProviderRuntime;
	private pluginDirectory: string;
	private autoSync: AutoSyncController;
	private secretStore: SecretStore;
	private refreshCoordinator: RefreshCoordinator<TaskItem[]>;
	private generation = 0;
	private unloaded = false;
	private oauthAbortController = new AbortController();
	get api(): TaskService {
		return this.ensureRuntime().tasks;
	}
	get providerSettings() {
		return this.settings.providers[this.settings.provider];
	}

	async onload(): Promise<void> {
		this.pluginDirectory = resolvePluginDirectory(
			this.manifest.dir,
			this.manifest.id,
			this.app.vault.configDir,
		);
		this.secretStore = new ObsidianSecretStore(this.app.secretStorage);
		await this.loadSettings();
		this.refreshCoordinator = new RefreshCoordinator(
			() => ({
				provider: this.settings.provider,
				listId: this.providerSettings.selectedListId,
				showCompleted: this.settings.showCompleted,
				generation: this.generation,
			}),
			async (identity) =>
				this.ensureRuntime().tasks.fetchTasks(
					identity.listId,
					identity.showCompleted,
				),
			(tasks, identity) => {
				this.taskCache = {
					provider: identity.provider as ProviderId,
					listId: identity.listId,
					tasks,
				};
			},
		);
		this.autoSync = new AutoSyncController(
			() => this.refreshViewAndCache(),
			() =>
				!this.unloaded && Boolean(this.providerSettings.selectedListId),
			(error) =>
				this.reportDiagnostic("Automatic task refresh failed", error),
			{
				setInterval: (callback, milliseconds) =>
					this.registerInterval(
						window.setInterval(callback, milliseconds),
					),
				clearInterval: (id) => window.clearInterval(id),
			},
		);
		this.addSettingTab(new TaskSyncerSettingTab(this.app, this));
		this.registerView(
			VIEW_TYPE_TODO_SIDEBAR,
			(leaf) => new TaskSidebarView(leaf, this),
		);
		this.initializeCommands();
		this.configureAutoSync();
		this.app.workspace.onLayoutReady(() => {
			if (!this.unloaded && this.settings.autoSyncOnStartup)
				void this.autoSync.run();
		});
	}

	onunload(): void {
		this.unloaded = true;
		this.oauthAbortController.abort();
		this.autoSync?.stop();
		this.refreshCoordinator?.dispose();
	}
	ensureRuntime(): ProviderRuntime {
		if (!this.runtime || this.runtime.id !== this.settings.provider)
			this.runtime = createProviderRuntime(
				this.settings.provider,
				this.settings,
				this.secretStore,
				undefined,
				this.oauthAbortController.signal,
			);
		return this.runtime;
	}
	private invalidateRuntime(): void {
		this.oauthAbortController.abort();
		if (!this.unloaded) this.oauthAbortController = new AbortController();
		this.generation++;
		this.runtime = undefined;
		this.taskCache = null;
	}
	captureMutationContext(): MutationContext {
		return {
			provider: this.settings.provider,
			listId: this.providerSettings.selectedListId,
			generation: this.generation,
			service: this.api,
		};
	}
	assertMutationContextCurrent(context: MutationContext): void {
		if (
			this.settings.provider !== context.provider ||
			this.providerSettings.selectedListId !== context.listId ||
			this.generation !== context.generation ||
			this.runtime?.tasks !== context.service
		) {
			throw new Error(
				"Task context changed while the dialog was open. Reopen it and try again.",
			);
		}
	}
	async runMutationInContext<T>(
		context: MutationContext,
		mutation: (service: TaskService) => T | Promise<T>,
	): Promise<T> {
		this.assertMutationContextCurrent(context);
		const result = await mutation(context.service);
		this.assertMutationContextCurrent(context);
		return result;
	}
	async rebuildRuntime(): Promise<void> {
		this.invalidateRuntime();
	}
	async switchProvider(provider: ProviderId): Promise<void> {
		if (provider === this.settings.provider) return;
		this.settings.provider = provider;
		this.invalidateRuntime();
		await this.saveSettings();
		await this.refreshSidebar();
	}

	async loadSettings(): Promise<void> {
		const raw: unknown = await this.loadData();
		this.settings = migrateSettings(raw);
		await migrateLegacyClientSecrets(
			raw,
			this.settings,
			this.secretStore,
			() => this.saveData(this.settings),
			{
				microsoft: new SecretTokenStore(
					this.secretStore,
					legacyConflictSecretId(
						this.settings.providers.microsoft.clientSecretId,
					),
				),
				ticktick: new SecretTokenStore(
					this.secretStore,
					legacyConflictSecretId(
						this.settings.providers.ticktick.clientSecretId,
					),
				),
			},
		);
		for (const provider of ["microsoft", "ticktick"] as const) {
			const tokenId = tokenCacheSecretId(provider);
			const tokens = new SecretTokenStore(this.secretStore, tokenId);
			await migrateLegacyTokenFile(
				this.app.vault.adapter,
				normalizePath(
					`${this.pluginDirectory}/${provider}-token-cache.json`,
				),
				tokens,
				new SecretTokenStore(
					this.secretStore,
					legacyConflictSecretId(tokenId),
				),
			);
			if (provider === "microsoft")
				await migrateLegacyTokenFile(
					this.app.vault.adapter,
					normalizePath(`${this.pluginDirectory}/token_cache.json`),
					tokens,
					new SecretTokenStore(
						this.secretStore,
						legacyConflictSecretId(tokenId, "generic"),
					),
				);
		}
		await this.saveData(this.settings);
	}
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	reportError(action: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${action}:`, message);
		notify(message, "error");
	}
	private reportDiagnostic(action: string, error: unknown): void {
		console.error(
			action,
			error instanceof Error ? error.message : "Unknown error",
		);
	}
	private sidebarViews(): TaskSidebarView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_TODO_SIDEBAR)
			.map((leaf) => leaf.view)
			.filter(
				(view): view is TaskSidebarView =>
					view instanceof TaskSidebarView,
			);
	}
	private async refreshSidebar(): Promise<void> {
		await Promise.all(this.sidebarViews().map((view) => view.render()));
	}
	private settingsEffects(): SettingsEffects {
		return {
			logout: () => this.invalidateCurrentProviderAuth(),
			rebuild: () => this.rebuildRuntime(),
			save: () => this.saveSettings(),
			refresh: () => this.refreshSidebar(),
		};
	}
	private async invalidateCurrentProviderAuth(): Promise<void> {
		try {
			if (this.runtime?.id === this.settings.provider)
				await this.runtime.auth.logout();
		} finally {
			await new SecretTokenStore(
				this.secretStore,
				tokenCacheSecretId(this.settings.provider),
			).remove();
			this.invalidateRuntime();
		}
	}
	async updateProviderCredential(
		key: "clientId" | "clientSecretId" | "redirectUrl",
		value: string,
	): Promise<void> {
		await changeProviderCredential(
			this.settings,
			key,
			value,
			this.settingsEffects(),
		);
	}
	async updateTimeZone(value: string): Promise<void> {
		await changeTimeZone(this.settings, value, this.settingsEffects());
	}
	async updateAutoSyncInterval(minutes: number): Promise<void> {
		this.settings.autoSyncIntervalMinutes = minutes;
		this.generation++;
		await this.saveSettings();
		this.configureAutoSync();
	}
	async updateAutoSyncOnStartup(enabled: boolean): Promise<void> {
		this.settings.autoSyncOnStartup = enabled;
		this.generation++;
		await this.saveSettings();
	}
	async updateShowCompleted(enabled: boolean): Promise<void> {
		this.settings.showCompleted = enabled;
		this.generation++;
		this.taskCache = null;
		await this.saveSettings();
	}
	async selectTaskList(id: string, title: string): Promise<void> {
		this.providerSettings.selectedListId = id;
		this.providerSettings.selectedListTitle = title;
		this.generation++;
		this.taskCache = null;
		await this.saveSettings();
	}
	private async selectTaskListInContext(
		context: MutationContext,
		id: string,
		title: string,
	): Promise<void> {
		this.assertMutationContextCurrent(context);
		const providerSettings = this.settings.providers[context.provider];
		providerSettings.selectedListId = id;
		providerSettings.selectedListTitle = title;
		this.generation++;
		this.taskCache = null;
		const updatedContext = this.captureMutationContext();
		await this.saveSettings();
		this.assertMutationContextCurrent(updatedContext);
		await this.refreshViewAndCache();
	}
	private configureAutoSync(): void {
		this.autoSync.configure(this.settings.autoSyncIntervalMinutes);
	}
	async connectCurrentProvider(): Promise<void> {
		const context = this.captureMutationContext();
		const runtime = this.runtime;
		if (!runtime || runtime.tasks !== context.service)
			throw new Error("Task provider context changed.");
		await runtime.auth.login();
		this.assertMutationContextCurrent(context);
		this.generation++;
		notify(`${context.provider} connected.`, "success");
		await this.refreshSidebar();
	}
	async disconnectCurrentProvider(): Promise<void> {
		const context = this.captureMutationContext();
		const runtime = this.runtime;
		if (!runtime || runtime.tasks !== context.service)
			throw new Error("Task provider context changed.");
		await runtime.auth.logout();
		this.assertMutationContextCurrent(context);
		this.invalidateRuntime();
		notify(`${context.provider} disconnected.`, "success");
		await this.refreshSidebar();
	}
	private async runCommand(
		action: string,
		work: () => void | Promise<void>,
	): Promise<void> {
		try {
			await work();
		} catch (error) {
			this.reportError(action, error);
		}
	}
	private commandAvailable(id: CommandId): boolean {
		const config = this.providerSettings;
		return canRunCommand(id, {
			hasCredentials: Boolean(
				config.clientId.trim() &&
				config.redirectUrl.trim() &&
				this.secretStore.read(config.clientSecretId),
			),
			hasSelectedList: Boolean(config.selectedListId),
			hasTaskLists: config.taskLists.length > 0,
			hasActiveFile: this.app.workspace.getActiveFile() !== null,
		});
	}
	private checkCommand(
		id: CommandId,
		checking: boolean,
		action: string,
		work: () => void | Promise<void>,
	): boolean {
		if (!this.commandAvailable(id)) return false;
		if (!checking) void this.runCommand(action, work);
		return true;
	}

	private initializeCommands(): void {
		this.addCommand({
			id: COMMAND_IDS.openSidebar,
			name: "Open task sidebar",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.openSidebar,
					checking,
					"Open sidebar failed",
					() => this.activateSidebar(),
				),
		});
		this.addCommand({
			id: COMMAND_IDS.connectProvider,
			name: "Connect current task provider",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.connectProvider,
					checking,
					"Connect failed",
					() => this.connectCurrentProvider(),
				),
		});
		this.addCommand({
			id: COMMAND_IDS.disconnectProvider,
			name: "Disconnect current task provider",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.disconnectProvider,
					checking,
					"Disconnect failed",
					() => this.disconnectCurrentProvider(),
				),
		});
		this.addCommand({
			id: COMMAND_IDS.loadTaskLists,
			name: "Load task lists",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.loadTaskLists,
					checking,
					"Load lists failed",
					() => this.loadAvailableTaskLists(),
				),
		});
		this.addCommand({
			id: COMMAND_IDS.selectTaskList,
			name: "Select task list",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.selectTaskList,
					checking,
					"Select list failed",
					() => this.openTaskListsModal(),
				),
		});
		this.addCommand({
			id: COMMAND_IDS.refreshTasks,
			name: "Refresh tasks",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.refreshTasks,
					checking,
					"Refresh failed",
					() => this.refreshViewAndCache(),
				),
		});
		this.addCommand({
			id: COMMAND_IDS.pushAllTasks,
			name: "Push all tasks from note",
			editorCheckCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.pushAllTasks,
					checking,
					"Push failed",
					async () => {
						const count = await this.pushTasksFromNote();
						notify(`${count} new tasks added.`, "success");
						await this.refreshViewAndCache();
					},
				),
		});
		this.addCommand({
			id: COMMAND_IDS.pushOneTask,
			name: "Create and push task",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.pushOneTask,
					checking,
					"Create task failed",
					() => this.openPushTaskModal(),
				),
		});
		this.addCommand({
			id: COMMAND_IDS.showOpenTasks,
			name: "Show open tasks list",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.showOpenTasks,
					checking,
					"Show tasks failed",
					() => this.openTaskCompleteModal(),
				),
		});
		this.addCommand({
			id: COMMAND_IDS.organizeTasks,
			name: "Organize tasks from all notes",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.organizeTasks,
					checking,
					"Organize failed",
					async () => {
						await this.gatherTasks();
						notify("Tasks organized.", "success");
					},
				),
		});
		this.addCommand({
			id: COMMAND_IDS.deleteCompletedTasks,
			name: "Delete completed tasks",
			checkCallback: (checking) =>
				this.checkCommand(
					COMMAND_IDS.deleteCompletedTasks,
					checking,
					"Delete failed",
					async () => {
						const count = await this.deleteAllCompletedTasks();
						if (count)
							notify(
								`${count} completed tasks deleted.`,
								"success",
							);
					},
				),
		});
	}

	async activateSidebar(): Promise<void> {
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_TODO_SIDEBAR, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
	private requireListId(): string {
		const id = this.providerSettings.selectedListId;
		if (!id) throw new Error("Select a task list before syncing.");
		return id;
	}
	async loadAvailableTaskLists(): Promise<void> {
		const context = this.captureMutationContext();
		const lists = await context.service.fetchTaskLists();
		this.assertMutationContextCurrent(context);
		const providerSettings = this.settings.providers[context.provider];
		providerSettings.taskLists = lists;
		if (
			!lists.some((list) => list.id === providerSettings.selectedListId)
		) {
			providerSettings.selectedListId = "";
			providerSettings.selectedListTitle = "";
			this.generation++;
			this.taskCache = null;
		}
		await this.saveSettings();
		notify("Task lists loaded.", "success");
	}
	async getTasksFromSelectedList(): Promise<TaskItem[]> {
		const listId = this.requireListId();
		if (
			this.taskCache?.provider === this.settings.provider &&
			this.taskCache.listId === listId
		)
			return this.taskCache.tasks;
		return this.refreshTaskCache();
	}

	async pushTasksFromNote(): Promise<number> {
		const context = this.captureMutationContext();
		if (!context.listId)
			throw new Error("Select a task list before syncing.");
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) throw new Error("No active file found.");
		const content = await this.app.vault.read(activeFile);
		const regex = /^-\s*\[( |x|X)\]\s+(.+)$/gm;
		const noteTasks: Array<{ title: string; completed: boolean }> = [];
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)))
			noteTasks.push({
				completed: match[1].toLowerCase() === "x",
				title: match[2].trim(),
			});
		if (!noteTasks.length)
			throw new Error("No tasks found in the active note.");
		this.assertMutationContextCurrent(context);
		const existing = await context.service.fetchTasks(context.listId, true);
		let created = 0;
		this.assertMutationContextCurrent(context);
		for (const task of noteTasks) {
			const found = matchRemoteTask(existing, task.title);
			if (found.status === "ambiguous")
				throw new Error(
					`Multiple remote tasks match “${task.title}”; no ambiguous task was changed.`,
				);
			if (found.status === "matched") {
				if (task.completed && found.task.status === "open") {
					this.assertMutationContextCurrent(context);
					await context.service.completeTask(
						context.listId,
						found.task.id,
					);
					this.assertMutationContextCurrent(context);
				}
				continue;
			}
			this.assertMutationContextCurrent(context);
			const made = await context.service.createTask(context.listId, {
				title: task.title,
			});
			this.assertMutationContextCurrent(context);
			existing.push(made);
			if (task.completed) {
				await context.service.completeTask(context.listId, made.id);
				this.assertMutationContextCurrent(context);
			}
			created++;
		}
		return created;
	}
	async pushOneTask(title: string, dueDate?: string): Promise<boolean> {
		return this.pushOneTaskInContext(
			this.captureMutationContext(),
			title,
			dueDate,
		);
	}
	private async pushOneTaskInContext(
		context: MutationContext,
		title: string,
		dueDate?: string,
	): Promise<boolean> {
		this.assertMutationContextCurrent(context);
		if (!context.listId)
			throw new Error("Select a task list before syncing.");
		const existing = await context.service.fetchTasks(context.listId, true);
		this.assertMutationContextCurrent(context);
		if (matchRemoteTask(existing, title).status !== "none") return false;
		this.assertMutationContextCurrent(context);
		await context.service.createTask(context.listId, { title, dueDate });
		this.assertMutationContextCurrent(context);
		await this.refreshViewAndCache();
		return true;
	}

	async gatherTasks(): Promise<Map<string, string>> {
		const output = new Map<string, string>();
		const regex = /^\s*-\s*\[( |x|X)\]\s+(.*)$/gm;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path === "Tasks List.md") continue;
			const content = await this.app.vault.read(file);
			let match: RegExpExecArray | null;
			while ((match = regex.exec(content))) {
				const title = match[2].trim(),
					state = match[1].toLowerCase() === "x" ? "[x]" : "[ ]";
				if (!output.has(title) || state === "[x]")
					output.set(title, state);
			}
		}
		const body = Array.from(
			output,
			([title, state]) => `- ${state} ${title}`,
		).join("\n");
		const target = this.app.vault.getAbstractFileByPath("Tasks List.md");
		if (!target)
			await this.app.vault.create(
				"Tasks List.md",
				`${GENERATED_START}\n${body}\n${GENERATED_END}\n`,
			);
		else if (target instanceof TFile)
			await this.app.vault.process(target, (content) =>
				updateManagedTaskSection(content, body),
			);
		else throw new Error("Unexpected file type for Tasks List.md");
		return output;
	}

	async openPushTaskModal(): Promise<void> {
		const context = this.captureMutationContext();
		new TaskTitleModal(this.app, (result) =>
			this.runCommand("Create task failed", async () => {
				const made = await this.pushOneTaskInContext(
					context,
					result.title,
					result.dueDate,
				);
				notify(
					made
						? "Task created."
						: "A task with that title already exists.",
					made ? "success" : "info",
				);
			}),
		).open();
	}
	async openTaskListsModal(): Promise<void> {
		const context = this.captureMutationContext();
		new GenericSelectModal<TaskList>(
			this.app,
			this.providerSettings.taskLists,
			(item) => item.title,
			(item) =>
				this.selectTaskListInContext(context, item.id, item.title),
		).open();
	}
	async openTaskCompleteModal(): Promise<void> {
		const context = this.captureMutationContext();
		if (!context.listId)
			throw new Error("Select a task list before syncing.");
		const cached =
			this.taskCache?.provider === context.provider &&
			this.taskCache.listId === context.listId
				? this.taskCache.tasks
				: undefined;
		const tasks =
			cached ??
			(await context.service.fetchTasks(
				context.listId,
				this.settings.showCompleted,
			));
		this.assertMutationContextCurrent(context);
		const open = tasks.filter((task) => task.status === "open");
		new GenericSelectModal<TaskItem>(
			this.app,
			open,
			(item) => item.title,
			async (item) => {
				await this.runMutationInContext(context, (service) =>
					service.completeTask(context.listId, item.id),
				);
				await this.refreshViewAndCache();
			},
		).open();
	}
	async refreshTaskCache(): Promise<TaskItem[]> {
		this.requireListId();
		const result = await this.refreshCoordinator.refresh();
		return result.status === "committed"
			? result.value
			: (this.taskCache?.tasks ?? []);
	}
	async deleteAllCompletedTasks(): Promise<number> {
		const context = this.captureMutationContext();
		if (!context.listId)
			throw new Error("Select a task list before syncing.");
		const listTitle =
			this.settings.providers[context.provider].selectedListTitle;
		return deleteCompletedTasksAndRefresh(
			() =>
				deleteCompletedTasksWithConfirmation(
					context.service,
					context.provider,
					context.listId,
					listTitle,
					(details) =>
						confirmCompletedTaskDeletion(this.app, details),
					() => this.assertMutationContextCurrent(context),
				),
			() =>
				this.runMutationInContext(context, () =>
					this.refreshViewAndCache(),
				),
		);
	}
	async refreshViewAndCache(): Promise<void> {
		const result = await this.refreshCoordinator.refresh();
		if (result.status === "committed") await this.refreshSidebar();
	}
}
