import { describe, expect, it, vi } from "vitest";
import TaskSyncerPlugin from "../src/main";
import { createDefaultSettings } from "../src/settings-model";
import type { TaskService } from "../src/types";
import { TaskTitleModal } from "../src/task-title-modal";
import { GenericSelectModal } from "../src/select-modal";
import { TaskSidebarView } from "../src/right-sidebar-view";

function taskService(): TaskService {
	return {
		capabilities: { reopenTask: true },
		fetchTaskLists: vi.fn(async () => []),
		fetchTasks: vi.fn(async () => []),
		createTask: vi.fn(),
		updateTask: vi.fn(),
		completeTask: vi.fn(),
		reopenTask: vi.fn(),
		deleteTask: vi.fn(),
	} as unknown as TaskService;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

describe("plugin OAuth lifecycle", () => {
	it("owns a live OAuth cancellation signal and aborts it on unload", () => {
		const plugin = new TaskSyncerPlugin({} as any, {} as any) as any;
		const signal = plugin.oauthAbortController.signal as AbortSignal;
		plugin.settings = createDefaultSettings();
		plugin.settings.providers.microsoft.clientId = "client";
		plugin.secretStore = { read: () => "secret", write: () => undefined, remove: () => undefined };
		const runtime = plugin.ensureRuntime();
		expect(runtime.auth.signal).toBe(signal);
		expect(signal.aborted).toBe(false);
		plugin.onunload();
		expect(signal.aborted).toBe(true);
	});

	it("cancels an in-flight OAuth runtime when provider context is invalidated", () => {
		const plugin = new TaskSyncerPlugin({} as any, {} as any) as any;
		plugin.settings = createDefaultSettings();
		plugin.taskCache = null;
		const original = plugin.oauthAbortController.signal as AbortSignal;
		plugin.invalidateRuntime();
		expect(original.aborted).toBe(true);
		expect(plugin.oauthAbortController.signal.aborted).toBe(false);
	});

	it("does not report a stale provider connection after switching during login", async () => {
		const login = deferred<void>();
		const plugin = new TaskSyncerPlugin({} as any, {} as any) as any;
		plugin.settings = createDefaultSettings();
		plugin.settings.providers.microsoft.selectedListId = "old-list";
		plugin.runtime = { id: "microsoft", tasks: taskService(), auth: { login: vi.fn(() => login.promise) } };
		plugin.refreshSidebar = vi.fn();
		const connecting = plugin.connectCurrentProvider();
		plugin.settings.provider = "ticktick";
		plugin.settings.providers.ticktick.selectedListId = "new-list";
		plugin.invalidateRuntime();
		login.resolve();
		await expect(connecting).rejects.toThrow(/context changed/i);
		expect(plugin.refreshSidebar).not.toHaveBeenCalled();
	});
});

describe("modal mutation identity", () => {
	function pluginWithService(service: TaskService): any {
		const plugin = new TaskSyncerPlugin({} as any, {} as any) as any;
		plugin.app = {};
		plugin.settings = createDefaultSettings();
		plugin.settings.providers.microsoft.selectedListId = "old-list";
		plugin.runtime = { id: "microsoft", tasks: service };
		plugin.reportError = vi.fn();
		return plugin;
	}

	it("rejects a delayed mutation after provider identity changes without touching either service", async () => {
		const plugin = new TaskSyncerPlugin({} as any, {} as any) as any;
		plugin.settings = createDefaultSettings();
		plugin.settings.providers.microsoft.selectedListId = "old-list";
		const oldService = taskService();
		const newService = taskService();
		plugin.runtime = { id: "microsoft", tasks: oldService };
		const context = plugin.captureMutationContext();

		plugin.settings.provider = "ticktick";
		plugin.settings.providers.ticktick.selectedListId = "new-list";
		plugin.generation++;
		plugin.runtime = { id: "ticktick", tasks: newService };

		await expect(plugin.runMutationInContext(context, (service: TaskService) => service.completeTask("old-list", "task")))
			.rejects.toThrow(/context changed/i);
		expect((oldService as unknown as { completeTask: ReturnType<typeof vi.fn> }).completeTask.mock.calls).toHaveLength(0);
		expect((newService as unknown as { completeTask: ReturnType<typeof vi.fn> }).completeTask.mock.calls).toHaveLength(0);
	});

	it("rejects delayed local list selection after the list changes", async () => {
		const plugin = new TaskSyncerPlugin({} as any, {} as any) as any;
		plugin.settings = createDefaultSettings();
		plugin.settings.providers.microsoft.selectedListId = "old-list";
		plugin.runtime = { id: "microsoft", tasks: taskService() };
		const context = plugin.captureMutationContext();
		plugin.settings.providers.microsoft.selectedListId = "new-list";
		plugin.generation++;

		await expect(plugin.runMutationInContext(context, async () => plugin.selectTaskList("chosen", "Chosen")))
			.rejects.toThrow(/context changed/i);
		expect(plugin.settings.providers.microsoft.selectedListId).toBe("new-list");
	});

	it("captures create-modal identity so switching providers before submit mutates neither service", async () => {
		const oldService = taskService();
		const newService = taskService();
		const plugin = pluginWithService(oldService);
		const captured: { modal?: TaskTitleModal } = {};
		vi.spyOn(TaskTitleModal.prototype, "open").mockImplementation(function (this: TaskTitleModal) { captured.modal = this; });
		await plugin.openPushTaskModal();

		plugin.settings.provider = "ticktick";
		plugin.settings.providers.ticktick.selectedListId = "new-list";
		plugin.generation++;
		plugin.runtime = { id: "ticktick", tasks: newService };
		await (captured.modal as any).onSubmit({ title: "stale task" });

		expect(oldService.fetchTasks).not.toHaveBeenCalled();
		expect(oldService.createTask).not.toHaveBeenCalled();
		expect(newService.createTask).not.toHaveBeenCalled();
	});

	it("captures list-modal identity so a stale choice cannot change the current list", async () => {
		const plugin = pluginWithService(taskService());
		plugin.providerSettings.taskLists = [{ id: "chosen", title: "Chosen" }];
		const captured: { modal?: GenericSelectModal<unknown> } = {};
		vi.spyOn(GenericSelectModal.prototype, "open").mockImplementation(function (this: GenericSelectModal<unknown>) { captured.modal = this; });
		await plugin.openTaskListsModal();
		plugin.settings.providers.microsoft.selectedListId = "new-list";
		plugin.generation++;

		await expect((captured.modal as any).onSelect({ id: "chosen", title: "Chosen" })).rejects.toThrow(/context changed/i);
		expect(plugin.providerSettings.selectedListId).toBe("new-list");
	});

	it("captures open-task modal identity so switching providers before selection mutates neither service", async () => {
		const oldService = taskService();
		const newService = taskService();
		vi.mocked(oldService.fetchTasks).mockResolvedValue([{ id: "old-task", listId: "old-list", title: "Old", status: "open" }]);
		const plugin = pluginWithService(oldService);
		const captured: { modal?: GenericSelectModal<unknown> } = {};
		vi.spyOn(GenericSelectModal.prototype, "open").mockImplementation(function (this: GenericSelectModal<unknown>) { captured.modal = this; });
		await plugin.openTaskCompleteModal();
		plugin.settings.provider = "ticktick";
		plugin.settings.providers.ticktick.selectedListId = "new-list";
		plugin.generation++;
		plugin.runtime = { id: "ticktick", tasks: newService };

		await expect((captured.modal as any).onSelect({ id: "old-task", listId: "old-list", title: "Old", status: "open" })).rejects.toThrow(/context changed/i);
		expect(oldService.completeTask).not.toHaveBeenCalled();
		expect(newService.completeTask).not.toHaveBeenCalled();
	});

	it("captures sidebar edit identity so switching providers before save mutates neither service", async () => {
		const oldService = taskService();
		const newService = taskService();
		const plugin = pluginWithService(oldService);
		const view = Object.create(TaskSidebarView.prototype) as any;
		view.plugin = plugin;
		view.app = {};
		view.refresh = vi.fn();
		const captured: { modal?: TaskTitleModal } = {};
		vi.spyOn(TaskTitleModal.prototype, "open").mockImplementation(function (this: TaskTitleModal) { captured.modal = this; });
		view.editTask({ id: "old-task", listId: "old-list", title: "Old", status: "open" });
		plugin.settings.provider = "ticktick";
		plugin.settings.providers.ticktick.selectedListId = "new-list";
		plugin.generation++;
		plugin.runtime = { id: "ticktick", tasks: newService };

		await expect((captured.modal as any).onSubmit({ title: "Changed" })).rejects.toThrow(/context changed/i);
		expect(oldService.updateTask).not.toHaveBeenCalled();
		expect(newService.updateTask).not.toHaveBeenCalled();
	});

	it("does not commit task lists fetched for a provider that changed while awaiting", async () => {
		const pending = deferred<Array<{ id: string; title: string }>>();
		const oldService = taskService();
		vi.mocked(oldService.fetchTaskLists).mockReturnValue(pending.promise);
		const plugin = pluginWithService(oldService);
		plugin.saveSettings = vi.fn();
		const loading = plugin.loadAvailableTaskLists();
		plugin.settings.provider = "ticktick";
		plugin.settings.providers.ticktick.selectedListId = "new-list";
		plugin.generation++;
		plugin.runtime = { id: "ticktick", tasks: taskService() };
		pending.resolve([{ id: "old-list", title: "Old list" }]);

		await expect(loading).rejects.toThrow(/context changed/i);
		expect(plugin.settings.providers.microsoft.taskLists).toEqual([]);
		expect(plugin.settings.providers.ticktick.taskLists).toEqual([]);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it("does not continue a note push after provider identity changes during its fetch", async () => {
		const pending = deferred<Awaited<ReturnType<TaskService["fetchTasks"]>>>();
		const oldService = taskService();
		const newService = taskService();
		vi.mocked(oldService.fetchTasks).mockReturnValue(pending.promise);
		const plugin = pluginWithService(oldService);
		plugin.app = {
			workspace: { getActiveFile: () => ({ path: "note.md" }) },
			vault: { read: vi.fn(async () => "- [ ] New task") },
		};
		const pushing = plugin.pushTasksFromNote();
		await vi.waitFor(() => expect(oldService.fetchTasks).toHaveBeenCalledOnce());
		plugin.settings.provider = "ticktick";
		plugin.settings.providers.ticktick.selectedListId = "new-list";
		plugin.generation++;
		plugin.runtime = { id: "ticktick", tasks: newService };
		pending.resolve([]);

		await expect(pushing).rejects.toThrow(/context changed/i);
		expect(oldService.createTask).not.toHaveBeenCalled();
		expect(newService.createTask).not.toHaveBeenCalled();
	});
});
