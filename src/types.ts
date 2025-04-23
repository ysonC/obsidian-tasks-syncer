/**
 * Interface for the task cache.
 */
export interface TaskCache {
	tasks: Array<[string, TaskItem]>;
}

/**
 *  Interface for task lists.
 */
export interface TaskList {
	title: string;
	id: string;
}

/**
 *  Interface for task item.
 */
export interface TaskItem {
	title: string;
	status: string;
	id: string;
	dueDateTime?: DateTimeInfo;
}

interface DateTimeInfo {
	dateTime: string;
	timeZone: string;
}

export interface TaskInputResult {
	title: string;
	dueDate?: string;
}

export interface TaskService {
	fetchTaskLists(): Promise<TaskList[]>;
	fetchTasks(listId: string): Promise<Map<string, TaskItem>>;
	createTask(listId: string, title: string, dueDate?: string): Promise<void>;
	updateTask(
		listId: string,
		taskId: string,
		opts: { title?: string; done?: boolean; dueDate?: string },
	): Promise<void>;
	deleteTask(listId: string, taskId: string): Promise<void>;
	updateTaskListName(listId: string, newName: string): Promise<void>;
}
