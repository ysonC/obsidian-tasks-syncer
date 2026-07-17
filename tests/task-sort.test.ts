import { describe, expect, it } from "vitest";
import { sortTasksForSidebar } from "../src/task-sort";
import { TaskItem } from "../src/types";

function task(id: string, dueDate?: string, status: "open" | "completed" = "open"): TaskItem {
	return { id, listId: "list", title: id, status, ...(dueDate ? { dueDate } : {}) };
}

describe("sidebar task sorting", () => {
	it("shows the next upcoming task first, overdue tasks afterward, and undated tasks last", () => {
		const tasks = [
			task("undated"),
			task("later", "2026-07-20T00:00:00+0000"),
			task("overdue", "2026-07-16T00:00:00+0000"),
			task("next", "2026-07-18T00:00:00+0000"),
		];

		expect(sortTasksForSidebar(tasks, true, "2026-07-17").map(item => item.id))
			.toEqual(["next", "later", "overdue", "undated"]);
	});

	it("keeps completed tasks below open tasks", () => {
		const tasks = [
			task("completed-next", "2026-07-18T00:00:00+0000", "completed"),
			task("open-later", "2026-07-20T00:00:00+0000"),
		];

		expect(sortTasksForSidebar(tasks, true, "2026-07-17").map(item => item.id))
			.toEqual(["open-later", "completed-next"]);
	});
});
