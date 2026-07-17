import { Plugin, TFile } from "obsidian";
import * as path from "path";
import { TaskSyncerSettingTab } from "./setting";
import { VIEW_TYPE_TODO_SIDEBAR, TaskSidebarView } from "./right-sidebar-view";
import { TaskTitleModal } from "./task-title-modal";
import { GenericSelectModal } from "./select-modal";
import { notify } from "./utils";
import { migrateSettings, TaskSyncerSettings, tokenCacheSecretId } from "./settings-model";
import { createProviderRuntime, ProviderRuntime } from "./provider";
import { ProviderId, TaskCache, TaskInputResult, TaskItem, TaskList, TaskService } from "./types";

import { COMMAND_IDS } from "./commands";
import { changeProviderCredential, changeTimeZone, SettingsEffects } from "./settings-actions";
import { resolvePluginDirectory } from "./plugin-path";
import { AutoSyncController } from "./auto-sync";
import { migrateLegacyClientSecrets, migrateLegacyTokenFile, ObsidianSecretStorageApi, ObsidianSecretStore, SecretStore, SecretTokenStore } from "./secret-store";
import { deleteCompletedTasksAndRefresh, deleteCompletedTasksWithConfirmation } from "./delete-completed";
import { confirmCompletedTaskDeletion } from "./delete-confirmation-modal";

export default class TaskSyncerPlugin extends Plugin {
	settings: TaskSyncerSettings;
	sidebarView: TaskSidebarView | null = null;
	taskCache: TaskCache | null = null;
	private runtime?: ProviderRuntime;
	private pluginDirectory: string;
	private autoSync: AutoSyncController;
	private secretStore: SecretStore;
	get api(): TaskService { return this.ensureRuntime().tasks; }
	get providerSettings() { return this.settings.providers[this.settings.provider]; }

