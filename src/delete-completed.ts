import { ProviderId, TaskService } from "./types";

export interface DeleteConfirmationDetails {
	provider: string;
	list: string;
	count: number;
}

export type ConfirmDeletion = (details: DeleteConfirmationDetails) => Promise<boolean>;

export class DeleteCompletedTasksError extends Error {
	readonly attempted: number;
	readonly notAttempted: number;
	refreshError?: unknown;
	constructor(
		readonly deleted: number,
		readonly total: number,
		readonly originalError: unknown,
	) {
		const attempted = deleted + 1;
		const notAttempted = total - attempted;
		const remaining = total - deleted;
		const reason = originalError instanceof Error ? ` Cause: ${originalError.message}` : "";
		super(`${deleted} of ${total} deleted; ${remaining} remain (1 failed, ${notAttempted} not attempted). Retry after checking the provider connection.${reason}`);
		this.name = "DeleteCompletedTasksError";
		this.attempted = attempted;
		this.notAttempted = notAttempted;
	}
}

export async function deleteCompletedTasksWithConfirmation(
	service: TaskService,
	provider: ProviderId,
	listId: string,
	listTitle: string,
	confirm: ConfirmDeletion,
): Promise<number> {
	const completed = (await service.fetchTasks(listId, true)).filter(task => task.status === "completed");
	if (!completed.length) return 0;
	const accepted = await confirm({
		provider: provider === "microsoft" ? "Microsoft To Do" : "TickTick",
		list: listTitle || listId,
		count: completed.length,
	});
	if (!accepted) return 0;
	let deleted = 0;
	for (const task of completed) {
		try {
			await service.deleteTask(listId, task.id);
			deleted++;
		} catch (error) {
			throw new DeleteCompletedTasksError(deleted, completed.length, error);
		}
	}
	return completed.length;
}

export async function deleteCompletedTasksAndRefresh(
	deleteTasks: () => Promise<number>,
	refresh: () => Promise<void>,
): Promise<number> {
	let deleted: number;
	try {
		deleted = await deleteTasks();
	} catch (error) {
		if (error instanceof DeleteCompletedTasksError && error.attempted > 0) {
			try { await refresh(); }
			catch (refreshError) { error.refreshError = refreshError; }
		}
		throw error;
	}
	if (deleted > 0) await refresh();
	return deleted;
}
