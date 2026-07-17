import { Plugin, TFile } from "obsidian";
import * as path from "path";
import { MyTodoSettingTab } from "./setting";
import { VIEW_TYPE_TODO_SIDEBAR, TaskSidebarView } from "./right-sidebar-view";
import { TaskTitleModal } from "./task-title-modal";
import { GenericSelectModal } from "./select-modal";
import { notify } from "./utils";
import { migrateSettings, TaskSyncerSettings } from "./settings-model";
import { createProviderRuntime, ProviderRuntime } from "./provider";
import { ProviderId, TaskCache, TaskInputResult, TaskItem, TaskList, TaskService } from "./types";
import { FileTokenStore } from "./auth";
import { COMMAND_IDS } from "./commands";
import { changeProviderCredential, changeTimeZone, SettingsEffects } from "./settings-actions";

export default class TaskSyncerPlugin extends Plugin {
	settings: TaskSyncerSettings;
	sidebarView: TaskSidebarView | null = null;
	taskCache: TaskCache | null = null;
	private runtime?: ProviderRuntime;
	private pluginDirectory: string;
	get api(): TaskService { return this.ensureRuntime().tasks; }
	get providerSettings() { return this.settings.providers[this.settings.provider]; }

	async onload(): Promise<void> {
		const basePath = (this.app.vault.adapter as any).basePath;
		this.pluginDirectory = path.join(basePath, ".obsidian", "plugins", this.manifest.id);
		await this.loadSettings();
		this.addSettingTab(new MyTodoSettingTab(this.app, this));
		this.registerView(VIEW_TYPE_TODO_SIDEBAR, leaf => { const view = new TaskSidebarView(leaf, this); this.sidebarView = view; return view; });
		this.initializeCommands();
	}
	ensureRuntime(): ProviderRuntime { if (!this.runtime || this.runtime.id !== this.settings.provider) this.runtime = createProviderRuntime(this.settings.provider, this.settings, this.pluginDirectory); return this.runtime; }
	async rebuildRuntime() { this.runtime = undefined; this.taskCache = null; }
	async switchProvider(provider: ProviderId) { if (provider === this.settings.provider) return; this.settings.provider = provider; await this.rebuildRuntime(); await this.saveSettings(); if (this.sidebarView) await this.sidebarView.render(); }
	async loadSettings() { this.settings = migrateSettings(await this.loadData()); await this.saveData(this.settings); }
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
			await new FileTokenStore(path.join(this.pluginDirectory, `${this.settings.provider}-token-cache.json`)).remove();
			if (this.settings.provider === "microsoft") await new FileTokenStore(path.join(this.pluginDirectory, "token_cache.json")).remove();
			this.taskCache = null;
		}
	}
	async updateProviderCredential(key: "clientId" | "clientSecret" | "redirectUrl", value: string) {
		await changeProviderCredential(this.settings, key, value, this.settingsEffects());
	}
	async updateTimeZone(value: string) { await changeTimeZone(this.settings, value, this.settingsEffects()); }
	async connectCurrentProvider() { await this.ensureRuntime().auth.login(); notify(`${this.settings.provider} connected.`, "success"); await this.refreshSidebar(); }
	async disconnectCurrentProvider() { await this.ensureRuntime().auth.logout(); this.taskCache = null; notify(`${this.settings.provider} disconnected.`, "success"); await this.refreshSidebar(); }
	private async runCommand(action: string, work: () => void | Promise<void>) { try { await work(); } catch (error) { this.reportError(action, error); } }
	private initializeCommands() {
		this.addCommand({ id: COMMAND_IDS.openSidebar, name: "Open Task Sidebar", callback: () => this.runCommand("Open sidebar failed", () => this.activateSidebar()) });
		this.addCommand({ id: COMMAND_IDS.connectProvider, name: "Connect Current Task Provider", callback: () => this.runCommand("Connect failed", () => this.connectCurrentProvider()) });
		this.addCommand({ id: COMMAND_IDS.disconnectProvider, name: "Disconnect Current Task Provider", callback: () => this.runCommand("Disconnect failed", () => this.disconnectCurrentProvider()) });
		this.addCommand({ id: COMMAND_IDS.loadTaskLists, name: "Load Task Lists", callback: () => this.loadAvailableTaskLists() });
		this.addCommand({ id: COMMAND_IDS.selectTaskList, name: "Select Task List", callback: () => this.runCommand("Select list failed", () => this.openTaskListsModal()) });
		this.addCommand({ id: COMMAND_IDS.refreshTasks, name: "Refresh Tasks", callback: () => this.runCommand("Refresh failed", () => this.refreshViewAndCache()) });
		this.addCommand({ id: COMMAND_IDS.pushAllTasks, name: "Push All Tasks from Note", callback: async () => { try { const count = await this.pushTasksFromNote(); notify(`${count} new tasks added.`, "success"); await this.refreshViewAndCache(); } catch (e) { this.reportError("Push failed", e); } } });
		this.addCommand({ id: COMMAND_IDS.pushOneTask, name: "Create and Push Task", callback: () => this.runCommand("Create task failed", () => this.openPushTaskModal()) });
		this.addCommand({ id: COMMAND_IDS.showOpenTasks, name: "Show Open Tasks List", callback: () => this.runCommand("Show tasks failed", () => this.openTaskCompleteModal()) });
		this.addCommand({ id: COMMAND_IDS.organizeTasks, name: "Organize Tasks from All Notes", callback: async () => { try { await this.gatherTasks(); notify("Tasks organized.", "success"); } catch (e) { this.reportError("Organize failed", e); } } });
		this.addCommand({ id: COMMAND_IDS.deleteCompletedTasks, name: "Delete Completed Tasks", callback: async () => { try { const count = await this.deleteAllCompletedTasks(); notify(`${count} completed tasks deleted.`, "success"); } catch (e) { this.reportError("Delete failed", e); } } });
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
	async deleteAllCompletedTasks(): Promise<number> { const listId = this.requireListId(); const completed = (await this.api.fetchTasks(listId, true)).filter(t => t.status === "completed"); for (const task of completed) await this.api.deleteTask(listId, task.id); await this.refreshViewAndCache(); return completed.length; }
	async refreshViewAndCache() { await this.refreshTaskCache(); if (this.sidebarView) await this.sidebarView.render(); }
}