	async onload(): Promise<void> {
		const basePath = (this.app.vault.adapter as any).basePath;
		this.pluginDirectory = resolvePluginDirectory(basePath, this.manifest.dir, this.manifest.id);
		this.secretStore = new ObsidianSecretStore(this.app.secretStorage as unknown as ObsidianSecretStorageApi);
		await this.loadSettings();
		this.autoSync = new AutoSyncController(
			() => this.refreshViewAndCache(),
			() => Boolean(this.providerSettings.selectedListId),
			() => undefined,
			{
				setInterval: (callback, milliseconds) => this.registerInterval(window.setInterval(callback, milliseconds)),
				clearInterval: id => window.clearInterval(id),
			},
		);
		this.addSettingTab(new TaskSyncerSettingTab(this.app, this));
		this.registerView(VIEW_TYPE_TODO_SIDEBAR, leaf => { const view = new TaskSidebarView(leaf, this); this.sidebarView = view; return view; });
		this.initializeCommands();
		this.configureAutoSync();
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.autoSyncOnStartup) void this.autoSync.run();
		});
	}
	onunload(): void { this.autoSync?.stop(); }
	ensureRuntime(): ProviderRuntime { if (!this.runtime || this.runtime.id !== this.settings.provider) this.runtime = createProviderRuntime(this.settings.provider, this.settings, this.secretStore); return this.runtime; }
	async rebuildRuntime() { this.runtime = undefined; this.taskCache = null; }
	async switchProvider(provider: ProviderId) { if (provider === this.settings.provider) return; this.settings.provider = provider; await this.rebuildRuntime(); await this.saveSettings(); if (this.sidebarView) await this.sidebarView.render(); }
	async loadSettings() {
		const raw = await this.loadData();
		this.settings = migrateSettings(raw);
		await migrateLegacyClientSecrets(raw, this.settings, this.secretStore, () => this.saveData(this.settings));
		for (const provider of ["microsoft", "ticktick"] as const) {
			const tokens = new SecretTokenStore(this.secretStore, tokenCacheSecretId(provider));
			await migrateLegacyTokenFile(path.join(this.pluginDirectory, `${provider}-token-cache.json`), tokens);
			if (provider === "microsoft") await migrateLegacyTokenFile(path.join(this.pluginDirectory, "token_cache.json"), tokens);
		}
		await this.saveData(this.settings);
	}
	async saveSettings() { await this.saveData(this.settings); }

	reportError(action: string, error: unknown) { const message = error instanceof Error ? error.message : String(error); console.error(`${action}:`, message); notify(message, "error"); }
	private async refreshSidebar() { if (this.sidebarView) await this.sidebarView.render(); }
	private settingsEffects(): SettingsEffects {
		return {
			logout: () => this.invalidateCurrentProviderAuth(),

			rebuild: () => this.rebuildRuntime(),
			save: () => this.saveSettings(),
			refresh: () => this.refreshSidebar(),
		};
	}
	private async invalidateCurrentProviderAuth() {
		try {
			if (this.runtime?.id === this.settings.provider) await this.runtime.auth.logout();
		} finally {
			await new SecretTokenStore(this.secretStore, tokenCacheSecretId(this.settings.provider)).remove();
			this.taskCache = null;
		}
	}
	async updateProviderCredential(key: "clientId" | "clientSecretId" | "redirectUrl", value: string) {
		await changeProviderCredential(this.settings, key, value, this.settingsEffects());
	}
	async updateTimeZone(value: string) { await changeTimeZone(this.settings, value, this.settingsEffects()); }
	async updateAutoSyncInterval(minutes: number) {
		this.settings.autoSyncIntervalMinutes = minutes;
		await this.saveSettings();
		this.configureAutoSync();
	}
	async updateAutoSyncOnStartup(enabled: boolean) {
		this.settings.autoSyncOnStartup = enabled;
		await this.saveSettings();
	}
	private configureAutoSync() { this.autoSync.configure(this.settings.autoSyncIntervalMinutes); }
	async connectCurrentProvider() { await this.ensureRuntime().auth.login(); notify(`${this.settings.provider} connected.`, "success"); await this.refreshSidebar(); }
	async disconnectCurrentProvider() { await this.ensureRuntime().auth.logout(); this.taskCache = null; notify(`${this.settings.provider} disconnected.`, "success"); await this.refreshSidebar(); }
	private async runCommand(action: string, work: () => void | Promise<void>) { try { await work(); } catch (error) { this.reportError(action, error); } }
	private initializeCommands() {
		this.addCommand({ id: COMMAND_IDS.openSidebar, name: "Open task sidebar", callback: () => this.runCommand("Open sidebar failed", () => this.activateSidebar()) });
		this.addCommand({ id: COMMAND_IDS.connectProvider, name: "Connect current task provider", callback: () => this.runCommand("Connect failed", () => this.connectCurrentProvider()) });
		this.addCommand({ id: COMMAND_IDS.disconnectProvider, name: "Disconnect current task provider", callback: () => this.runCommand("Disconnect failed", () => this.disconnectCurrentProvider()) });
		this.addCommand({ id: COMMAND_IDS.loadTaskLists, name: "Load task lists", callback: () => this.loadAvailableTaskLists() });
		this.addCommand({ id: COMMAND_IDS.selectTaskList, name: "Select task list", callback: () => this.runCommand("Select list failed", () => this.openTaskListsModal()) });
		this.addCommand({ id: COMMAND_IDS.refreshTasks, name: "Refresh tasks", callback: () => this.runCommand("Refresh failed", () => this.refreshViewAndCache()) });
		this.addCommand({ id: COMMAND_IDS.pushAllTasks, name: "Push all tasks from note", callback: async () => { try { const count = await this.pushTasksFromNote(); notify(`${count} new tasks added.`, "success"); await this.refreshViewAndCache(); } catch (e) { this.reportError("Push failed", e); } } });
		this.addCommand({ id: COMMAND_IDS.pushOneTask, name: "Create and push task", callback: () => this.runCommand("Create task failed", () => this.openPushTaskModal()) });
		this.addCommand({ id: COMMAND_IDS.showOpenTasks, name: "Show open tasks list", callback: () => this.runCommand("Show tasks failed", () => this.openTaskCompleteModal()) });
		this.addCommand({ id: COMMAND_IDS.organizeTasks, name: "Organize tasks from all notes", callback: async () => { try { await this.gatherTasks(); notify("Tasks organized.", "success"); } catch (e) { this.reportError("Organize failed", e); } } });
		this.addCommand({ id: COMMAND_IDS.deleteCompletedTasks, name: "Delete completed tasks", callback: async () => { try { const count = await this.deleteAllCompletedTasks(); if (count) notify(`${count} completed tasks deleted.`, "success"); } catch (e) { this.reportError("Delete failed", e); } } });
	}
	async activateSidebar() { const leaf = this.app.workspace.getRightLeaf(false); if (!leaf) return; await leaf.setViewState({ type: VIEW_TYPE_TODO_SIDEBAR, active: true }); this.app.workspace.revealLeaf(leaf); }
	private requireListId() { const id = this.providerSettings.selectedListId; if (!id) throw new Error("Select a task list before syncing."); return id; }
	async loadAvailableTaskLists() { try { const lists = await this.api.fetchTaskLists(); this.providerSettings.taskLists = lists; if (!lists.some(l => l.id === this.providerSettings.selectedListId)) { this.providerSettings.selectedListId = ""; this.providerSettings.selectedListTitle = ""; this.taskCache = null; } await this.saveSettings(); notify("Task lists loaded.", "success"); } catch (e) { this.reportError("Load lists failed", e); } }
	async getTaskLists(): Promise<TaskList[]> { return this.api.fetchTaskLists(); }
	async getTasksFromSelectedList(): Promise<TaskItem[]> { const listId = this.requireListId(); if (this.taskCache?.provider === this.settings.provider && this.taskCache.listId === listId) return this.taskCache.tasks; return this.refreshTaskCache(); }
	private titleKey(title: string) { return title.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
	async pushTasksFromNote(): Promise<number> {
		const listId = this.requireListId(); const activeFile = this.app.workspace.getActiveFile(); if (!activeFile) throw new Error("No active file found.");
		const content = await this.app.vault.read(activeFile); const regex = /^-\s*\[( |x|X)\]\s+(.+)$/gm; const noteTasks: Array<{ title: string; completed: boolean }> = []; let match: RegExpExecArray | null;
		while ((match = regex.exec(content))) noteTasks.push({ completed: match[1].toLowerCase() === "x", title: match[2].trim() }); if (!noteTasks.length) throw new Error("No tasks found in the active note.");
		const existing = await this.api.fetchTasks(listId, true); const byTitle = new Map(existing.map(task => [this.titleKey(task.title), task])); let created = 0;
		for (const task of noteTasks) { const found = byTitle.get(this.titleKey(task.title)); if (found) { if (task.completed && found.status === "open") await this.api.completeTask(listId, found.id); continue; } const made = await this.api.createTask(listId, { title: task.title }); byTitle.set(this.titleKey(task.title), made); if (task.completed) await this.api.completeTask(listId, made.id); created++; }
		return created;
	}
	async pushOneTask(title: string, dueDate?: string): Promise<boolean> { const listId = this.requireListId(); const existing = await this.api.fetchTasks(listId, true); if (existing.some(t => this.titleKey(t.title) === this.titleKey(title))) return false; await this.api.createTask(listId, { title, dueDate }); await this.refreshViewAndCache(); return true; }
	async gatherTasks(): Promise<Map<string, string>> { const output = new Map<string, string>(); const regex = /^\s*-\s*\[( |x|X)\]\s+(.*)$/gm; for (const file of this.app.vault.getMarkdownFiles()) { const content = await this.app.vault.read(file); let match: RegExpExecArray | null; while ((match = regex.exec(content))) { const title = match[2].trim(), state = match[1].toLowerCase() === "x" ? "[x]" : "[ ]"; if (!output.has(title) || state === "[x]") output.set(title, state); } } const body = Array.from(output, ([title, state]) => `- ${state} ${title}`).join("\n"); const target = this.app.vault.getAbstractFileByPath("Tasks List.md"); if (!target) await this.app.vault.create("Tasks List.md", body); else if (target instanceof TFile) await this.app.vault.modify(target, body); else throw new Error("Unexpected file type for Tasks List.md"); return output; }
	async openPushTaskModal() { new TaskTitleModal(this.app, async (result: TaskInputResult) => { try { const made = await this.pushOneTask(result.title, result.dueDate); notify(made ? "Task created." : "A task with that title already exists.", made ? "success" : "info"); } catch (e) { this.reportError("Create task failed", e); } }).open(); }
	async openTaskListsModal() { new GenericSelectModal<TaskList>(this.app, this.providerSettings.taskLists, item => item.title, async item => { this.providerSettings.selectedListId = item.id; this.providerSettings.selectedListTitle = item.title; this.taskCache = null; await this.saveSettings(); await this.refreshViewAndCache(); }).open(); }
	async openTaskCompleteModal() { const listId = this.requireListId(); const open = (await this.getTasksFromSelectedList()).filter(t => t.status === "open"); new GenericSelectModal<TaskItem>(this.app, open, item => item.title, async item => { await this.api.completeTask(listId, item.id); await this.refreshViewAndCache(); }).open(); }
	async refreshTaskCache(): Promise<TaskItem[]> { const listId = this.requireListId(); const tasks = await this.api.fetchTasks(listId, this.settings.showCompleted); this.taskCache = { provider: this.settings.provider, listId, tasks }; return tasks; }
	async deleteAllCompletedTasks(): Promise<number> { const listId = this.requireListId(); return deleteCompletedTasksAndRefresh(() => deleteCompletedTasksWithConfirmation(this.api, this.settings.provider, listId, this.providerSettings.selectedListTitle, details => confirmCompletedTaskDeletion(this.app, details)), () => this.refreshViewAndCache()); }
	async refreshViewAndCache() { await this.refreshTaskCache(); if (this.sidebarView) await this.sidebarView.render(); }
}
