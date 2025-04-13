/**
 * Interface for the task cache.
 */
export interface TaskCache {
	tasks: Array<[string, TaskItem]>;
	lastUpdated: number;
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
	dueDate?: string;
}
