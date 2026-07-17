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
