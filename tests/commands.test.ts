import { describe, expect, it } from "vitest";
import { canRunCommand, COMMAND_IDS } from "../src/commands";

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

describe("command prerequisites", () => {
	const ready = { hasCredentials: true, hasSelectedList: true, hasTaskLists: true, hasActiveFile: true };

	it("requires credentials before provider and remote-list commands", () => {
		expect(canRunCommand(COMMAND_IDS.connectProvider, { ...ready, hasCredentials: false })).toBe(false);
		expect(canRunCommand(COMMAND_IDS.loadTaskLists, { ...ready, hasCredentials: false })).toBe(false);
	});

	it("requires a selected list and active file where applicable", () => {
		expect(canRunCommand(COMMAND_IDS.refreshTasks, { ...ready, hasSelectedList: false })).toBe(false);
		expect(canRunCommand(COMMAND_IDS.pushAllTasks, { ...ready, hasActiveFile: false })).toBe(false);
		expect(canRunCommand(COMMAND_IDS.pushAllTasks, ready)).toBe(true);
	});

	it("keeps local commands available without provider configuration", () => {
		const empty = { hasCredentials: false, hasSelectedList: false, hasTaskLists: false, hasActiveFile: false };
		expect(canRunCommand(COMMAND_IDS.openSidebar, empty)).toBe(true);
		expect(canRunCommand(COMMAND_IDS.organizeTasks, empty)).toBe(true);
	});
});
