import { describe, expect, it } from "vitest";
import { COMMAND_IDS } from "../src/commands";

describe("command compatibility", () => {
	it("preserves baseline IDs for commands that still have safe equivalents", () => {
		expect(Object.values(COMMAND_IDS)).toEqual(expect.arrayContaining([
			"open-todo-sidebar", "login-task-manager", "get-tasks-from-selected-list",
			"push-all-tasks-from-note", "push-one-task", "show-not-started-tasks",
			"select-task-list", "organize-tasks", "delete-completed-tasks",
		]));
		expect(Object.values(COMMAND_IDS)).not.toContain("refresh-task-manager-token");
	});
});
