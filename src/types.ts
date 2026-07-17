export type ProviderId = "microsoft" | "ticktick";
export type TaskStatus = "open" | "completed";

export interface TaskList { id: string; title: string; }
export interface TaskItem { id: string; listId: string; title: string; status: TaskStatus; dueDate?: string; }
export interface TaskUpdate { title?: string; dueDate?: string; }
export interface TaskInputResult { title: string; dueDate?: string; }
export interface ProviderCapabilities { reopenTask: boolean; renameTaskList: boolean; }
export interface TaskCache { provider: ProviderId; listId: string; tasks: TaskItem[]; }

export interface TaskService {
	readonly capabilities: ProviderCapabilities;
	fetchTaskLists(): Promise<TaskList[]>;
	fetchTasks(listId: string, includeCompleted?: boolean): Promise<TaskItem[]>;
	createTask(listId: string, task: TaskUpdate & { title: string }): Promise<TaskItem>;
	updateTask(listId: string, taskId: string, update: TaskUpdate): Promise<TaskItem>;
	completeTask(listId: string, taskId: string): Promise<void>;
	reopenTask?(listId: string, taskId: string): Promise<void>;
	deleteTask(listId: string, taskId: string): Promise<void>;
	renameTaskList?(listId: string, title: string): Promise<void>;
}
