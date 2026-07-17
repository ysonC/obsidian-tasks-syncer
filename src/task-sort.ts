import { TaskItem } from "./types";

function dateOnly(task: TaskItem): string | undefined {
	return task.dueDate?.slice(0, 10);
}

function dueDateGroup(task: TaskItem, today: string): number {
	const dueDate = dateOnly(task);
	if (!dueDate) return 2;
	return dueDate >= today ? 0 : 1;
}

/**
 * Order sidebar tasks by completion state and actionable due date:
 * upcoming dates first, overdue dates next, and undated tasks last.
 */
export function sortTasksForSidebar(
	tasks: TaskItem[],
	sortByDueDate: boolean,
	today = new Date().toISOString().slice(0, 10),
): TaskItem[] {
	return tasks.slice().sort((a, b) => {
		if (a.status !== b.status) return a.status === "completed" ? 1 : -1;
		if (!sortByDueDate) return 0;

		const groupDifference = dueDateGroup(a, today) - dueDateGroup(b, today);
		if (groupDifference !== 0) return groupDifference;

		const aDate = dateOnly(a);
		const bDate = dateOnly(b);
		if (!aDate || !bDate) return 0;

		// Upcoming tasks: nearest date first. Overdue tasks: most recently
		// overdue first, so the oldest stale item does not obscure what's next.
		return aDate >= today
			? aDate.localeCompare(bDate)
			: bDate.localeCompare(aDate);
	});
}
