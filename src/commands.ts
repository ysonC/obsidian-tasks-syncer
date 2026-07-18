export const COMMAND_IDS = {
	openSidebar: "open-todo-sidebar",
	connectProvider: "login-task-manager",
	disconnectProvider: "disconnect-task-provider",
	loadTaskLists: "load-task-lists",
	refreshTasks: "get-tasks-from-selected-list",
	pushAllTasks: "push-all-tasks-from-note",
	pushOneTask: "push-one-task",
	showOpenTasks: "show-not-started-tasks",
	selectTaskList: "select-task-list",
	organizeTasks: "organize-tasks",
	deleteCompletedTasks: "delete-completed-tasks",
} as const;

export type CommandId = typeof COMMAND_IDS[keyof typeof COMMAND_IDS];

export interface CommandPrerequisites {
	hasCredentials: boolean;
	hasSelectedList: boolean;
	hasTaskLists: boolean;
	hasActiveFile: boolean;
}

/** Synchronous availability checks used by Obsidian command callbacks. */
export function canRunCommand(id: CommandId, state: CommandPrerequisites): boolean {
	if (id === COMMAND_IDS.openSidebar || id === COMMAND_IDS.organizeTasks) return true;
	if (id === COMMAND_IDS.connectProvider || id === COMMAND_IDS.disconnectProvider || id === COMMAND_IDS.loadTaskLists) {
		return state.hasCredentials;
	}
	if (id === COMMAND_IDS.selectTaskList) return state.hasCredentials && state.hasTaskLists;
	if (id === COMMAND_IDS.pushAllTasks) return state.hasCredentials && state.hasSelectedList && state.hasActiveFile;
	return state.hasCredentials && state.hasSelectedList;
}
